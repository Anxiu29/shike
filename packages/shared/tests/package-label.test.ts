import { describe, expect, it } from 'vitest';
import { aggregateNutrients, backupSchema, calculateNutrients, createPackageEntry, emptyPackageLabel, foodEntrySchema, packageFactor, packageLabelSchema, parseRecognition, syncPackageEntry, type PackageLabel } from '../src/index.js';
const label = (extra: Partial<PackageLabel> = {}): PackageLabel => ({ basis: '100g', energy: { value: 2092, unit: 'kJ' }, proteinG: 8, fatG: 20, carbsG: 65, servingSize: { amount: 25, unit: 'g' }, netContent: { amount: 100, unit: 'g' }, ...extra });
function entry(value = label(), amount: number | null = null, unit: 'g' | 'ml' | 'serving' | 'package' = 'g') { const record = createPackageEntry('包装饼干', value, 'qwen', 'test-model'); Object.assign(record.packageSnapshot!, { consumedAmount: amount, consumedUnit: unit }); syncPackageEntry(record); return record; }
describe('包装标签的原值与实际摄入换算', () => {
  it('kJ按4.184换算kcal，不默认把净含量当成摄入量', () => {
    const record = entry(); expect(record.weightG).toBeNull(); expect(record.nutrientsPer100g.energyKcal).toBeCloseTo(500); expect(calculateNutrients(record).energyKcal).toBeNull();
    expect(calculateNutrients(entry(label(), 25))).toEqual({ energyKcal: 125, proteinG: 2, fatG: 5, carbsG: 16.25 });
  });
  it('半包、整包及每份用各自净含量／每份大小，只累计一次', () => {
    expect(calculateNutrients(entry(label(), 0.5, 'package')).energyKcal).toBe(250);
    expect(calculateNutrients(entry(label(), 1, 'package')).energyKcal).toBe(500);
    expect(calculateNutrients(entry(label(), 2, 'serving')).energyKcal).toBe(250);
    const serving = label({ basis: 'serving', energy: { value: 120, unit: 'kcal' }, proteinG: 2, fatG: 5, carbsG: 17, servingSize: { amount: 30, unit: 'g' }, netContent: { amount: 90, unit: 'g' } });
    expect(calculateNutrients(entry(serving, 2, 'serving')).energyKcal).toBe(240);
    expect(calculateNutrients(entry(serving, 1, 'package')).energyKcal).toBe(360);
    expect(calculateNutrients(entry(serving, 15, 'g')).energyKcal).toBe(60);
  });
  it('每100mL按体积算，不伪造质量；质量与体积不匹配保持未知', () => {
    const milk = label({ basis: '100ml', energy: { value: 250, unit: 'kJ' }, proteinG: 3, fatG: 3, carbsG: 5, servingSize: null, netContent: { amount: 250, unit: 'ml' } });
    const drink = entry(milk, 200, 'ml'); expect(drink.weightG).toBeNull(); expect(drink.nutrientsPer100g.energyKcal).toBeNull();
    expect(calculateNutrients(drink).energyKcal).toBeCloseTo(500 / 4.184);
    expect(calculateNutrients(entry(milk, 200, 'g')).energyKcal).toBeNull();
    expect(calculateNutrients(entry(milk, 1, 'package')).energyKcal).toBeCloseTo(625 / 4.184);
  });
  it('每包和无克数的每份可按包／份记录，缺少质量信息不能换成克', () => {
    const whole = label({ basis: 'package', energy: { value: 400, unit: 'kcal' }, servingSize: null, netContent: null });
    expect(calculateNutrients(entry(whole, 0.5, 'package')).energyKcal).toBe(200);
    expect(calculateNutrients(entry(whole, 10, 'g')).energyKcal).toBeNull();
    const serving = label({ basis: 'serving', servingSize: null, netContent: null });
    expect(calculateNutrients(entry(serving, 1, 'serving')).energyKcal).toBe(500);
    expect(calculateNutrients(entry(serving, 1, 'package')).energyKcal).toBeNull();
  });
  it('unknown基准和缺失值保持未知；0摄入与0标注分别处理', () => {
    expect(calculateNutrients(entry(emptyPackageLabel(), 50))).toEqual({ energyKcal: null, proteinG: null, fatG: null, carbsG: null });
    expect(calculateNutrients(entry(label({ proteinG: null }), 10)).proteinG).toBeNull();
    expect(calculateNutrients(entry(label(), 0)).energyKcal).toBe(0);
    expect(calculateNutrients(entry(label({ energy: { value: 0, unit: 'kJ' } }), 100)).energyKcal).toBe(0);
    expect(packageFactor(entry().packageSnapshot!)).toBeNull();
  });
  it('校验非法单位、负值、零分母、超范围与被篡改的营养快照', () => {
    for (const invalid of [{ energy: { value: 10, unit: 'NRV%' } }, { fatG: -1 }, { servingSize: { amount: 0, unit: 'g' } }, { energy: { value: 5000, unit: 'kcal' } }]) expect(packageLabelSchema.safeParse({ ...label(), ...invalid }).success).toBe(false);
    const record = entry(label(), 1, 'package'); expect(foodEntrySchema.safeParse(record).success).toBe(true);
    record.nutrientsPer100g.energyKcal = 1; expect(foodEntrySchema.safeParse(record).success).toBe(false);
    expect(foodEntrySchema.safeParse(entry(label(), 101, 'package')).success).toBe(false);
    const mixed = entry(label(), 25); mixed.kind = 'manual'; expect(foodEntrySchema.safeParse(mixed).success).toBe(false);
  });
  it('包装不需要三档；模型不得把标签与粗估混用，模型重量不成为实际摄入', () => {
    const food = { name: '包装饼干', estimatedWeightG: 100, visibleIngredients: [], uncertainties: [], packageLabel: label() };
    const response = { isFood: true, foods: [food], uncertainties: [] };
    expect(parseRecognition(JSON.stringify(response), { requireProfile: true }).foods[0]!.estimatedWeightG).toBeNull();
    expect(() => parseRecognition(JSON.stringify({ ...response, foods: [{ ...food, estimatedNutrientsPer100g: { energyKcal: 500, proteinG: null, fatG: null, carbsG: null } }] }), { requireProfile: true })).toThrow('不能混用');
  });
  it('v8备份保留标签原单位及摄入快照；旧v3升级，历史不依赖食物库', () => {
    const item = entry(label(), 25), time = '2026-10-16T01:00:00.000Z';
    const backup = { schemaVersion: 8, packagedFoods: [], exportedAt: time, meals: [{ id: 'meal', date: '2026-10-16', items: [item], mealType: 'snack', mode: 'live', createdAt: time, updatedAt: time }], weights: [], estimatedFoods: [], water: [], exercises: [], dailyPlans: [], settings: { targetWeightKg: null } };
    const restored = backupSchema.parse(JSON.parse(JSON.stringify(backup))); expect(restored.meals[0]!.items[0]!.packageSnapshot!.label.energy!.unit).toBe('kJ');
    expect(aggregateNutrients(restored.meals[0]!.items).energyKcal.known).toBe(125);
    const { packagedFoods: _packages, libraryFoods: _library, ...legacy } = backup; expect(backupSchema.parse({ ...legacy, schemaVersion: 3, meals: [] }).schemaVersion).toBe(11);
    item.packageSnapshot!.label.energy!.value = 0; syncPackageEntry(item); expect(calculateNutrients(restored.meals[0]!.items[0]!).energyKcal).toBe(125);
  });
});
