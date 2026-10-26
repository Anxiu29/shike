import { describe, expect, it } from 'vitest';
import { parseOffProduct } from '../src/index.js';
import { importProblem, packagedCategory, selectionFor } from '../../../scripts/lib/packaged-import.mjs';
const code = '6921168509256';
const sample = (nutriments = { 'energy-kcal_100g': 40, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 10 }) => ({ code, product_name: 'Juice', brands: ['Nongfu Spring'], quantity: '500 ml', nutriments });

describe('扩库保守筛选与中文检索', () => {
  it('缺质量体积、单位冲突或能量明显异常的商品被排除，不替换原数值', () => {
    const original = sample(), good = parseOffProduct({ product: original }, code)!;
    expect(importProblem(original, good)).toBeNull();
    const missing = { ...original, quantity: '一瓶' }; expect(importProblem(missing, parseOffProduct({ product: missing }, code))).toContain('基准');
    const bad = { ...original, nutriments: { ...original.nutriments, 'energy-kj_100g': 40 } };
    expect(importProblem(bad, parseOffProduct({ product: bad }, code))).toContain('kJ');
    const wrong = { ...original, nutriments: { ...original.nutriments, 'energy-kcal_100g': 300 } };
    expect(importProblem(wrong, parseOffProduct({ product: wrong }, code))).toContain('不一致');
    expect(original.nutriments['energy-kcal_100g']).toBe(40);
  });
  it('中文品牌检索不会把PepsiCo旗下其他品牌商品改叫百事', () => {
    const raw = sample(), food = parseOffProduct({ product: raw }, code)!;
    expect(selectionFor(raw, food).aliases).toContain('农夫山泉');
    const other = { ...raw, product_name: 'Gazpacho Original', brands: ['Alvalle', 'PepsiCo'] };
    expect(selectionFor(other, parseOffProduct({ product: other }, code)!).displayName).toBe('Gazpacho Original');
    expect(packagedCategory({ categories_tags: ['en:snacks'] }, 'Chicken flavour potato chips')).toBe('零食与坚果');
    expect(packagedCategory({ categories_tags: ['en:chocolates'] }, 'Milk chocolate')).toBe('零食与坚果');
    expect(packagedCategory({}, 'Milk chocolate')).toBe('零食与坚果');
    expect(packagedCategory({}, '薄盐生抽')).toBe('调味品');
  });
});
