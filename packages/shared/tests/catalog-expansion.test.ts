import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinPackagedFoods, packagedCatalogItems, packagedCategories, packagedFoodSchema, parseOffProduct, packagedEntry, calculateNutrients, syncPackageEntry, exerciseActivities, exerciseGroups, createExercise, exerciseRecordSchema, type PackagedFood } from '../src/index.js';

describe('公开包装商品参考', () => {
  it('每项均有有效条码、来源和明确基准，营养原值与所附OFF原始快照一致', () => {
    const source = JSON.parse(readFileSync(new URL('../data/packaged-catalog-source.json', import.meta.url), 'utf8'));
    const report = JSON.parse(readFileSync(new URL('../data/packaged-catalog-import-report.json', import.meta.url), 'utf8'));
    expect(builtinPackagedFoods.length).toBeGreaterThanOrEqual(1000);
    expect(builtinPackagedFoods).toHaveLength(report.total);
    expect(new Set(builtinPackagedFoods.map(item => item.food.barcode)).size).toBe(builtinPackagedFoods.length);
    for (const { food, category } of builtinPackagedFoods) {
      expect(packagedFoodSchema.safeParse(food).success).toBe(true);
      expect(packagedCategories).toContain(category);
      expect(food.source).toMatchObject({ type: 'openfoodfacts', license: 'ODbL-1.0', barcode: food.barcode });
      const product = source.products.find((row: { code: string }) => row.code === food.barcode);
      const original = parseOffProduct({ product }, food.barcode!, source.productRetrievedAt?.[product.code] ?? source.retrievedAt)!;
      expect(food.label).toEqual(original.label);
      expect(['100g', '100ml']).toContain(food.label.basis);
      expect(food.label.energy).not.toBeNull();
    }
    for (const barcode of ['6928804011142', '6917878044729', '6920584471017', '6902265360018']) expect(builtinPackagedFoods.some(item => item.food.barcode === barcode)).toBe(false);
  });
  it('容量不当重量、净含量不当摄入量，餐食标签独立拷贝，原始kJ保留', () => {
    const milk = builtinPackagedFoods.find(item => item.food.barcode === '6923644266066')!.food;
    const entry = packagedEntry(milk);
    expect(entry.weightG).toBeNull(); expect(entry.packageSnapshot!.consumedAmount).toBeNull();
    expect(calculateNutrients(entry).energyKcal).toBeNull();
    entry.packageSnapshot!.consumedAmount = 250; entry.packageSnapshot!.consumedUnit = 'ml'; syncPackageEntry(entry);
    expect(calculateNutrients(entry).energyKcal).toBeCloseTo(184.631925);
    entry.packageSnapshot!.label.energy!.value = 1;
    expect(milk.label.energy!.value).toBe(73.85277);
    const cola = builtinPackagedFoods.find(item => item.food.barcode === '6954767417684')!.food;
    expect(cola.label.energy).toEqual({ value: 180, unit: 'kJ' });
    expect(builtinPackagedFoods.find(item => item.food.barcode === '8850025001023')!.food.label.netContent).toBeNull();
  });
  it('用户核对标签覆盖同条码参考，不自动合并不同条码，不写入个人数据', () => {
    const original = builtinPackagedFoods[0]!.food;
    const corrected: PackagedFood = structuredClone(original);
    corrected.id = 'personal-label'; corrected.label.energy = { value: 65, unit: 'kcal' }; corrected.manuallyEdited = true;
    const personal = [corrected], combined = packagedCatalogItems(personal);
    expect(combined).toHaveLength(builtinPackagedFoods.length);
    expect(combined.filter(item => item.food.barcode === original.barcode)).toHaveLength(1);
    expect(combined[0]!.food.id).toBe(corrected.id);
    expect(combined[0]!.category).toBe('奶与植物奶');
    expect(personal).toHaveLength(1); expect(original.label.energy!.value).toBe(73.85277);
    expect(combined.some(item => item.food.barcode === '6907992507095')).toBe(true);
  });
});

describe('扩充运动参考', () => {
  it('编号唯一，分类完备，旧记录MET不变，俯卧撑继续按个数', () => {
    expect(exerciseActivities).toHaveLength(32);
    expect(new Set(exerciseActivities.map(item => item.code)).size).toBe(32);
    for (const activity of exerciseActivities) expect(exerciseGroups).toContain(activity.category);
    for (const [code, met] of [['17170', 3], ['17200', 4.8], ['12020', 7.5], ['01010', 4], ['02022', 3.8], ['02020', 7.5]] as const) expect(exerciseActivities.find(item => item.code === code)!.met).toBe(met);
    expect(exerciseActivities.filter(item => item.unit === 'repetitions').map(item => item.code)).toEqual(['02022', '02020']);
  });
  it('新项目按有效活动能量记账，编辑保留ID，恢复时校验原始MET', () => {
    const record = createExercise({ date: '2026-10-16', activityCode: '18265', minutes: 30, weightKg: 70, includeInBudget: true });
    expect(record.activeKcal).toBeCloseTo(150.5);
    expect(record.grossKcal).toBeCloseTo(185.5);
    expect(exerciseRecordSchema.safeParse(JSON.parse(JSON.stringify(record))).success).toBe(true);
    const edited = createExercise({ date: record.date, activityCode: '15552', minutes: 10, weightKg: 70, includeInBudget: true }, record);
    expect(edited.activeKcal).toBeCloseTo(85.16666667); expect(edited.id).toBe(record.id);
    expect(exerciseRecordSchema.safeParse({ ...edited, met: 5 }).success).toBe(false);
  });
});
