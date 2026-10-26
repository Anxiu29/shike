import { describe, expect, it } from 'vitest';
import { backupSchema, calculateNutrients, emptyNutrients, foodEntrySchema, type FoodEntry } from '../src/index.js';
const drink = (): FoodEntry => ({ id: 'drink', name: '自制饮品', kind: 'manual', weightG: null, nutrientsPer100g: emptyNutrients(), provenance: '手动每100mL', warnings: [], volumeSnapshot: { amountMl: 250, nutrientsPer100ml: { ...emptyNutrients(), energyKcal: 40 } } });
describe('普通饮品体积快照', () => {
  it('按mL计算，宏量缺失保持未知，零与未知摄入分开', () => {
    const entry = drink(); expect(foodEntrySchema.safeParse(entry).success).toBe(true);
    expect(calculateNutrients(entry)).toEqual({ energyKcal: 100, proteinG: null, fatG: null, carbsG: null });
    entry.volumeSnapshot!.amountMl = null; expect(calculateNutrients(entry).energyKcal).toBeNull();
    entry.volumeSnapshot!.amountMl = 0; expect(calculateNutrients(entry)).toEqual({ energyKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  });
  it('不允许混入克数、质量营养、数据库依据或非法值', () => {
    for (const change of [{ weightG: 100 }, { referenceId: 'fdc-1' }, { kind: 'database' }, { nutrientsPer100g: { ...emptyNutrients(), energyKcal: 40 } }, { volumeSnapshot: { amountMl: -1, nutrientsPer100ml: emptyNutrients() } }]) expect(foodEntrySchema.safeParse({ ...drink(), ...change }).success).toBe(false);
  });
  it('v8备份往返保留体积及当时数值，v5包装库照常升级', () => {
    const now = new Date().toISOString(), entry = drink();
    const backup = { schemaVersion: 8, exportedAt: now, meals: [{ id: 'meal', date: '2026-10-16', mealType: 'lunch', items: [entry], mode: 'manual', createdAt: now, updatedAt: now }], weights: [], settings: { targetWeightKg: null }, estimatedFoods: [], packagedFoods: [], water: [], exercises: [], dailyPlans: [] };
    const saved = backupSchema.parse(JSON.parse(JSON.stringify(backup))); entry.volumeSnapshot!.nutrientsPer100ml.energyKcal = 1;
    expect(calculateNutrients(saved.meals[0]!.items[0]!).energyKcal).toBe(100);
    expect(backupSchema.parse({ ...backup, schemaVersion: 5, meals: [] }).schemaVersion).toBe(11);
  });
});
