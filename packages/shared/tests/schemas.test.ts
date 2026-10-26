import { describe, expect, it } from 'vitest';
import {
  aiEstimateSnapshotSchema, backupSchema, createEstimatedFoodEntry, createFoodEntry, dateSchema,
  estimatedFoodSchema, findEstimatedFood, findFood, normalizeFoodName, nutrientsSchema,
  recognitionResultSchema, type Backup, type EstimatedFood,
} from '../src/index.js';

const timestamp = '2026-10-14T02:00:00.000Z';
const backup = (): Backup => ({
  schemaVersion: 10, libraryFoods: [], packagedFoods: [], exportedAt: timestamp, water: [], exercises: [], dailyPlans: [],
  meals: [{ id: 'meal-1', date: '2026-10-14', mealType: 'lunch',
    items: [createFoodEntry(findFood('米饭')!, 150)], mode: 'manual', createdAt: timestamp, updatedAt: timestamp }],
  weights: [{ date: '2026-10-14', weightKg: 65.5, updatedAt: timestamp }],
  settings: { targetWeightKg: 60 },
  estimatedFoods: [],
});
const estimatedFood = (): EstimatedFood => ({
  id: 'estimated-food-1', name: '自制小米粥',
  nutrientsPer100g: { energyKcal: 45, proteinG: 1, fatG: null, carbsG: 8.5 },
  provenance: 'AI 粗估 · gemini · 浓度未知，非实测', assumptions: ['假设无糖、无额外油；含水量不确定'],
  provider: 'gemini', model: 'test-model', createdAt: timestamp, updatedAt: timestamp,
});

