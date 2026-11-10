import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { calculateNutrients, findRecipe, mealRecordSchema, createRecipeEntry, emptyPackageLabel, createPackageEntry, packageFromEntry, typicalPortion, packagedCatalogItems } from '@shike/shared';
import { assistantEntry, assistantMeal, assistantNutrition, assistantEnergyLabel } from '../src/lib/meal-assistant';
import { applyTypicalPortion } from '../src/lib/typical-portions';
describe('助手草稿和普通份量', () => {
  it('详细编辑保存100项后仍能展示完整热量，不影响保存回调或静默漏项', () => {
    const rice = assistantEntry({ name: '米饭', amount: 150, unit: 'g' }, [], []);
    const snapshot = assistantNutrition(Array(100).fill(rice), 'saved', '2026-11-10', 'lunch', 'live');
    expect(snapshot.items).toHaveLength(100); expect(snapshot.knownEnergyKcal).toBe(19500);
    expect(() => assistantNutrition(Array(101).fill(rice), 'saved', '2026-11-10', 'lunch', 'live')).toThrow();
    expect(() => assistantNutrition(Array(11).fill(rice), 'draft', '2026-11-10', 'lunch', 'live')).toThrow();
    for (const mode of ['mock', 'manual'] as const) expect(assistantNutrition([rice], 'saved', '2026-11-10', 'lunch', mode).mode).toBe(mode);
  });
  it('好丽友小包由AI估重换算，整包装净含量与每100g营养不被修改', () => {
    const product = packagedCatalogItems([]).find(item => item.food.barcode === '6920907800968')!.food;
    const entry = assistantEntry({ name: product.name, amount: 2, unit: '包', portionEstimate: { amountPerUnit: 34, basis: 'g', source: 'ai', assumption: '按单独小包估计，需核对' } } as any, [], []);
    expect(entry.weightG).toBe(68); expect(entry.packageSnapshot!.label.netContent!.amount).toBe(445);
    expect(calculateNutrients(entry).energyKcal).toBeCloseTo(1801 / 4.184 * .68);
    expect((entry.packageSnapshot as any).consumptionPortion).toMatchObject({ quantity: 2, amountPerUnit: 34, unit: '包' });
    expect(assistantNutrition([entry], 'estimate', '2026-11-06', 'snack', 'live').items[0]!.assumptions.join('')).toContain('AI估重');
  });
  it('无单个依据时不猜重量，包装的份数按标签份量而非默认200g换算', () => {
    expect(assistantEntry({ name: '鹌鹑蛋', amount: 2, unit: '个' }, [], []).weightG).toBeNull();
    const entry = createPackageEntry('测试小糕点', { ...emptyPackageLabel(), basis: '100g', energy: { value: 400, unit: 'kcal' }, servingSize: { amount: 25, unit: 'g' }, netContent: { amount: 250, unit: 'g' } }, 'manual', 'test');
    const product = packageFromEntry(entry, '测试', null);
    const result = assistantEntry({ name: '测试小糕点', amount: 2, unit: '份' }, [], [product]);
    expect(result.weightG).toBe(50); expect(calculateNutrients(result).energyKcal).toBe(200);
  });
  it('盒数使用明确规格且保留盒单位，用户说明的小盒大小优先于外包装净含量', () => {
    const entry = createPackageEntry('测试盒装酸奶', { ...emptyPackageLabel(), basis: '100g', energy: { value: 100, unit: 'kcal' }, netContent: { amount: 1000, unit: 'g' } }, 'manual', 'test');
    const product = packageFromEntry(entry, '测试', null);
    const whole = assistantEntry({ name: entry.name, amount: 2, unit: '盒' }, [], [product]);
    expect(whole.weightG).toBe(2000); expect(whole.packageSnapshot!.consumptionPortion).toMatchObject({ unit: '盒', quantity: 2, amountPerUnit: 1000 });
    const small = assistantEntry({ name: entry.name, amount: 2, unit: '盒', portionEstimate: { amountPerUnit: 125, basis: 'g', source: 'user', assumption: '用户说明每小盒125g' } }, [], [product]);
    expect(small.weightG).toBe(250); expect(calculateNutrients(small).energyKcal).toBe(250); expect(small.packageSnapshot!.label.netContent!.amount).toBe(1000);
  });
  it('新增好丽友不再套通用200g；混合食品的常见份量不按原料个数', () => {
    const product = packagedCatalogItems([]).find(item => item.food.barcode === '6920907800968')!.food;
    const entry = createPackageEntry(product.name, product.label, product.provider, product.model);
    applyTypicalPortion(entry); expect(entry.weightG).toBeNull(); expect(entry.packageSnapshot!.consumedAmount).toBeNull();
    for (const name of ['鸡蛋羹', '鸡蛋面', '香蕉牛奶', '苹果汁']) expect(['个', '根']).not.toContain(typicalPortion(name).unit);
  });
  it('热量快照逐项带来源和份量假设，部分缺失不显示为整餐总量且与后续修改独立', () => {
    const rice = assistantEntry({ name: '米饭', amount: 150, unit: 'g' }, [], []);
    const unknown = assistantEntry({ name: '未收录的测试菜', amount: null, unit: '份' }, [], []);
    const snapshot = assistantNutrition([rice, unknown], 'draft', '2026-11-06', 'lunch', 'live');
    expect(snapshot).toMatchObject({ knownEnergyKcal: 195, missingEnergyItems: 1, items: [{ name: rice.name, energyKcal: 195 }, { energyKcal: null }] });
    expect(snapshot.items[0]!.source).toBeTruthy(); expect(snapshot.items[1]!.assumptions.join('')).toContain('未称重');
    expect(assistantEnergyLabel(snapshot)).toBe('已知部分约 195 kcal · 1 项待补充');
    rice.weightG = 300;
    expect(snapshot.items[0]!.energyKcal).toBe(195);
    expect(assistantNutrition([rice], 'draft', '2026-11-06', 'lunch', 'live').knownEnergyKcal).toBe(390);
    const missing = assistantNutrition([unknown], 'estimate', '2026-11-06', 'lunch', 'live');
    expect(assistantEnergyLabel(missing)).toBe('热量待补充 · 1 项缺少资料');
    rice.weightG = 0;
    expect(assistantEnergyLabel(assistantNutrition([rice], 'draft', '2026-11-06', 'lunch', 'live'))).toBe('合计约 0 kcal');
  });
  it('包装容量热量使用原有标签换算，普通毫升缺营养仍未知', () => {
    const entry = createPackageEntry('测试奶', { ...emptyPackageLabel(), basis: '100ml', energy: { value: 60, unit: 'kcal' } }, 'manual', '测试标签');
    entry.packageSnapshot!.consumedAmount = 250; entry.packageSnapshot!.consumedUnit = 'ml';
    const unknown = assistantEntry({ name: '未收录饮品', amount: 250, unit: 'ml' }, [], []);
    const snapshot = assistantNutrition([entry, unknown], 'estimate', '2026-11-06', 'snack', 'live');
    expect(snapshot.items.map(item => item.energyKcal)).toEqual([150, null]);
    expect(snapshot.items[0]!.portion).toContain('250 mL');
  });
  it('热量展示不额外收紧原有合法容量快照的范围', () => {
    const entry = assistantEntry({ name: '容量边界测试', amount: 20000, unit: 'ml' }, [], []);
    entry.volumeSnapshot!.nutrientsPer100ml.energyKcal = 2000;
    expect(assistantNutrition(Array(10).fill(entry), 'estimate', '2026-11-06', 'snack', 'live').knownEnergyKcal).toBe(4_000_000);
  });
  it('订单数量保留为待核对份量，来源提醒随快照保存；未知食品不编热量', () => {
    const food = { name: '肉包', amount: 6, unit: '个' as const };
    const entry = assistantEntry(food, [], [], 'order');
    expect(entry.portionSnapshot?.quantity).toBe(6); expect(entry.weightG).toBe(480);
    expect(entry.portionSnapshot?.assumption).toContain('未称重');
    expect(entry.provenance).toContain('外卖订单草稿'); expect(entry.warnings.join('')).toContain('下单数量不等于实际摄入');
    const record = assistantMeal({ intent: 'update', date: '2026-10-28', mealType: 'lunch', foods: [food], message: '核对订单' }, [entry], 'live');
    expect(mealRecordSchema.parse(record).items[0]?.warnings).toEqual(entry.warnings);
    const unknown = assistantEntry({ name: '神秘套餐甲', amount: 1, unit: '份' }, [], [], 'order');
    expect(calculateNutrients(unknown).energyKcal).toBeNull();
    expect(assistantEntry(food, [], []).warnings.join('')).not.toContain('订单');
  });
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
    applyTypicalPortion(entry); expect(entry.packageSnapshot!.consumedAmount).toBeNull(); expect(entry.weightG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBeNull();
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
