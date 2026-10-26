import { describe, expect, it } from 'vitest';
import {
  applyEstimateLevel, backupSchema, calculateEnergyRange, calculateNutrients,
  createEstimatedFoodEntry, createFoodEntry, createRecipeEntry, estimatedFoodSchema,
  findFood, findRecipe, foodEntrySchema, nutrientRangesSchema, nutritionEstimateProfileSchema,
  rangeMidpoint, rangesToMidpoints, recognitionResultSchema, recipes, selectedEstimateOption,
  type EstimatedFood, type FoodEntry, type NutritionEstimateProfile,
} from '../src/index.js';

const timestamp = '2026-10-14T08:00:00.000Z';
// 这是接口行为测试的情景假设，不是小米粥的食品实测标准。
const porridgeProfile = (): NutritionEstimateProfile => ({
  factor: 'general',
  options: [
    { level: 'high', label: '浓稠', rangesPer100g: { energyKcal: { min: 90, max: 120 }, proteinG: { min: 2, max: 3 }, fatG: null, carbsG: { min: 18, max: 24 } }, assumptions: ['测试假设：浓稠、无额外糖'] },
    { level: 'low', label: '稀薄', rangesPer100g: { energyKcal: { min: 40, max: 60 }, proteinG: { min: 0.5, max: 1 }, fatG: null, carbsG: { min: 8, max: 12 } }, assumptions: ['测试假设：稀薄、无额外糖'] },
    { level: 'medium', label: '普通', rangesPer100g: { energyKcal: { min: 60, max: 90 }, proteinG: { min: 1, max: 2 }, fatG: null, carbsG: { min: 12, max: 18 } }, assumptions: ['测试假设：普通浓度、无额外糖'] },
  ],
});
const estimatedFood = (): EstimatedFood => ({
  id: 'ai-porridge', name: '自制粥',
  nutrientsPer100g: { energyKcal: 75, proteinG: 1.5, fatG: null, carbsG: 15 },
  assumptions: ['测试假设：普通浓度、无额外糖'],
  provenance: 'AI 粗估，非实测', provider: 'mock', model: 'mock-test',
  createdAt: timestamp, updatedAt: timestamp, estimateProfile: porridgeProfile(),
});
const backup = (entry: FoodEntry, food?: EstimatedFood) => ({
  schemaVersion: 2 as const, exportedAt: timestamp,
  meals: [{ id: 'meal-range', date: '2026-10-14', mealType: 'breakfast', items: [entry], mode: 'mock', createdAt: timestamp, updatedAt: timestamp }],
  weights: [], settings: { targetWeightKg: null }, estimatedFoods: food ? [food] : [],
});