describe('共享结构校验', () => {
  it('接受食物结果和明确无食物的结果', () => {
    expect(recognitionResultSchema.safeParse({ isFood: true, foods: [{ name: '米饭', estimatedWeightG: null,
      visibleIngredients: [], uncertainties: ['缺少比例尺，重量无法估计'] }], uncertainties: [] }).success).toBe(true);
    expect(recognitionResultSchema.safeParse({ isFood: false, foods: [], uncertainties: ['没有可确定的食物'] }).success).toBe(true);
  });
  it('旧识别 JSON 自动补空估算字段，新估算按每 100 g 严格校验', () => {
    const oldResult = { isFood: true, foods: [{ name: '小米粥', estimatedWeightG: 200,
      visibleIngredients: [], uncertainties: [] }], uncertainties: [] };
    const parsed = recognitionResultSchema.parse(oldResult);
    expect(parsed.foods[0]!.estimatedNutrientsPer100g).toBeNull();
    expect(parsed.foods[0]!.nutritionAssumptions).toEqual([]);
    const newResult = { ...oldResult, foods: [{ ...oldResult.foods[0]!,
      estimatedNutrientsPer100g: estimatedFood().nutrientsPer100g,
      nutritionAssumptions: estimatedFood().assumptions }] };
    expect(recognitionResultSchema.parse(newResult).foods[0]!.estimatedNutrientsPer100g?.fatG).toBeNull();
    expect(recognitionResultSchema.safeParse({ ...newResult, foods: [{ ...newResult.foods[0]!,
      estimatedNutrientsPer100g: { ...estimatedFood().nutrientsPer100g, energyKcal: 1001 } }] }).success).toBe(false);
  });
  it('拒绝负重量、过多条目、外部模型伪造营养字段及非食物却含食物', () => {
    const food = { name: '米饭', estimatedWeightG: 100, visibleIngredients: [], uncertainties: [] };
    expect(recognitionResultSchema.safeParse({ isFood: true, foods: [{ ...food, estimatedWeightG: -1 }], uncertainties: [] }).success).toBe(false);
    expect(recognitionResultSchema.safeParse({ isFood: true, foods: Array(31).fill(food), uncertainties: [] }).success).toBe(false);
    expect(recognitionResultSchema.safeParse({ isFood: true, foods: [{ ...food, calories: 100 }], uncertainties: [] }).success).toBe(false);
    expect(recognitionResultSchema.safeParse({ isFood: false, foods: [food], uncertainties: [] }).success).toBe(false);
  });
  it('校验真实日期和有限营养值', () => {
    expect(dateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(dateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(dateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(nutrientsSchema.safeParse({ energyKcal: Infinity, proteinG: 1, fatG: 2, carbsG: 3 }).success).toBe(false);
    expect(nutrientsSchema.safeParse({ energyKcal: 100, proteinG: 101, fatG: 2, carbsG: 3 }).success).toBe(false);
  });
  it('JSON 备份往返保留快照与缺失值', () => {
    const data = backup();
    data.meals[0]!.items[0]!.nutrientsPer100g.fatG = null;
    expect(backupSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it('百炼个人估算与历史营养快照可导出恢复，兼容旧供应商', () => {
    const food = { ...estimatedFood(), provider: 'qwen' as const, model: 'qwen3.7-flash' };
    const entry = createEstimatedFoodEntry(food, 200);
    const data = backup();
    data.estimatedFoods = [food];
    data.meals[0]!.items = [entry];
    const restored = backupSchema.parse(JSON.parse(JSON.stringify(data)));
    expect(restored.estimatedFoods[0]!.provider).toBe('qwen');
    expect(restored.meals[0]!.items[0]!.aiEstimateSnapshot?.provider).toBe('qwen');
    expect(restored.meals[0]!.items[0]!.nutrientsPer100g).toEqual(food.nutrientsPer100g);
    expect(estimatedFoodSchema.parse(estimatedFood()).provider).toBe('gemini');
  });
  it('旧 v1 备份自动升级为 v2，旧 FoodEntry 保持原营养快照', () => {
    const data = backup();
    const { libraryFoods: _libraryFoods, packagedFoods: _packagedFoods, estimatedFoods: _estimatedFoods, water: _water, exercises: _exercises, dailyPlans: _plans, ...old } = data;
    const parsed = backupSchema.parse({ ...old, schemaVersion: 1 });
    expect(parsed).toEqual(data);
    expect(parsed.estimatedFoods).toEqual([]);
    expect(parsed.meals[0]!.items[0]!.kind).toBe('database');
  });
  it('拒绝错误版本、重复主键与未经声明的照片字段', () => {
    const data = backup();
    expect(backupSchema.safeParse({ ...data, schemaVersion: 99 }).success).toBe(false);
    expect(backupSchema.safeParse({ ...data, meals: [data.meals[0], data.meals[0]] }).success).toBe(false);
    expect(backupSchema.safeParse({ ...data, weights: [data.weights[0], data.weights[0]] }).success).toBe(false);
    expect(backupSchema.safeParse({ ...data, photo: 'base64' }).success).toBe(false);
  });
  it('v2 备份拒绝个人估算库的重复 ID 或规范化名称', () => {
    const data = backup();
    const food = estimatedFood();
    expect(backupSchema.safeParse({ ...data, estimatedFoods: [food] }).success).toBe(true);
    expect(backupSchema.safeParse({ ...data, estimatedFoods: [food, { ...food, name: '另一个食物' }] }).success).toBe(false);
    expect(backupSchema.safeParse({ ...data, estimatedFoods: [food, { ...food, id: 'different-id', name: ' 自制 小米粥 ' }] }).success).toBe(false);
  });
});

describe('个人 AI 粗估库与历史快照', () => {
  it('有限范围、null 和来源通过校验；超范围／负数／非有限数值被拒绝', () => {
    const food = estimatedFood();
    expect(estimatedFoodSchema.parse(food)).toEqual(food);
    for (const invalid of [-1, Infinity, NaN, 1001]) {
      expect(estimatedFoodSchema.safeParse({ ...food, nutrientsPer100g: { ...food.nutrientsPer100g, energyKcal: invalid } }).success).toBe(false);
    }
    expect(estimatedFoodSchema.safeParse({ ...food, nutrientsPer100g: { ...food.nutrientsPer100g, fatG: 101 } }).success).toBe(false);
    expect(aiEstimateSnapshotSchema.safeParse({ nutrientsPer100g: food.nutrientsPer100g,
      assumptions: food.assumptions, provider: 'unknown', model: food.model }).success).toBe(false);
  });
  it('按规范化精确名称匹配，并保持生熟和含糖区别', () => {
    const food = estimatedFood();
    expect(findEstimatedFood(' 自制 小米粥 ', [food])?.id).toBe(food.id);
    expect(findEstimatedFood('自制含糖小米粥', [food])).toBeUndefined();
    expect(findEstimatedFood('生自制小米粥', [food])).toBeUndefined();
    expect(normalizeFoodName('小米粥（熟）')).toBe(normalizeFoodName('小米粥 (熟)'));
    expect(normalizeFoodName('小米粥（熟）')).not.toBe(normalizeFoodName('小米粥（生）'));
  });
  it('保存 AI 来源标识与独立快照，修改估算库不改写旧记录', () => {
    const food = estimatedFood();
    const entry = createEstimatedFoodEntry(food, 200);
    expect(entry.kind).toBe('ai');
    expect(entry.referenceId).toBe(food.id);
    expect(entry.warnings[0]).toContain('不是实测');
    food.nutrientsPer100g.energyKcal = 100;
    food.assumptions.push('后续修改');
    expect(entry.nutrientsPer100g.energyKcal).toBe(45);
    expect(entry.aiEstimateSnapshot!.nutrientsPer100g.energyKcal).toBe(45);
    expect(entry.aiEstimateSnapshot!.assumptions).toHaveLength(1);
    const data = backup();
    data.meals[0]!.items = [entry];
    data.estimatedFoods = [food];
    expect(backupSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
});
