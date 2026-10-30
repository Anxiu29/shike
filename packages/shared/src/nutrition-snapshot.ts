/**
 * 共享计算层不依赖Vue/HTTP/数据库：给定FoodEntry快照，返回营养，便于独立测试。
 * 普通食物按每100g×可食重量/100；包装交给package-label，容量快照按每100mL换算。
 * 这里仅包含快照计算；需要完整食品库的新记录工厂在nutrition-catalog.ts。
 * 此依赖边界决定首页是否要下载食品库，新增功能时不要在这里导入food-data。
 * 三档区间按选中档取中值记账；切档只改本地快照，油档替换原配料，不能再加一份油。
 * calculateNutrients保留null，aggregateNutrients返回known/missing，未知与明确0分别处理。
 * 修改公式可先读shared/tests/nutrition.test.ts及estimate-ranges.test.ts中的边界案例。
 */
import { createId } from './id.js';
import { packageNutrients } from './package-label.js';
import {
  estimatedFoodSchema, normalizeFoodName, numericRangeSchema, nutrientRangesSchema, nutritionEstimateProfileSchema,
  type EstimateLevel, type EstimatedFood, type FoodEntry, type NumericRange, type NutrientRanges,
  type Nutrients, type NutritionEstimateOption, type NutritionEstimateProfile,
} from './schemas.js';

export const nutrientKeys = ['energyKcal', 'proteinG', 'fatG', 'carbsG'] as const;
/** 用null表示尚不知道的数据；返回新对象，避免多个条目共享同一个可修改的空值模板。 */
export const emptyNutrients = (): Nutrients => ({ energyKcal: null, proteinG: null, fatG: null, carbsG: null });
export function findEstimatedFood(name: string, estimatedFoods: EstimatedFood[]): EstimatedFood | undefined {
  const normalized = normalizeFoodName(name);
  return estimatedFoods.find((food) => normalizeFoodName(food.name) === normalized);
}
/** 区间先通过运行时校验，再取算术中值记账；null仍是未知，不是0。 */
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
/**
 * 把选中档位的每100g区间缩放到实际摄入量，例如40～60 kcal/100g、吃200g得到80～120。
 * 该区间是已保存的情景假设，不是统计置信区间；没有档位/重量时不伪造范围。
 */
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
// 历史记录只使用保存时的营养快照，不用最新数据库重新匹配。
export function calculateNutrients(entry: FoodEntry): Nutrients {
  // 顺序有业务含义：容量、包装标签各自保留基准，不能直接套普通食物的每100g公式。
  if (entry.volumeSnapshot) {
    const { amountMl, nutrientsPer100ml } = entry.volumeSnapshot, result = emptyNutrients();
    for (const key of nutrientKeys) result[key] = amountMl === 0 ? 0 : amountMl === null || nutrientsPer100ml[key] === null ? null : nutrientsPer100ml[key]! * amountMl / 100;
    return result;
  }
  if (entry.kind === 'label' && entry.packageSnapshot) return packageNutrients(entry.packageSnapshot);
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
/**
 * 分别累加每个营养项已知的部分，并记录缺失项数。
 * 例如两项蛋白质为3g和null，结果是known=3、missing=1；不能展示成“总蛋白质3g”。
 * incompleteEntries按“食物条目”计数，不是把四个营养项的missing简单相加。
 */
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