describe('AI 三档范围与记账中值', () => {
  it('区间中值不提前取整，未知营养保留 null', () => {
    expect(rangeMidpoint({ min: 40.1, max: 60.2 })).toBeCloseTo(50.15, 10);
    expect(rangeMidpoint(null)).toBeNull();
    expect(rangesToMidpoints(selectedEstimateOption(porridgeProfile()).rangesPer100g))
      .toEqual({ energyKcal: 75, proteinG: 1.5, fatG: null, carbsG: 15 });
  });
  it('默认 medium，按 low/medium/high 顺序展示，按份量缩放', () => {
    const parsed = estimatedFoodSchema.parse(estimatedFood());
    expect(parsed.estimateLevel).toBe('medium');
    expect(parsed.estimateProfile!.options.map((option) => option.level)).toEqual(['low', 'medium', 'high']);
    const entry = createEstimatedFoodEntry(estimatedFood(), 200);
    expect(entry.estimateLevel).toBe('medium');
    expect(calculateNutrients(entry).energyKcal).toBe(150);
    expect(calculateEnergyRange(entry)).toEqual({ min: 120, max: 180 });
    expect(calculateEnergyRange({ ...entry, weightG: 300 })).toEqual({ min: 180, max: 270 });
  });
  it('切档同步记录与 AI 快照，并保留原对象、ID、重量和来源', () => {
    const original = createEstimatedFoodEntry(estimatedFood(), 200);
    const high = applyEstimateLevel(original, 'high');
    expect(high.id).toBe(original.id);
    expect(high.weightG).toBe(200);
    expect(high.provenance).toBe(original.provenance);
    expect(calculateNutrients(high).energyKcal).toBe(210);
    expect(calculateEnergyRange(high)).toEqual({ min: 180, max: 240 });
    expect(high.aiEstimateSnapshot!.nutrientsPer100g.energyKcal).toBe(105);
    expect(high.aiEstimateSnapshot!.assumptions).toEqual(['测试假设：浓稠、无额外糖']);
    expect(high.warnings).not.toContain('测试假设：普通浓度、无额外糖');
    expect(original.estimateLevel).toBe('medium');
    expect(original.nutrientsPer100g.energyKcal).toBe(75);
  });
  it('复制完整三档资料；源库更新不改变旧记录', () => {
    const food = estimatedFood();
    const entry = createEstimatedFoodEntry(food, 200);
    food.estimateProfile!.options[0]!.rangesPer100g.energyKcal!.max = 999;
    expect(calculateEnergyRange(applyEstimateLevel(entry, 'high'))).toEqual({ min: 180, max: 240 });
  });
  it('切档接受响应式 Proxy，不因 structuredClone(Proxy) 失败', () => {
    const entry = createEstimatedFoodEntry(estimatedFood(), 200);
    const reactiveLike = new Proxy(entry, {});
    expect(applyEstimateLevel(reactiveLike, 'low').nutrientsPer100g.energyKcal).toBe(50);
    expect(entry.nutrientsPer100g.energyKcal).toBe(75);
  });
  it('拒绝倒置、非有限或越界区间、重复档位及档位没有对应 profile', () => {
    const profile = porridgeProfile();
    expect(nutrientRangesSchema.safeParse({ ...profile.options[0]!.rangesPer100g, energyKcal: { min: 80, max: 60 } }).success).toBe(false);
    expect(nutrientRangesSchema.safeParse({ ...profile.options[0]!.rangesPer100g, energyKcal: { min: 0, max: Infinity } }).success).toBe(false);
    expect(nutrientRangesSchema.safeParse({ ...profile.options[0]!.rangesPer100g, fatG: { min: 0, max: 101 } }).success).toBe(false);
    expect(nutritionEstimateProfileSchema.safeParse({ ...profile, options: [profile.options[0], profile.options[0], profile.options[2]] }).success).toBe(false);
    const entry = createFoodEntry(findFood('米饭')!, 100);
    expect(foodEntrySchema.safeParse({ ...entry, estimateLevel: 'low' }).success).toBe(false);
    expect(() => applyEstimateLevel(entry, 'low')).toThrow();
  });
  it('确定的单值和旧记录不伪造区间，未知重量或热量范围保持未知', () => {
    const rice = createFoodEntry(findFood('米饭')!, 100);
    expect(calculateEnergyRange(rice)).toBeNull();
    const entry = createEstimatedFoodEntry(estimatedFood(), null);
    expect(calculateEnergyRange(entry)).toBeNull();
    const food = estimatedFood();
    food.estimateProfile!.options[2]!.rangesPer100g.energyKcal = null;
    food.nutrientsPer100g.energyKcal = null;
    const unknown = createEstimatedFoodEntry(food, 200);
    expect(unknown.nutrientsPer100g.energyKcal).toBeNull();
    expect(calculateEnergyRange(unknown)).toBeNull();
    const manual = { ...createEstimatedFoodEntry(estimatedFood(), 200), kind: 'manual' as const, nutrientsPer100g: { energyKcal: 80, proteinG: 2, fatG: 0.5, carbsG: 16 } };
    delete manual.estimateProfile;
    delete manual.estimateLevel;
    expect(calculateEnergyRange(manual)).toBeNull();
    expect(calculateNutrients(manual).energyKcal).toBe(160);
  });
  it('Recognition 旧字段与备份 v1/v2 兼容，新的范围完整保存在 v2', () => {
    const oldRecognition = recognitionResultSchema.parse({ isFood: true, foods: [{ name: '粥', estimatedWeightG: 200,
      visibleIngredients: [], uncertainties: [], estimatedNutrientsPer100g: estimatedFood().nutrientsPer100g,
      nutritionAssumptions: [] }], uncertainties: [] });
    expect(oldRecognition.foods[0]!.nutritionEstimateProfile).toBeNull();
    const food = estimatedFood();
    const entry = applyEstimateLevel(createEstimatedFoodEntry(food, 200), 'high');
    const current = backup(entry, { ...food, estimateLevel: 'high', nutrientsPer100g: { ...entry.nutrientsPer100g } });
    const parsed = backupSchema.parse(JSON.parse(JSON.stringify(current)));
    expect(parsed.schemaVersion).toBe(10);
    expect(parsed.meals[0]!.items[0]!.estimateLevel).toBe('high');
    expect(parsed.estimatedFoods[0]!.estimateProfile!.options).toHaveLength(3);
    const rice = createFoodEntry(findFood('米饭')!, 150);
    const oldV2 = backup(rice);
    expect(backupSchema.parse(oldV2)).toEqual({ ...oldV2, schemaVersion: 10, libraryFoods: [], packagedFoods: [], water: [], exercises: [], dailyPlans: [] });
    const { estimatedFoods: _foods, ...oldV1 } = oldV2;
    expect(backupSchema.parse({ ...oldV1, schemaVersion: 1 })).toEqual(backupSchema.parse(oldV2));
  });
  it('拒绝范围与记账点值／AI 快照冲突，允许 1e-7 内的浮点误差', () => {
    const entry = createEstimatedFoodEntry(estimatedFood(), 200);
    expect(foodEntrySchema.safeParse({ ...entry, nutrientsPer100g: { ...entry.nutrientsPer100g, energyKcal: 50 } }).success).toBe(false);
    expect(estimatedFoodSchema.safeParse({ ...estimatedFood(), estimateLevel: 'high' }).success).toBe(false);
    expect(foodEntrySchema.safeParse({ ...entry, aiEstimateSnapshot: { ...entry.aiEstimateSnapshot!, nutrientsPer100g: { ...entry.nutrientsPer100g, energyKcal: 50 } } }).success).toBe(false);
    expect(foodEntrySchema.safeParse({ ...entry, nutrientsPer100g: { ...entry.nutrientsPer100g, energyKcal: 75 + 5e-8 } }).success).toBe(true);
    expect(foodEntrySchema.safeParse({ ...entry, nutrientsPer100g: { ...entry.nutrientsPer100g, fatG: 0 } }).success).toBe(false);
    expect(foodEntrySchema.safeParse({ ...entry, kind: 'manual' }).success).toBe(false);
    const malformedBackup = backup({ ...entry, nutrientsPer100g: { ...entry.nutrientsPer100g, energyKcal: 50 } });
    expect(backupSchema.safeParse(malformedBackup).success).toBe(false);
  });
  it('能量范围按低中高单调；相同退化档和未知范围允许', () => {
    const reversed = porridgeProfile();
    reversed.options[1]!.rangesPer100g.energyKcal = { min: 100, max: 130 };
    expect(nutritionEstimateProfileSchema.safeParse(reversed).success).toBe(false);
    const zero = porridgeProfile();
    for (const option of zero.options) option.rangesPer100g.energyKcal = { min: 0, max: 0 };
    expect(nutritionEstimateProfileSchema.safeParse(zero).success).toBe(true);
    zero.options[0]!.rangesPer100g.energyKcal = null;
    expect(nutritionEstimateProfileSchema.safeParse(zero).success).toBe(true);
  });
  it('0 g 的估算份量为 [0,0]，即使能量未知；没有范围仍不伪造', () => {
    const food = estimatedFood();
    food.estimateProfile!.options[2]!.rangesPer100g.energyKcal = null;
    food.nutrientsPer100g.energyKcal = null;
    const zero = createEstimatedFoodEntry(food, 0);
    expect(calculateEnergyRange(zero)).toEqual({ min: 0, max: 0 });
    expect(calculateNutrients(zero).energyKcal).toBe(0);
    expect(calculateEnergyRange(createFoodEntry(findFood('米饭')!, 0))).toBeNull();
  });
});

