import { describe, expect, it } from 'vitest';
import { backupSchema, calculateNutrients, createFoodEntry, defaultPortion, emptyNutrients, findFood, foodEntrySchema, portionAmount, type FoodEntry } from '../src/index.js';
function entry(name = '菜包'): FoodEntry {
  const portion = defaultPortion(name, '个', 'g');
  return { ...createFoodEntry(findFood('米饭')!, portionAmount(portion)), name, portionSnapshot: portion };
}
describe('日常计量单位估算', () => {
  it('中等包子按80g假设，支持半个和多个，自定义单个重量不改变营养密度', () => {
    const value = entry(); expect(value.weightG).toBe(80); expect(value.portionSnapshot!.assumption).toContain('不是实测');
    value.portionSnapshot!.quantity = .5; value.weightG = portionAmount(value.portionSnapshot!); expect(value.weightG).toBe(40);
    value.portionSnapshot!.quantity = 2; value.portionSnapshot!.amountPerUnit = 95; value.weightG = portionAmount(value.portionSnapshot!);
    expect(value.weightG).toBe(190); expect(foodEntrySchema.safeParse(value).success).toBe(true);
    expect(calculateNutrients(value).energyKcal).toBeCloseTo(value.nutrientsPer100g.energyKcal! * 1.9);
  });
  it('不同食物采用独立的大小假设，未知食物不编造营养', () => {
    expect(defaultPortion('小笼包', '个', 'g').amountPerUnit).toBe(30);
    expect(defaultPortion('水饺', '个', 'g').amountPerUnit).toBe(20);
    expect(defaultPortion('米饭', '碗', 'g').amountPerUnit).toBe(150);
    expect(defaultPortion('吐司', '片', 'g').amountPerUnit).toBe(25);
    expect(defaultPortion('香蕉', '根', 'g').amountPerUnit).toBe(100);
    expect(defaultPortion('豆腐', '块', 'g').amountPerUnit).toBe(50);
    const value = { ...entry('未收录自制食物'), kind: 'unknown' as const, nutrientsPer100g: emptyNutrients(), referenceId: undefined };
    expect(calculateNutrients(value).energyKcal).toBeNull();
  });
  it('数量或单份大小缺失时保留未知，不默认吃了一份', () => {
    const value = entry(); value.portionSnapshot!.quantity = null; value.weightG = portionAmount(value.portionSnapshot!);
    expect(value.weightG).toBeNull(); expect(calculateNutrients(value).energyKcal).toBeNull(); expect(foodEntrySchema.safeParse(value).success).toBe(true);
    value.portionSnapshot!.quantity = 1; value.portionSnapshot!.amountPerUnit = null; expect(portionAmount(value.portionSnapshot!)).toBeNull();
  });
  it('拒绝数量换算与实际重量矛盾、体积混用及超限份量', () => {
    const value = entry(); expect(foodEntrySchema.safeParse({ ...value, weightG: 999 }).success).toBe(false);
    expect(foodEntrySchema.safeParse({ ...value, portionSnapshot: { ...value.portionSnapshot, basis: 'ml' } }).success).toBe(false);
    value.portionSnapshot!.quantity = 300; expect(portionAmount(value.portionSnapshot!)).toBeNull(); expect(foodEntrySchema.safeParse(value).success).toBe(false);
  });
  it('一杯饮品只使用每100mL资料，不混用每100g数据', () => {
    const portion = defaultPortion('牛奶', '杯', 'ml');
    const value: FoodEntry = { id: 'drink', name: '牛奶', kind: 'manual', weightG: null, nutrientsPer100g: emptyNutrients(), provenance: '用户填写', warnings: [], portionSnapshot: portion, volumeSnapshot: { amountMl: portionAmount(portion), nutrientsPer100ml: { ...emptyNutrients(), energyKcal: 60 } } };
    expect(foodEntrySchema.safeParse(value).success).toBe(true); expect(calculateNutrients(value).energyKcal).toBe(150);
  });
  it('v9保存当时的数量与单份快照，v8升级保留全部旧信息', () => {
    const now = '2026-10-19T04:00:00.000Z';
    const backup = { schemaVersion: 9, exportedAt: now, settings: { targetWeightKg: null }, meals: [{ id: 'portion-meal', date: '2026-10-19', mealType: 'lunch', items: [entry()], mode: 'manual', createdAt: now, updatedAt: now }], weights: [], water: [], exercises: [], dailyPlans: [], estimatedFoods: [], packagedFoods: [] };
    const restored = backupSchema.parse(JSON.parse(JSON.stringify(backup))); expect(restored.meals[0]!.items[0]!.portionSnapshot!.amountPerUnit).toBe(80);
    expect(backupSchema.parse({ ...backup, schemaVersion: 8, meals: [] }).schemaVersion).toBe(11);
  });
});
