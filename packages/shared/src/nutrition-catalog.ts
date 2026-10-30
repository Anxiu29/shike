/**
 * 查库与新条目工厂：只有创建新记录/选择食品时才需要完整内置食品与配方。
 * 首页展示旧记录只读快照，应只依赖nutrition-snapshot.ts，不能因此加载几千条食品。
 * 索引使用完整ID库供配方引用、精简名称库供新选择，保留原匹配顺序与数据来源。
 */
import { foods, catalogFoods, foodProvenance, type FoodDefinition } from "./food-data.js";
import { recipes, type Recipe } from "./recipes.js";
import { createId } from "./id.js";
import { normalizeFoodName, nutritionEstimateProfileSchema, type FoodEntry, type NutrientRanges, type NutritionEstimateProfile, type RecipeSnapshot } from "./schemas.js";
import { applyEstimateLevel, emptyNutrients, nutrientKeys } from "./nutrition-snapshot.js";

// 大食物库用索引查找，避免每次识别／配方换算都遍历几千条记录。
const foodsById = new Map(foods.map(food => [food.id, food]));
const foodsByName = new Map<string, FoodDefinition>();
for (const food of catalogFoods) for (const label of [food.name, ...food.aliases]) {
  const key = normalizeFoodName(label);
  if (!foodsByName.has(key)) foodsByName.set(key, food);
}
const recipesByName = new Map(recipes.flatMap(recipe => [recipe.name, ...recipe.aliases].map(label => [normalizeFoodName(label), recipe] as const)));
export function findFood(name: string): FoodDefinition | undefined {
  return foodsByName.get(normalizeFoodName(name));
}
export function findRecipe(name: string): Recipe | undefined {
  return recipesByName.get(normalizeFoodName(name));
}
/**
 * 新条目复制当前营养值和来源，referenceId只用于追溯，历史计算从不通过该ID回查最新库。
 * weightG=null表示份量未知；0表示明确没有吃，两者必须保留不同语义。
 */
export function createFoodEntry(food: FoodDefinition, weightG: number | null): FoodEntry {
  if (weightG !== null && (!Number.isFinite(weightG) || weightG < 0 || weightG > 20000)) {
    throw new Error('食物重量必须是 0 至 20000 g，或留空待补充');
  }
  return {
    id: createId(), name: food.name, weightG,
    nutrientsPer100g: { ...food.nutrientsPer100g },
    provenance: foodProvenance(food),
    kind: 'database', referenceId: food.id, warnings: [
      ...(food.state === 'raw' ? ['此数据对应生食／生重；熟食需选择相符的数据或配方。'] : []),
      ...(food.source.dataset === 'USDA FNDDS' ? ['USDA 膳食调查参考，可能采用美国常见配方；请核对具体做法、糖、油和品牌，不能视为这份食物的实测值。'] : []),
      ...(food.source.dataset === 'TFDA 食品营养成分' ? ['TFDA 成品样本参考，按每100g可食部分换算；地区配方、糖油和含水量可能不同，不代表当前食品或品牌的实测值。'] : []),
    ],
  };
}
/**
 * 油三档是应用情景，非食品标准。非油配料固定，油贡献单独计算一次；
 * 分母保持用户输入的成品重量，不猜测增减油后的含水量变化。
 */
