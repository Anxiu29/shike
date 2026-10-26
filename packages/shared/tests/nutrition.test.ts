import { describe, expect, it } from 'vitest';
import {
  aggregateNutrients, calculateNutrients, createFoodEntry, createRecipeEntry,
  emptyNutrients, findFood, findRecipe, foodCategories, foods, normalizeFoodName, recipes, type FoodEntry,
} from '../src/index.js';

describe('可追溯营养数据与计算', () => {
  it('包含扩充后的官方基础食物，来源及营养值齐全，名称不重复', () => {
    expect(foods.length).toBeGreaterThanOrEqual(5630);
    expect(new Set(foods.map((food) => food.id)).size).toBe(foods.length);
    const names = foods.flatMap((food) => [food.name, ...food.aliases].map(normalizeFoodName));
    expect(new Set(names).size).toBe(names.length);
    for (const food of foods) {
      expect(foodCategories).toContain(food.category);
      expect(['USDA SR Legacy', 'USDA FNDDS', 'TFDA 食品营养成分']).toContain(food.source.dataset);
      expect(food.source.version).toBe(food.source.dataset === 'TFDA 食品营养成分' ? '2026-10-19 快照' : food.source.dataset === 'USDA FNDDS' ? '2021-2023' : '2018-04');
      expect(food.source.description.length).toBeGreaterThan(0);
      if (food.source.dataset === 'TFDA 食品营养成分') {
        expect(food.source.sampleCode).toMatch(/^[A-Z]\d{5,7}$/);
        expect(food.source.url).toBe('https://data.gov.tw/dataset/8543');
        expect(food.source.downloadUrl).toBe('https://data.fda.gov.tw/data/opendata/export/20/json');
      } else {
        expect(food.source.url).toContain(`/food-details/${food.source.fdcId}/nutrients`);
        expect(food.source.downloadUrl).toMatch(/^https:\/\/fdc\.nal\.usda\.gov\//);
      }
      for (const amount of Object.values(food.nutrientsPer100g)) {
        expect(amount === null || (Number.isFinite(amount) && amount >= 0)).toBe(true);
      }
    }
  });

  it('按 USDA CSV 的每 100 g 熟米饭数据进行重量换算', () => {
    const rice = findFood('米饭')!;
    expect(rice.source.fdcId).toBe(168878);
    expect(rice.nutrientsPer100g).toEqual({ energyKcal: 130, proteinG: 2.69, fatG: 0.28, carbsG: 28.17 });
    const calculated = calculateNutrients(createFoodEntry(rice, 150));
    expect(calculated.energyKcal).toBe(195);
    expect(calculated.proteinG).toBeCloseTo(4.035);
    expect(calculated.fatG).toBeCloseTo(0.42);
    expect(calculated.carbsG).toBeCloseTo(42.255);
  });

  it('只匹配明确名称／别名，不将未知混合菜强配为基础食物', () => {
    expect(findFood('  白米饭  ')?.id).toBe('fdc-168878');
    expect(findFood('生番茄')?.state).toBe('raw');
    expect(findFood('熟番茄')?.state).toBe('cooked');
    expect(findFood('新鲜蓝莓')?.id).toBe('fdc-171711');
    expect(findFood('新鲜草莓')?.id).toBe('fdc-167762');
    expect(findFood('大米')?.state).toBe('dry');
    expect(findFood('生鸡蛋')?.source.fdcId).toBe(171287);
    expect(findFood('鸡蛋')?.source.fdcId).toBe(173424);
    expect(findFood('洋葱')?.state).toBe('cooked');
    expect(findFood('小米粥')).toBeUndefined();
    expect(findFood('饮用水')?.nutrientsPer100g.energyKcal).toBe(0);
    expect(findFood('食盐')?.nutrientsPer100g.energyKcal).toBe(0);
    expect(findFood('蓝莓酱')).toBeUndefined();
    expect(findFood('熟蓝莓')).toBeUndefined();
    expect(findFood('宫保鸡丁')).toBeUndefined();
    expect(findFood('三明治')).toBeUndefined();
    expect(findRecipe('西红柿炒鸡蛋')?.id).toBe('tomato-egg');
  });

  it('保留缺失值并按每种营养统计已知部分和待补充数量', () => {
    const unknown: FoodEntry = {
      id: 'unknown', name: '不确定混合菜', weightG: 200,
      nutrientsPer100g: { ...emptyNutrients(), proteinG: 3 },
      provenance: '待补充', kind: 'unknown', warnings: [],
    };
    const entries = [createFoodEntry(findFood('米饭')!, 100), unknown];
    const total = aggregateNutrients(entries);
    expect(total.energyKcal).toEqual({ known: 130, missing: 1 });
    expect(total.proteinG.known).toBeCloseTo(8.69);
    expect(total.proteinG.missing).toBe(0);
    expect(total.incompleteEntries).toBe(1);
    expect(calculateNutrients(createFoodEntry(findFood('米饭')!, null))).toEqual(emptyNutrients());
    expect(calculateNutrients({ ...unknown, weightG: 0 })).toEqual({ energyKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  });

  it('使用独立营养快照，数据库更新不改变历史记录', () => {
    const original = findFood('米饭')!;
    const isolatedSource = { ...original, nutrientsPer100g: { ...original.nutrientsPer100g } };
    const entry = createFoodEntry(isolatedSource, 100);
    isolatedSource.nutrientsPer100g.energyKcal = 999;
    expect(calculateNutrients(entry).energyKcal).toBe(130);
  });

  it('拒绝负数、无穷重量', () => {
    expect(() => createFoodEntry(findFood('米饭')!, -1)).toThrow();
    expect(() => createFoodEntry(findFood('米饭')!, Infinity)).toThrow();
    expect(() => createRecipeEntry(recipes[0]!, 0)).toThrow();
    expect(() => createRecipeEntry(recipes[0]!, 200, { oil: -3 })).toThrow();
  });
});

describe('参考配方', () => {
  it('每个配方的基准总重等于最终可食配料之和，油单列且不采用生肉干米', () => {
    expect(recipes.length).toBeGreaterThanOrEqual(60);
    const recipeNames = recipes.flatMap((recipe) => [recipe.name, ...recipe.aliases].map(normalizeFoodName));
    expect(new Set(recipeNames).size).toBe(recipeNames.length);
    for (const recipe of recipes) {
      expect(recipe.ingredients.reduce((sum, item) => sum + item.weightG, 0)).toBe(recipe.referenceWeightG);
      expect(recipe.ingredients.filter((item) => item.id === 'oil').length).toBeLessThanOrEqual(1);
      expect(new Set(recipe.ingredients.map(item => item.id)).size).toBe(recipe.ingredients.length);
      expect(recipe.warnings.length).toBeGreaterThan(1);
      for (const alias of [recipe.name, ...recipe.aliases]) expect(findFood(alias)).toBeUndefined();
      for (const ingredient of recipe.ingredients) {
        const food = foods.find((item) => item.id === ingredient.foodId)!;
        expect(food).toBeDefined();
        expect(food.state).not.toBe('dry');
        if (food.state === 'raw') expect(['蔬菜', '水果']).toContain(food.category);
      }
    }
    expect(findRecipe('宫保鸡丁')?.id).toBe('kung-pao-chicken');
  });

  it('缩放份量时各配料及所有营养同步变化', () => {
    const recipe = findRecipe('蛋炒饭')!;
    const full = createRecipeEntry(recipe, recipe.referenceWeightG);
    const half = createRecipeEntry(recipe, recipe.referenceWeightG / 2);
    expect(calculateNutrients(half).energyKcal).toBeCloseTo(calculateNutrients(full).energyKcal! / 2);
    expect(half.recipeSnapshot!.ingredients.find((item) => item.id === 'rice')!.weightG).toBe(100);
  });

  it('新增早餐和汤粥只按实际配料计算，水不伪装成干粮，无额外油不显示油档', () => {
    for (const name of ['小米粥', '白米粥', '南瓜小米粥', '鸡蛋三明治', '无糖拿铁']) {
      const recipe = findRecipe(name)!;
      expect(recipe).toBeDefined();
      const entry = createRecipeEntry(recipe, recipe.referenceWeightG);
      expect(entry.estimateProfile).toBeUndefined();
      const total = entry.recipeSnapshot!.ingredients.reduce((sum, item) => sum + item.nutrientsPer100g.energyKcal! * item.weightG / 100, 0);
      expect(calculateNutrients(entry).energyKcal).toBeCloseTo(total, 10);
      expect(calculateNutrients(createRecipeEntry(recipe, recipe.referenceWeightG / 2)).energyKcal).toBeCloseTo(total / 2, 10);
    }
    const porridge = createRecipeEntry(findRecipe('小米粥')!, 300);
    expect(porridge.recipeSnapshot!.ingredients.find(item => item.id === 'millet')!.foodId).toBe('fdc-168871');
    expect(porridge.recipeSnapshot!.ingredients.find(item => item.id === 'water')!.weightG).toBe(200);
  });

  it('调整实际摄入油量只改变一次油的贡献，汇总不会再累计内部快照', () => {
    const recipe = findRecipe('清炒西兰花')!;
    const original = createRecipeEntry(recipe, recipe.referenceWeightG);
    const changed = createRecipeEntry(recipe, recipe.referenceWeightG, { oil: 0 });
    const oil = findFood('大豆油')!;
    expect(calculateNutrients(original).energyKcal! - calculateNutrients(changed).energyKcal!)
      .toBeCloseTo(oil.nutrientsPer100g.energyKcal! * 8 / 100);
    const snapshotTotal = original.recipeSnapshot!.ingredients.reduce((sum, item) =>
      sum + item.nutrientsPer100g.energyKcal! * item.weightG / 100, 0);
    expect(aggregateNutrients([original]).energyKcal.known).toBeCloseTo(snapshotTotal);
  });
});