describe('本地参考配方油量三档', () => {
  it('每个配方默认普通档中值维持原配方和独立油重量', () => {
    for (const recipe of recipes) {
      const entry = createRecipeEntry(recipe, recipe.referenceWeightG);
      if (!recipe.ingredients.some(ingredient => ingredient.id === 'oil')) {
        expect(entry.estimateProfile).toBeUndefined();
        expect(foodEntrySchema.safeParse(entry).success).toBe(true);
        continue;
      }
      expect(entry.estimateProfile!.factor).toBe('oil');
      expect(entry.estimateLevel).toBe('medium');
      expect(foodEntrySchema.safeParse(entry).success).toBe(true);
      expect(entry.recipeSnapshot!.ingredients.find((ingredient) => ingredient.id === 'oil')!.weightG)
        .toBeCloseTo(recipe.ingredients.find((ingredient) => ingredient.id === 'oil')!.weightG);
      const expected = entry.recipeSnapshot!.ingredients.reduce((sum, ingredient) => sum + ingredient.nutrientsPer100g.energyKcal! * ingredient.weightG / 100, 0);
      expect(calculateNutrients(entry).energyKcal).toBeCloseTo(expected);
    }
  });
  it('少油／多油只修改油一次，热量端点为非油总量加相应油量', () => {
    const recipe = findRecipe('清炒西兰花')!;
    const entry = createRecipeEntry(recipe, 208);
    const low = applyEstimateLevel(entry, 'low');
    const high = applyEstimateLevel(entry, 'high');
    expect(low.recipeSnapshot!.ingredients.find((ingredient) => ingredient.id === 'oil')!.weightG).toBeCloseTo(5.2);
    expect(high.recipeSnapshot!.ingredients.find((ingredient) => ingredient.id === 'oil')!.weightG).toBeCloseTo(11.2);
    const nonOil = 200 * findFood('西兰花')!.nutrientsPer100g.energyKcal! / 100;
    const oilPer100g = findFood('大豆油')!.nutrientsPer100g.energyKcal!;
    expect(calculateEnergyRange(low)?.min).toBeCloseTo(nonOil + 4 * oilPer100g / 100);
    expect(calculateEnergyRange(low)?.max).toBeCloseTo(nonOil + 6.4 * oilPer100g / 100);
    expect(calculateNutrients(high).energyKcal).toBeCloseTo(nonOil + 11.2 * oilPer100g / 100);
  });
  it('换重后再切档保持真实油克数和中值；确定配料 override 没有范围', () => {
    const recipe = findRecipe('清炒西兰花')!;
    const full = applyEstimateLevel(createRecipeEntry(recipe, 208), 'high');
    const half = applyEstimateLevel(createRecipeEntry(recipe, 104), 'high');
    expect(half.recipeSnapshot!.ingredients.find((ingredient) => ingredient.id === 'oil')!.weightG).toBeCloseTo(5.6);
    expect(calculateNutrients(half).energyKcal).toBeCloseTo(calculateNutrients(full).energyKcal! / 2);
    expect(calculateEnergyRange(half)?.max).toBeCloseTo(calculateEnergyRange(full)!.max / 2);
    const fixed = createRecipeEntry(recipe, 208, { oil: 2 });
    expect(fixed.estimateProfile).toBeUndefined();
    expect(calculateEnergyRange(fixed)).toBeNull();
  });
});
