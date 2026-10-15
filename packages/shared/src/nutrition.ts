import { foods, type FoodDefinition } from './food-data.js';
import { recipes, type Recipe } from './recipes.js';
import { createId } from './id.js';
import {
  estimatedFoodSchema, normalizeFoodName, numericRangeSchema, nutrientRangesSchema, nutritionEstimateProfileSchema,
  type EstimateLevel, type EstimatedFood, type FoodEntry, type NumericRange, type NutrientRanges,
  type Nutrients, type NutritionEstimateOption, type NutritionEstimateProfile, type RecipeSnapshot,
} from './schemas.js';

export const nutrientKeys = ['energyKcal', 'proteinG', 'fatG', 'carbsG'] as const;
export const emptyNutrients = (): Nutrients => ({ energyKcal: null, proteinG: null, fatG: null, carbsG: null });
// 大食物库用索引查找，避免每次识别／配方换算都遍历几千条记录。
const foodsById = new Map(foods.map(food => [food.id, food]));
const foodsByName = new Map<string, FoodDefinition>();
for (const food of foods) for (const label of [food.name, ...food.aliases]) {
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
export function findEstimatedFood(name: string, estimatedFoods: EstimatedFood[]): EstimatedFood | undefined {
  const normalized = normalizeFoodName(name);
  return estimatedFoods.find((food) => normalizeFoodName(food.name) === normalized);
}
export function rangeMidpoint(range: NumericRange): number;
export function rangeMidpoint(range: null): null;
export function rangeMidpoint(range: NumericRange | null): number | null;
export function rangeMidpoint(range: NumericRange | null): number | null {
  if (range === null) return null;
  const parsed = numericRangeSchema.parse(range);
  return (parsed.min + parsed.max) / 2;
}
export function rangesToMidpoints(ranges: NutrientRanges): Nutrients {
  const parsed = nutrientRangesSchema.parse(ranges);
  return {
    energyKcal: rangeMidpoint(parsed.energyKcal), proteinG: rangeMidpoint(parsed.proteinG),
    fatG: rangeMidpoint(parsed.fatG), carbsG: rangeMidpoint(parsed.carbsG),
  };
}
export function selectedEstimateOption(profile: NutritionEstimateProfile, level: EstimateLevel = 'medium'): NutritionEstimateOption {
  const parsed = nutritionEstimateProfileSchema.parse(profile);
  const option = parsed.options.find((item) => item.level === level);
  if (!option) throw new Error('找不到选中的估算档位');
  return option;
}
/** 返回独立的新记录。区间中值记账，所有选中假设与 AI 来源快照同步。 */
export function applyEstimateLevel(entry: FoodEntry, level: EstimateLevel): FoodEntry {
  if (!entry.estimateProfile) throw new Error('该记录没有三档估算资料');
  // Vue 编辑器可能传入 Proxy，structuredClone(Proxy) 会抛 DataCloneError。
  // 按领域结构复制，既兼容响应式对象，也隔离历史快照里的所有可修改数组。
  const result: FoodEntry = {
    ...entry,
    nutrientsPer100g: { ...entry.nutrientsPer100g },
    warnings: [...entry.warnings],
  };
  if (entry.aiEstimateSnapshot) {
    result.aiEstimateSnapshot = {
      ...entry.aiEstimateSnapshot,
      nutrientsPer100g: { ...entry.aiEstimateSnapshot.nutrientsPer100g },
      assumptions: [...entry.aiEstimateSnapshot.assumptions],
    };
  }
  if (entry.recipeSnapshot) {
    result.recipeSnapshot = {
      ...entry.recipeSnapshot,
      ingredients: entry.recipeSnapshot.ingredients.map((ingredient) => ({
        ...ingredient, nutrientsPer100g: { ...ingredient.nutrientsPer100g },
      })),
      warnings: [...entry.recipeSnapshot.warnings],
    };
  }
  result.estimateProfile = nutritionEstimateProfileSchema.parse(entry.estimateProfile);
  result.estimateLevel = level;
  const selected = selectedEstimateOption(result.estimateProfile, level);
  result.nutrientsPer100g = rangesToMidpoints(selected.rangesPer100g);
  if (result.kind === 'recipe' && result.recipeSnapshot && selected.oilWeightPer100g) {
    const oil = result.recipeSnapshot.ingredients.find((ingredient) => ingredient.id === 'oil');
    if (!oil) throw new Error('参考配方缺少独立食用油配料');
    if (result.weightG === null) throw new Error('请先填写成品可食重量，再调整油量档位');
    oil.weightG = rangeMidpoint(selected.oilWeightPer100g) * result.weightG / 100;
  }
  if (result.aiEstimateSnapshot) {
    result.aiEstimateSnapshot.nutrientsPer100g = { ...result.nutrientsPer100g };
    result.aiEstimateSnapshot.assumptions = [...selected.assumptions];
  }
  // 保留照片本身的不确定提示；只替换旧档位的假设，避免同时显示互相冲突的档位。
  const oldAssumptions = new Set([
    ...entry.estimateProfile.options.flatMap((option) => option.assumptions),
    ...(entry.aiEstimateSnapshot?.assumptions ?? []),
  ]);
  result.warnings = [...new Set([...entry.warnings.filter((warning) => !oldAssumptions.has(warning)), ...selected.assumptions])].slice(0, 30);
  return result;
}
export function calculateEnergyRange(entry: FoodEntry): NumericRange | null {
  if (!entry.estimateProfile || entry.weightG === null) return null;
  if (!Number.isFinite(entry.weightG) || entry.weightG < 0 || entry.weightG > 20000) return null;
  if (entry.weightG === 0) return { min: 0, max: 0 };
  const range = selectedEstimateOption(entry.estimateProfile, entry.estimateLevel ?? 'medium').rangesPer100g.energyKcal;
  if (!range) return null;
  return { min: range.min * entry.weightG / 100, max: range.max * entry.weightG / 100 };
}
export function createEstimatedFoodEntry(food: EstimatedFood, weightG: number | null): FoodEntry {
  const parsed = estimatedFoodSchema.parse(food);
  if (weightG !== null && (!Number.isFinite(weightG) || weightG < 0 || weightG > 20000)) {
    throw new Error('食物重量必须是 0 至 20000 g，或留空待补充');
  }
  // 双份独立快照避免用户更新个人食物库后改写以前的日摄入记录。
  const entry: FoodEntry = {
    id: createId(), name: parsed.name, weightG,
    nutrientsPer100g: { ...parsed.nutrientsPer100g },
    provenance: parsed.provenance, kind: 'ai', referenceId: parsed.id,
    aiEstimateSnapshot: {
      nutrientsPer100g: { ...parsed.nutrientsPer100g }, assumptions: [...parsed.assumptions],
      provider: parsed.provider, model: parsed.model,
    },
    warnings: ['AI 粗估，不是实测数据；请确认配方、食用油、糖和含水量。', ...parsed.assumptions].slice(0, 30),
  };
  if (parsed.estimateProfile) {
    entry.estimateProfile = structuredClone(parsed.estimateProfile);
    return applyEstimateLevel(entry, parsed.estimateLevel ?? 'medium');
  }
  return entry;
}
export function createFoodEntry(food: FoodDefinition, weightG: number | null): FoodEntry {
  if (weightG !== null && (!Number.isFinite(weightG) || weightG < 0 || weightG > 20000)) {
    throw new Error('食物重量必须是 0 至 20000 g，或留空待补充');
  }
  return {
    id: createId(), name: food.name, weightG,
    nutrientsPer100g: { ...food.nutrientsPer100g },
    provenance: `${food.source.dataset} ${food.source.version} · FDC ${food.source.fdcId} · ${food.source.description}`,
    kind: 'database', referenceId: food.id, warnings: [
      ...(food.state === 'raw' ? ['此数据对应生食／生重；熟食需选择相符的数据或配方。'] : []),
      ...(food.source.dataset === 'USDA FNDDS' ? ['USDA 膳食调查参考，可能采用美国常见配方；请核对具体做法、糖、油和品牌，不能视为这份食物的实测值。'] : []),
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
      provenance: `${food.source.dataset} ${food.source.version} · FDC ${food.source.fdcId}`,
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
// 历史记录只使用保存时的营养快照，不用最新数据库重新匹配。
export function calculateNutrients(entry: FoodEntry): Nutrients {
  const result = emptyNutrients();
  for (const key of nutrientKeys) {
    const per100g = entry.nutrientsPer100g[key];
    result[key] = entry.weightG === 0 ? 0
      : entry.weightG === null || per100g === null ? null : per100g * entry.weightG / 100;
  }
  return result;
}
export interface NutrientAggregateValue { known: number; missing: number }
export type NutrientAggregate = Record<keyof Nutrients, NutrientAggregateValue> & { incompleteEntries: number };
export function aggregateNutrients(entries: FoodEntry[]): NutrientAggregate {
  const aggregate: NutrientAggregate = {
    energyKcal: { known: 0, missing: 0 }, proteinG: { known: 0, missing: 0 },
    fatG: { known: 0, missing: 0 }, carbsG: { known: 0, missing: 0 }, incompleteEntries: 0,
  };
  for (const entry of entries) {
    const nutrients = calculateNutrients(entry);
    if (nutrientKeys.some((key) => nutrients[key] === null)) aggregate.incompleteEntries++;
    for (const key of nutrientKeys) {
      if (nutrients[key] === null) aggregate[key].missing++;
      else aggregate[key].known += nutrients[key];
    }
  }
  return aggregate;
}
