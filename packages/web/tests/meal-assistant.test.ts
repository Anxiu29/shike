import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { calculateNutrients, findRecipe, mealRecordSchema, createRecipeEntry, emptyPackageLabel, createPackageEntry, packageFromEntry } from '@shike/shared';
import { assistantEntry, assistantMeal } from '../src/lib/meal-assistant';
import { applyTypicalPortion } from '../src/lib/typical-portions';
describe('助手草稿和普通份量', () => {
  it('数量按食物换算；配方缩放只记整道菜，用户明确克数优先', () => {
    const bun = assistantEntry({ name: '肉包', amount: 2, unit: '个' }, [], []);
    expect(bun.weightG).toBe(160); expect(bun.portionSnapshot!.quantity).toBe(2);
    const exact = assistantEntry({ name: '肉包', amount: 123.45, unit: 'g' }, [], []);
    expect(exact.weightG).toBe(123.45); expect(exact.portionSnapshot).toBeUndefined();
    const dish = createRecipeEntry(findRecipe('番茄炒蛋')!, 250); dish.weightG = null;
    applyTypicalPortion(dish); expect(dish.weightG).toBe(250); expect(calculateNutrients(dish).energyKcal).toBeGreaterThan(0);
    expect(() => assistantEntry({ name: '肉包', amount: 20000, unit: '个' }, [], [])).toThrow('20000');
  });
  it('毫升没有营养或密度依据时保留缺失，未知食品仍可估份量但不伪造营养', () => {
    const milk = assistantEntry({ name: '我的牛奶', amount: 250, unit: 'ml' }, [], []);
    expect(milk.weightG).toBeNull(); expect(milk.volumeSnapshot!.amountMl).toBe(250); expect(calculateNutrients(milk).energyKcal).toBeNull();
    const unknown = assistantEntry({ name: '未知自制菜', amount: null, unit: '份' }, [], []);
    expect(unknown.weightG).toBe(200); expect(calculateNutrients(unknown).energyKcal).toBeNull();
    expect(applyTypicalPortion({ ...unknown, weightG: 0, portionSnapshot: undefined }).weightG).toBe(0);
  });
  it('包装用参考摄入量而非净含量；基准不明不乱猜', () => {
    const entry = createPackageEntry('牛奶', { ...emptyPackageLabel(), basis: '100ml', energy: { value: 60, unit: 'kcal' }, netContent: { amount: 1000, unit: 'ml' } }, 'manual', 'test');
    applyTypicalPortion(entry); expect(entry.packageSnapshot!.consumedAmount).toBe(250); expect(entry.weightG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBe(150);
    const unclear = createPackageEntry('未读清的包装', emptyPackageLabel(), 'manual', 'test'); applyTypicalPortion(unclear); expect(unclear.packageSnapshot!.consumedAmount).toBeNull();
    entry.name = '测试参考奶'; const product = packageFromEntry(entry, '测试', null);
    expect(() => assistantEntry({ name: '测试参考奶', amount: 200, unit: '杯' }, [], [product])).toThrow('20000');
  });
  it('可保存Vue响应式草稿，历史快照与后续修改独立', () => {
    const entries = reactive([assistantEntry({ name: '肉包', amount: 2, unit: '个' }, [], [])]);
    const record = assistantMeal({ date: '2026-10-20', mealType: 'breakfast', message: '草稿', foods: [{ name: '肉包', amount: 2, unit: '个' }] }, entries, 'live');
    expect(mealRecordSchema.safeParse(record).success).toBe(true); entries[0]!.weightG = 240;
    expect(record.items[0]!.weightG).toBe(160);
  });
});
