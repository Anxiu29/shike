import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogFoods, createFoodEntry, findFood, findRecipe, foods, builtinPackagedFoods, createRecipeEntry, calculateNutrients, foodCatalog, curateFoodCatalog } from '../src/index.js';
import { usdaFoods } from '../src/usda-foods.generated.js';
import { surveyFoods } from '../src/fndds-foods.generated.js';
import { chineseFoods } from '../src/chinese-foods.generated.js';
import { localizedPackageName, translatePackageName } from '../../../scripts/lib/packaged-name-zh.mjs';
const original = [...usdaFoods, ...surveyFoods, ...chineseFoods];

describe('中文展示名称与历史隔离', () => {
  it('译名不改变ID、营养、生熟状态、原始来源或近似合并代表，所有名称均有中文', () => {
    const byId = new Map(foods.map(food => [food.id, food]));
    expect(byId.size).toBe(original.length);
    expect(foods.every(food => /[\u3400-\u9fff]/.test(food.name))).toBe(true);
    for (const food of original) {
      const current = byId.get(food.id)!;
      expect(current.nutrientsPer100g).toEqual(food.nutrientsPer100g);
      expect(current.source).toEqual(food.source);
      expect(current.state).toBe(food.state);
    }
    const before = curateFoodCatalog(original);
    expect(foodCatalog.consolidations).toEqual(before.consolidations);
    expect(catalogFoods.map(food => food.id)).toEqual(before.foods.map(food => food.id));
  });
  it('补译保留原文和旧名称精确检索，旧餐食快照不被改名或重算', () => {
    const milk = foods.find(food => food.id === 'fdc-2705385')!;
    expect(milk.name).toContain('全脂'); expect(milk.name).not.toContain('整粒');
    expect(findFood('牛奶（整粒或完整型）')!.id).toBe(milk.id);
    const old = original.find(food => food.id === milk.id)!, history = createFoodEntry(old, 150);
    expect(history.name).toBe(old.name); expect(history.name).not.toBe(milk.name);
    expect(history.nutrientsPer100g).toEqual(createFoodEntry(milk, 150).nutrientsPer100g);
    const parfait = foods.find(food => food.id === 'fdc-2705450')!;
    expect(parfait.name).toContain('分层甜品'); expect(parfait.aliases).toContain('酸奶parfait（配水果）');
    expect(parfait.originalName).toBe('Yogurt parfait, with fruit');
  });
  it('新增中式食品和配方可匹配，熟重份量同比缩放，不把一份饭重复计数', () => {
    for (const name of ['茶叶蛋', '卤蛋', '鸡蛋羹', '莲雾', '杨桃', '红心火龙果', '珍珠奶茶半糖']) expect(findFood(name)).toBeDefined();
    for (const name of ['皮蛋瘦肉粥', '青椒炒鸡蛋', '香菇烧豆腐', '番茄鸡蛋盖饭']) {
      const recipe = findRecipe(name)!; expect(recipe).toBeDefined();
      const one = createRecipeEntry(recipe, 150), two = createRecipeEntry(recipe, 300);
      expect(calculateNutrients(two).energyKcal).toBeCloseTo(calculateNutrients(one).energyKcal! * 2);
      expect(one.recipeSnapshot!.ingredients.some(food => /干大米|生面粉/.test(food.name))).toBe(false);
    }
  });
});

describe('包装中文译名与原名', () => {
  it('原名、品牌、否定和风味词保留含义，分类提示不伪装完整翻译', () => {
    expect(translatePackageName('Sugar free milk chocolate')).toBe('无糖牛奶巧克力');
    expect(translatePackageName('No added sugar blueberry yogurt')).toContain('无添加糖');
    expect(translatePackageName('Artificial beef flavour instant noodles')).toContain('人工调味牛肉风味方便面');
    expect(translatePackageName('Hot chocolate')).toBe('热巧克力饮品');
    expect(localizedPackageName({ product_name: 'Milk', product_name_zh: '纯牛奶' }, '特仑苏纯牛奶').name).toBe('特仑苏纯牛奶');
    const hint = localizedPackageName({ product_name: 'Unknown Brand X', categories_tags: ['en:biscuits'] }, 'Unknown Brand X', { 'en:biscuits': { name: { zh: '饼干' } } });
    expect(hint).toMatchObject({ kind: 'category', originalName: 'Unknown Brand X' }); expect(hint.name).toContain('饼干');
    expect(localizedPackageName({ product_name: 'Unknown X' }, 'Unknown X').kind).toBe('untranslated');
  });
  it('原商品名和中文均可保留，同条码标签单位和数值不因翻译改变', () => {
    const report = JSON.parse(readFileSync(new URL('../data/packaged-translation-report.json', import.meta.url), 'utf8'));
    expect(report.after.chinese).toBeGreaterThan(900); expect(report.after.chinese).toBeGreaterThan(report.before.chinese);
    const ritter = builtinPackagedFoods.find(item => item.food.barcode === '4000417294005')!;
    expect(ritter.food.name).toContain('可可慕斯'); expect(ritter.originalName).toContain('Kakao-Mousse');
    expect(ritter.aliases).toContain('Kakao-Mousse');
    expect(builtinPackagedFoods.some(item => ['6970819492317', '6971453932641'].includes(item.food.barcode!))).toBe(false);
  });
});
