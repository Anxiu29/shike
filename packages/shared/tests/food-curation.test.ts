import { describe, expect, it } from 'vitest';
import { catalogFoods, createFoodEntry, curateFoodCatalog, findFood, foodCatalog, foodMergeLimits, foods, normalizeFoodName, type FoodDefinition } from '../src/index.js';

const fixture = (id: string, energy: number, modifier: string, changes: Partial<FoodDefinition> = {}): FoodDefinition => ({
  ...foods[0]!, id, name: id, aliases: [], category: '主食', state: 'cooked',
  nutrientsPer100g: { energyKcal: energy, proteinG: 2, fatG: 1, carbsG: 20 },
  source: { ...foods[0]!.source, description: `Test food, ${modifier}` }, ...changes,
});

describe('近似食物精简与来源兼容', () => {
  it('中粒短粒合为已有白米饭，旧名称仍可匹配，原营养和来源保留', () => {
    const rice = findFood('米饭')!;
    for (const name of ['中粒米饭', '短粒米饭', '中粒白米饭', '珍珠米（熟）']) expect(findFood(name)?.id).toBe(rice.id);
    expect(catalogFoods.some(food => ['fdc-168880', 'fdc-168882'].includes(food.id))).toBe(false);
    expect(rice.id).toBe('fdc-168878'); expect(rice.nutrientsPer100g.energyKcal).toBe(130);
    const short = foods.find(food => food.id === 'fdc-168882')!, history = createFoodEntry(short, 200);
    expect(short.nutrientsPer100g.proteinG).toBe(2.36); expect(history.referenceId).toBe(short.id);
    expect(history.nutrientsPer100g.proteinG).toBe(2.36); expect(history.name).toBe('短粒米饭（熟）');
    expect(rice.nutrientsPer100g).toEqual(foods[0]!.nutrientsPer100g); expect(rice.source).toEqual(foods[0]!.source);
  });
  it('每组任意两项均在阈值内，代表值取原始条目，不取平均也不删除原始数据', () => {
    expect(foods.filter(food => food.source.dataset.startsWith('USDA'))).toHaveLength(5675); expect(foodCatalog.removedCount).toBeGreaterThan(90);
    expect(catalogFoods.length + foodCatalog.removedCount).toBe(foods.length);
    const byId = new Map(foods.map(food => [food.id, food]));
    for (const group of foodCatalog.consolidations) {
      const selected = catalogFoods.find(food => food.id === group.representativeId)!;
      expect(selected.nutrientsPer100g).toEqual(byId.get(selected.id)!.nutrientsPer100g);
      expect(selected.source).toEqual(byId.get(selected.id)!.source);
      for (const a of group.memberIds) for (const b of group.memberIds) for (const [key, limit] of Object.entries(foodMergeLimits)) {
        const k = key as keyof typeof foodMergeLimits;
        expect(Math.abs(byId.get(a)!.nutrientsPer100g[k]! - byId.get(b)!.nutrientsPer100g[k]!)).toBeLessThanOrEqual(limit + 1e-8);
      }
    }
    const names = catalogFoods.flatMap(food => [food.name, ...food.aliases].map(normalizeFoodName));
    expect(new Set(names).size).toBe(names.length);
  });
  it('不通过相邻条目传递合并超过5 kcal的食物，也不修改输入对象', () => {
    const input = [fixture('a', 100, 'NFS'), fixture('b', 104, 'regular'), fixture('c', 108, 'enriched')], before = JSON.stringify(input);
    const result = curateFoodCatalog(input); expect(result.foods).toHaveLength(2); expect(JSON.stringify(input)).toBe(before);
    expect(result.consolidations[0]!.memberIds).toEqual(['a', 'b']);
  });
  it('同热量的不同做法、生熟、用油、糖和营养差别不能被误合并', () => {
    const variants = [fixture('a', 100, 'no added fat'), fixture('b', 100, 'fat added'), fixture('c', 100, 'sugar free'),
      fixture('d', 100, 'fried'), fixture('e', 100, 'no added fat', { state: 'raw' }),
      fixture('f', 100, 'no added fat', { nutrientsPer100g: { energyKcal: 100, proteinG: 20, fatG: 1, carbsG: 20 } }),
      fixture('g', 100, 'no added fat', { nutrientsPer100g: { energyKcal: 100, proteinG: null, fatG: 1, carbsG: 20 } })];
    expect(curateFoodCatalog(variants).foods).toHaveLength(variants.length);
    const unknown = fixture('unknown', 100, 'NS as to fat');
    expect(curateFoodCatalog([unknown, variants[0]!, variants[1]!]).foods).toHaveLength(2);
  });
});
