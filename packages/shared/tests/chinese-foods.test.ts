import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backupSchema, calculateNutrients, createFoodEntry, createRecipeEntry, findFood, findRecipe, foods, nutrientsSchema, recipes } from '../src/index.js';

const source = JSON.parse(readFileSync(new URL('../data/tfda-chinese-source.json', import.meta.url), 'utf8'));
const chinese = foods.filter(food => food.source.dataset === 'TFDA 食品营养成分');

describe('中式成品参考和包子配方', () => {
  it('每项营养与选存的官方原始行相同，保留样本编号和许可，不混入生料/冷冻样本', () => {
    expect(chinese).toHaveLength(307);
    expect(source.sourceJsonSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.licenseUrl).toBe('https://data.gov.tw/license');
    const columns = { energyKcal: ['熱量', 'kcal'], proteinG: ['粗蛋白', 'g'], fatG: ['粗脂肪', 'g'], carbsG: ['總碳水化合物', 'g'] } as const;
    for (const food of chinese) {
      const original = source.foods.find((item: { id: string }) => `tfda-${item.id}` === food.id);
      expect(original).toBeDefined();
      const description = food.source.dataset === 'TFDA 食品营养成分' ? food.source.sampleDescription : '';
      expect(description).not.toMatch(/半成品|未烹調|冷凍|冷藏/);
      if (food.category !== '水果') expect(description).not.toMatch(/樣品狀態:生/);
      expect(food.source.fdcId).toBeUndefined();
      expect(nutrientsSchema.safeParse(food.nutrientsPer100g).success).toBe(true);
      for (const [nutrient, [label, unit]] of Object.entries(columns)) {
        const row = original.rows.find((row: Record<string, string>) => row['分析項'] === label);
        if (row) expect(row['含量單位']).toBe(unit);
        const text = row?.['每100克含量']?.trim();
        expect(food.nutrientsPer100g[nutrient as keyof typeof columns]).toBe(text ? Number(text) : null);
      }
    }
  });
  it('馒头等中式名称能匹配，来源不是USDA或AI，按g记录，不假定一只重量', () => {
    for (const name of ['馒头', '花卷', '烧饼', '油条', '小笼包', '韭菜盒子', '锅贴', '蛋挞', '菠萝包', '凤梨酥']) expect(findFood(name)).toBeDefined();
    const mantou = foods.find(food => food.id === 'tfda-R2400201')!;
    expect(mantou.nutrientsPer100g).toEqual({ energyKcal: 248, proteinG: 8.1, fatG: 1.2, carbsG: 51.3 });
    const entry = createFoodEntry(mantou, null);
    expect(calculateNutrients(entry).energyKcal).toBeNull();
    expect(entry.provenance).toContain('样本 R2400201'); expect(entry.provenance).not.toContain('FDC undefined');
    entry.weightG = 150; expect(calculateNutrients(entry).energyKcal).toBe(372);
    entry.nutrientsPer100g.energyKcal = 1; expect(mantou.nutrientsPer100g.energyKcal).toBe(248);
  });
  it('菜包和肉包分别引用成品面皮和熟馅料，不用冷冻整包样本或干面粉冒充熟重', () => {
    for (const name of ['菜包', '青菜包', '肉包', '鲜肉包', '菜肉包', '香菇青菜包', '香菇肉包', '牛肉包', '鸡肉包', '叉烧包', '豆沙包', '芝麻包']) {
      const recipe = findRecipe(name)!; expect(recipe).toBeDefined(); expect(recipe.category).toBe('主食');
      expect(recipe.referenceWeightG).toBe(recipe.ingredients.reduce((sum, item) => sum + item.weightG, 0));
      const entry = createRecipeEntry(recipe, 100);
      expect(entry.warnings.join(' ')).toContain('近似蒸熟面皮');
      expect(entry.recipeSnapshot!.ingredients.find(item => item.id === 'skin')!.provenance).toContain('TFDA');
      expect(entry.recipeSnapshot!.ingredients.every(item => !/面粉/.test(item.name))).toBe(true);
      expect(calculateNutrients(entry).energyKcal).toBeGreaterThan(0);
      const double = createRecipeEntry(recipe, 200);
      expect(calculateNutrients(double).energyKcal).toBeCloseTo(calculateNutrients(entry).energyKcal! * 2, 8);
    }
    expect(recipes).toHaveLength(90);
    expect(findRecipe('菜包')!.id).not.toBe(findRecipe('肉包')!.id);
    expect(findRecipe('肉包')!.ingredients.some(item => item.id === 'pork')).toBe(true);
    expect(findRecipe('菜包')!.ingredients.some(item => item.id === 'pork')).toBe(false);
  });
  it('新增数据的餐食快照支持原版本备份恢复，源库变化不重算历史', () => {
    const entry = createRecipeEntry(findRecipe('菜包')!, 160), now = new Date().toISOString();
    const data = backupSchema.parse({ schemaVersion: 8, exportedAt: now, settings: { targetWeightKg: null }, meals: [{ id: 'bao-history', date: '2026-10-19', mealType: 'breakfast', items: [entry], mode: 'manual', createdAt: now, updatedAt: now }], weights: [], water: [], exercises: [], dailyPlans: [], estimatedFoods: [], packagedFoods: [] });
    const before = calculateNutrients(data.meals[0]!.items[0]!);
    entry.recipeSnapshot!.ingredients[0]!.nutrientsPer100g.energyKcal = 1;
    expect(calculateNutrients(data.meals[0]!.items[0]!)).toEqual(before);
    expect(data.meals[0]!.items[0]!.recipeSnapshot!.ingredients[0]!.provenance).toContain('样本 R2400201');
  });
});
