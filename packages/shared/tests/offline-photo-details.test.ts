import { describe, it, expect } from 'vitest';
import { parseOfflineWeights, parseOfflineLabel, packageNutrients, packageSnapshotSchema, createPackageEntry, syncPackageEntry, foodEntrySchema, packagedFoodSchema, offlineWeightPrompt, offlineLabelPrompt } from '../src/index.js';

const label = { name: '牛奶', basis: '100ml', energyValue: 280, energyUnit: 'kJ', proteinG: 3.5, fatG: 0, carbsG: 5, servingAmount: null, servingUnit: null, netAmount: 250, netUnit: 'ml', evidence: '每100毫升 能量280kJ 蛋白质3.5g 脂肪0g 碳水5g' };
const read = (change = {}) => parseOfflineLabel(JSON.stringify({ ...label, ...change }));
describe('离线照片估重的完整草稿', () => {
  it('保留每项独立重量和未知，不把个数解析成重量，也不接受模型营养字段', () => {
    const result = parseOfflineWeights('{"foods":[{"name":"米饭","estimatedWeightG":150},{"name":"鸡蛋","estimatedWeightG":null}]}');
    expect(result.foods.map(f => f.estimatedWeightG)).toEqual([150, null]); expect(result.warnings.join()).toContain('不是称重');
    expect(() => parseOfflineWeights('{"foods":[{"name":"鸡蛋","estimatedWeightG":2,"proteinG":10}]}')).toThrow('字段');
  });
  it('非食物允许空列表，不从坏JSON抢救条目', () => {
    expect(parseOfflineWeights('{"foods":[]}').foods).toEqual([]);
    for (const raw of ['{"foods":[', '```json\n{"foods":[]}\n```', '说明：{"foods":[]}']) expect(() => parseOfflineWeights(raw)).toThrow('格式');
  });
  it('拒绝重复、超过六项、负数、零、字符串和越界重量', () => {
    expect(() => parseOfflineWeights(JSON.stringify({ foods: [{ name: '米饭', estimatedWeightG: 50 }, { name: '米 饭', estimatedWeightG: 60 }] }))).toThrow('重复');
    for (const weight of [0, -1, 20001, '100']) expect(() => parseOfflineWeights(JSON.stringify({ foods: [{ name: '米饭', estimatedWeightG: weight }] }))).toThrow();
    expect(() => parseOfflineWeights('{"foods":[{"name":"米饭","estimatedWeightG":1e309}]}')).toThrow();
    expect(() => parseOfflineWeights(JSON.stringify({ foods: Array.from({ length: 7 }, (_, i) => ({ name: `食物${i}`, estimatedWeightG: 10 })) }))).toThrow();
  });
});
describe('离线营养表抄读', () => {
  it('保留kJ原值、零和体积，实际摄入未知时不计算总量', () => {
    const result = read(), entry = createPackageEntry(result.name, result.label, 'offline', 'Qwen3.5-0.8B');
    expect(result.label.energy).toEqual({ value: 280, unit: 'kJ' }); expect(result.label.fatG).toBe(0);
    expect(result.label.netContent).toEqual({ amount: 250, unit: 'ml' }); expect(entry.packageSnapshot!.consumedAmount).toBeNull();
    expect(packageNutrients(entry.packageSnapshot!).energyKcal).toBeNull();
    entry.packageSnapshot!.consumedAmount = 200; syncPackageEntry(entry);
    expect(packageNutrients(entry.packageSnapshot!).energyKcal).toBeCloseTo(560 / 4.184);
    expect(entry.weightG).toBeNull(); expect(foodEntrySchema.parse(entry).packageSnapshot!.provider).toBe('offline');
    expect(entry.packageSnapshot!.label.energy).toEqual({ value: 280, unit: 'kJ' });
  });
  it('缺少单位不猜，未知基准不计算，仍可补填', () => {
    const result = read({ basis: 'unknown', energyUnit: null, netUnit: null });
    expect(result.label.energy).toBeNull(); expect(result.label.netContent).toBeNull(); expect(result.label.basis).toBe('unknown');
    expect(result.warnings.join()).toContain('280'); expect(result.warnings.join()).toContain('单位未读清');
    const entry = createPackageEntry(result.name, result.label, 'offline', 'test'); entry.packageSnapshot!.consumedAmount = 100;
    expect(packageNutrients(entry.packageSnapshot!).proteinG).toBeNull();
  });
  it('不把mL当g；明确每份大小时才换算', () => {
    const result = read({ basis: 'serving', servingAmount: 200, servingUnit: 'ml' });
    const entry = createPackageEntry(result.name, result.label, 'offline', 'test');
    Object.assign(entry.packageSnapshot!, { consumedAmount: 100, consumedUnit: 'g' });
    expect(packageNutrients(entry.packageSnapshot!).energyKcal).toBeNull();
    entry.packageSnapshot!.consumedUnit = 'ml'; expect(packageNutrients(entry.packageSnapshot!).proteinG).toBe(1.75);
  });
  it('不拿净含量冒充营养表，全部未知应报错', () => {
    expect(() => read({ energyValue: null, energyUnit: null, proteinG: null, fatG: null, carbsG: null })).toThrow('没有读清');
  });
  it('拒绝百分比单位、字符串、负数、错列范围和多余字段，不改写成零', () => {
    for (const change of [{ energyUnit: '%' }, { proteinG: '3.5' }, { fatG: -1 }, { basis: '100g', proteinG: 101 }, { NRV: 12 }]) expect(() => read(change)).toThrow();
  });
  it('离线来源可在快照及包装库序列化恢复，不伪装成手填', () => {
    const result = read(), entry = createPackageEntry(result.name, result.label, 'offline', 'test');
    expect(packageSnapshotSchema.parse(JSON.parse(JSON.stringify(entry.packageSnapshot))).manuallyEdited).toBe(false);
    const time = new Date().toISOString();
    expect(packagedFoodSchema.parse({ id: 'local', name: result.name, brand: '', barcode: null, label: result.label, provider: 'offline', model: 'test', manuallyEdited: false, createdAt: time, updatedAt: time }).provider).toBe('offline');
  });
  it('固定提示在原生桥的400字限制内', () => { expect(offlineWeightPrompt.length).toBeLessThanOrEqual(400); expect(offlineLabelPrompt.length).toBeLessThanOrEqual(400); });
});