function createRecipeOilProfile(snapshot: RecipeSnapshot, weightG: number): NutritionEstimateProfile | undefined {
  const oil = snapshot.ingredients.find((ingredient) => ingredient.id === 'oil');
  if (!oil) return undefined;
  const others = snapshot.ingredients.filter((ingredient) => ingredient.id !== 'oil');
  const scenarios = [
    { level: 'low', label: '少油', minFactor: 0.5, maxFactor: 0.8 },
    { level: 'medium', label: '普通', minFactor: 0.8, maxFactor: 1.2 },
    { level: 'high', label: '多油', minFactor: 1.2, maxFactor: 1.6 },
  ] as const;
  const profile: NutritionEstimateProfile = {
    factor: 'oil',
    options: scenarios.map((scenario) => {
      const minimumOil = oil.weightG * scenario.minFactor;
      const maximumOil = oil.weightG * scenario.maxFactor;
      const ranges = {} as NutrientRanges;
      for (const key of nutrientKeys) {
        const oilPer100g = oil.nutrientsPer100g[key];
        if (oilPer100g === null || others.some((ingredient) => ingredient.weightG > 0 && ingredient.nutrientsPer100g[key] === null)) {
          ranges[key] = null;
          continue;
        }
        const nonOilTotal = others.reduce((sum, ingredient) => sum + (ingredient.nutrientsPer100g[key] ?? 0) * ingredient.weightG / 100, 0);
        ranges[key] = {
          min: (nonOilTotal + oilPer100g * minimumOil / 100) / weightG * 100,
          max: (nonOilTotal + oilPer100g * maximumOil / 100) / weightG * 100,
        };
      }
      return {
        level: scenario.level, label: scenario.label, rangesPer100g: ranges,
        oilWeightPer100g: { min: minimumOil / weightG * 100, max: maximumOil / weightG * 100 },
        assumptions: [
          `${scenario.label}档假设实际摄入油量为参考油量的 ${scenario.minFactor}–${scenario.maxFactor} 倍。`,
          '油量档位是应用情景假设，非食品实测标准；记录热量采用所选区间中值。',
        ],
      };
    }),
  };
  return nutritionEstimateProfileSchema.parse(profile);
}
/**
 * 把参考配方按成品重量缩放，生成带每种原料营养与来源的独立快照。
 * ingredientOverrides是用户明确填写的配料克数，此时不再叠加油三档的情景假设。
 * 计算出来的每100g值以本次成品重量为分母，不推测烹调蒸发或吸水后的重量。
 */
export function createRecipeEntry(recipe: Recipe, weightG: number, ingredientOverrides: Record<string, number> = {}): FoodEntry {
  if (!Number.isFinite(weightG) || weightG <= 0 || weightG > 20000) throw new Error('配方份量必须是大于 0 至 20000 g');
  const factor = weightG / recipe.referenceWeightG;
  const ingredients = recipe.ingredients.map((ingredient) => {
    const food = foodsById.get(ingredient.foodId);
    if (!food) throw new Error(`配方缺少食物数据：${ingredient.foodId}`);
    const ingredientWeight = ingredientOverrides[ingredient.id] ?? ingredient.weightG * factor;
    if (!Number.isFinite(ingredientWeight) || ingredientWeight < 0 || ingredientWeight > 20000) throw new Error('配料重量必须是 0 至 20000 g');
    return {
      id: ingredient.id, foodId: food.id, name: food.name, weightG: ingredientWeight,
      nutrientsPer100g: { ...food.nutrientsPer100g },
      provenance: foodProvenance(food),
      note: ingredient.note,
    };
  });
  const snapshot: RecipeSnapshot = {
    recipeId: recipe.id, name: recipe.name, referenceWeightG: weightG, ingredients,
    warnings: [...recipe.warnings],
  };
  const nutrientsPer100g = emptyNutrients();
  for (const key of nutrientKeys) {
    // 设为 0 g 的配料没有被吃掉，不使整道菜的营养数值变为缺失。
    nutrientsPer100g[key] = ingredients.some((item) => item.weightG > 0 && item.nutrientsPer100g[key] === null) ? null
      : ingredients.reduce((total, item) => total + (item.nutrientsPer100g[key] ?? 0) * item.weightG / 100, 0) / weightG * 100;
  }
  const entry: FoodEntry = {
    id: createId(), name: recipe.name, weightG, nutrientsPer100g,
    provenance: '参考配方 + USDA 基础食物；配比为假设，请确认实际配料与食用油。',
    kind: 'recipe', referenceId: recipe.id, recipeSnapshot: snapshot, warnings: [...recipe.warnings],
  };
  // 明确传入的配料重量是用户确定值，不再次套用油量范围。
  if (Object.keys(ingredientOverrides).length === 0) {
    const profile = createRecipeOilProfile(snapshot, weightG);
    if (profile) {
      entry.estimateProfile = profile;
      return applyEstimateLevel(entry, 'medium');
    }
  }
  return entry;
}
