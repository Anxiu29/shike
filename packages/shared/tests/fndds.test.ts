import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateNutrients, createFoodEntry, findFood, findRecipe, foods, nutrientsSchema } from '../src/index.js';
import { surveyFoods } from '../src/fndds-foods.generated.js';

const survey = foods.filter(food => food.source.dataset === 'USDA FNDDS');
const manifest = JSON.parse(readFileSync(new URL('../data/fndds-import-manifest.json', import.meta.url), 'utf8'));

describe('USDA FNDDS 膳食参考扩库', () => {
  it('导入清单与公开条目一致，每条可追溯且营养数据合法', () => {
    expect(survey.length).toBeGreaterThan(5000);
    expect(manifest.importedCount).toBe(survey.length);
    expect(manifest.originalCount).toBe(survey.length + Object.values<number>(manifest.skipped).reduce((sum, count) => sum + count, 0));
    expect(manifest.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    // 该清单描述营养原始导入表；后续中文展示补译另有独立清单，不能改写营养源。
    expect(manifest.chineseSearchNames).toBe(surveyFoods.filter(food => /[\u3400-\u9fff]/.test(food.name)).length);
    expect(manifest.fullyChineseNames).toBe(surveyFoods.filter(food => !/[a-z]/i.test(food.name)).length);
    for (const food of survey) {
      expect(food.source.version).toBe('2021-2023');
      expect(food.source.foodCode).toMatch(/^\d{8}$/);
      expect(food.source.downloadUrl).toBe(manifest.sourceUrl);
      expect(food.source.description).not.toBe('');
      expect(nutrientsSchema.safeParse(food.nutrientsPer100g).success).toBe(true);
    }
  });

  it('包子样本原值按每 100 g 换算，不伪装为指定馅料或模型营养值', () => {
    // 官方 JSON FDC 2708724 / Bao bun：保留原始数值，不从图片或食物名称推导。
    const bao = findFood('包子')!;
    expect(bao.source.fdcId).toBe(2708724);
    expect(bao.source.description).toBe('Bao bun');
    expect(bao.name).toContain('未注明馅料');
    expect(bao.nutrientsPer100g).toEqual({ energyKcal: 273, proteinG: 11.2, fatG: 7.58, carbsG: 39.8 });
    const entry = createFoodEntry(bao, 200);
    expect(calculateNutrients(entry).energyKcal).toBe(546);
    expect(entry.provenance).toContain('USDA FNDDS 2021-2023');
    expect(entry.warnings.join(' ')).toContain('美国常见配方');
    expect(entry.estimateProfile).toBeUndefined(); // 没有来源支持的区间不能凭空补齐。
  });

  it('新增常见食物可用中文匹配，已有基础食物与配方仍优先', () => {
    for (const name of ['包子', '蒸饺', '寿司', '水果司康', '熟绿豆粉丝', '馄饨汤']) {
      expect(findFood(name)?.source.dataset).toBe('USDA FNDDS');
    }
    expect(findFood('米饭')?.source.fdcId).toBe(168878);
    expect(findFood('三文鱼沙拉')).toBeUndefined();
    expect(findRecipe('三文鱼沙拉')).toBeDefined();
    const salmon = survey.find(food => food.source.description === 'Salmon salad')!;
    expect(salmon.name).toContain('膳食参考');
    expect(findFood(salmon.name)?.id).toBe(salmon.id);
  });

  it('生熟、糖油和食物变体分别保留，历史快照与库对象隔离', () => {
    const regular = survey.find(food => food.source.description === 'Coffee, Latte')!;
    const nonfat = survey.find(food => food.source.description === 'Coffee, Latte, nonfat')!;
    expect(regular.id).not.toBe(nonfat.id);
    expect(nonfat.name).toContain('脱脂');
    expect(regular.nutrientsPer100g).not.toEqual(nonfat.nutrientsPer100g);
    const entry = createFoodEntry(regular, 130);
    entry.nutrientsPer100g.energyKcal = 1;
    expect(regular.nutrientsPer100g.energyKcal).not.toBe(1);
    expect(findFood('油炸西兰花')?.source.description).toMatch(/fried/i);
    expect(findFood('油炸西兰花')?.id).not.toBe(findFood('西兰花')?.id);
  });
});
