import { describe, expect, it } from 'vitest';
import { barcodeSchema, offProductUrl, parseOffProduct, packagedEntry, packageFromEntry, calculateNutrients, syncPackageEntry, packagedFoodSchema } from '../src/index.js';

const code = '3274080005003';
const payload = (extra: Record<string, unknown> = {}) => ({ status: 1, product: { code, product_name: 'Test drink', product_name_zh: '教学饮料', brands: '测试品牌', quantity: '250 ml', nutriments: { 'energy-kj_100g': 250, proteins_100g: 1.2, fat_100g: 0 }, ...extra } });

describe('免费商品库数据边界', () => {
  it('保持开头的零并校验末位，URL只允许固定域名与合法条码', () => {
    expect(barcodeSchema.parse('012345678905')).toBe('0012345678905');
    expect(offProductUrl(code)).toContain(`/api/v3.6/product/${code}.json?fields=`);
    for (const value of ['3274080005004', '../secret', 'https://evil.test', '123', ' 3274080005003']) expect(() => offProductUrl(value)).toThrow();
  });
  it('按OFF规范归一化补零条码，接受等价UPC返回值而拒绝另一商品', () => {
    const upc = '034000470693', ean = '0034000470693';
    expect(barcodeSchema.parse(upc)).toBe(ean); expect(barcodeSchema.parse(`0${ean}`)).toBe(ean);
    const food = parseOffProduct(payload({ code: ean }), upc)!; expect(food.barcode).toBe(ean); expect(food.source!.url).toBe(`https://world.openfoodfacts.org/product/${ean}`);
    expect(offProductUrl(upc)).toContain(`/product/${ean}.json`);
    expect(() => parseOffProduct(payload({ code }), upc)).toThrow('不一致');
  });
  it('中文名、品牌、毫升、kJ及来源经过校验；缺失不是零', () => {
    const food = parseOffProduct(payload(), code)!;
    expect(food.name).toBe('教学饮料'); expect(food.brand).toBe('测试品牌'); expect(food.label.basis).toBe('100ml');
    expect(food.label.energy).toEqual({ value: 250, unit: 'kJ' }); expect(food.label.fatG).toBe(0); expect(food.label.carbsG).toBeNull();
    expect(food.source).toMatchObject({ barcode: code, license: 'ODbL-1.0', url: `https://world.openfoodfacts.org/product/${code}` });
  });
  it('官方搜索品牌数组保留为品牌文本，异常数组项不写入', () => {
    expect(parseOffProduct(payload({ brands: ['Nongfu Spring', null, 7, '农夫山泉'] }), code)!.brand).toBe('Nongfu Spring, 农夫山泉');
  });
  it('从每100ml按半包换算；选库不默认全部吃完且不把mL当g', () => {
    const entry = packagedEntry(parseOffProduct(payload(), code)!);
    expect(entry.packageSnapshot!.consumedAmount).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBeNull();
    entry.packageSnapshot!.consumedUnit = 'package'; entry.packageSnapshot!.consumedAmount = 0.5; syncPackageEntry(entry);
    expect(calculateNutrients(entry).energyKcal).toBeCloseTo(74.68929254); expect(entry.weightG).toBeNull();
  });
  it('优先标准kcal，不使用原始value、NRV或冲调后营养填空', () => {
    const food = parseOffProduct(payload({ quantity: '30 g', nutriments: { 'energy-kcal_100g': 400, 'energy-kj_100g': 1500, proteins_value: 90, proteins_prepared_100g: 5, carbohydrates_nrv_100g: 2 } }), code)!;
    expect(food.label.energy).toEqual({ value: 400, unit: 'kcal' }); expect(food.label.proteinG).toBeNull(); expect(food.label.carbsG).toBeNull();
  });
  it('支持明确kg/L文本，不猜多包、杯子及互相矛盾的质量体积', () => {
    expect(parseOffProduct(payload({ quantity: '0.2 kg' }), code)!.label.netContent).toEqual({ amount: 200, unit: 'g' });
    expect(parseOffProduct(payload({ quantity: '1 L' }), code)!.label.netContent).toEqual({ amount: 1000, unit: 'ml' });
    for (const quantity of ['6×30 g', '一杯', undefined]) expect(parseOffProduct(payload({ quantity }), code)!.label.basis).toBe('unknown');
    expect(parseOffProduct(payload({ quantity: '200 g', serving_size: '20 ml' }), code)!.label.basis).toBe('unknown');
  });
  it('找不到返回null，缺名称、条码不符或数值超范围不能落库', () => {
    expect(parseOffProduct({ status: 0 }, code)).toBeNull();
    expect(parseOffProduct({ status: 'failure', errors: [{ message: { id: 'product_not_found' } }] }, code)).toBeNull();
    expect(() => parseOffProduct({}, code)).toThrow('无效结构');
    expect(() => parseOffProduct({ status: 'failure', errors: [{ message: { id: 'invalid_api_version' } }] }, code)).toThrow();
    expect(() => parseOffProduct(payload({ code: '012345678905' }), code)).toThrow('不一致');
    expect(() => parseOffProduct(payload({ product_name: '', product_name_zh: '' }), code)).toThrow('缺少名称');
    const food = parseOffProduct(payload({ nutriments: { 'energy-kcal_100g': -1, fat_100g: 'bad' } }), code)!;
    expect(food.label.energy).toBeNull(); expect(food.label.fatG).toBeNull();
  });
  it('保存是独立标签快照，模拟、缺基准和错误来源不能进入真实库', () => {
    const entry = packagedEntry(parseOffProduct(payload(), code)!);
    const saved = packageFromEntry(entry, '我的品牌', code); entry.packageSnapshot!.label.energy!.value = 1;
    expect(saved.label.energy!.value).toBe(250);
    expect(() => packageFromEntry(entry, '', '012345678905')).toThrow('公开来源的条码');
    entry.packageSnapshot!.provider = 'mock'; expect(() => packageFromEntry(entry, '', code)).toThrow('模拟');
    expect(packagedFoodSchema.safeParse({ ...saved, source: { ...saved.source, url: 'https://evil.test' } }).success).toBe(false);
    expect(packagedFoodSchema.safeParse({ ...saved, barcode: '012345678905' }).success).toBe(false);
  });
});
