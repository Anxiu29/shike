import { writeFile } from 'node:fs/promises';
import { catalogFoods, foodCatalog, foodMergeLimits, foods } from '../packages/shared/dist/index.js';

// 先构建shared再运行。报告可重复生成，不含用户记录、照片或密钥。
const original = new Map(foods.map(food => [food.id, food]));
const groups = foodCatalog.consolidations.map(group => ({
  representativeId: group.representativeId,
  members: group.memberIds.map(id => {
    const food = original.get(id);
    if (!food) throw new Error(`缺少原始食物 ${id}`);
    return { id, name: food.name, state: food.state, nutrientsPer100g: food.nutrientsPer100g, sourceUrl: food.source.url };
  }),
}));
const report = { schemaVersion: 1, rule: 'packages/shared/src/food-curation.ts', thresholdsPer100g: foodMergeLimits,
  originalCount: foods.length, availableCount: catalogFoods.length, removedCount: foodCatalog.removedCount, groups };
await writeFile(new URL('../packages/shared/data/food-curation-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`原始${foods.length}项，可选${catalogFoods.length}项，${groups.length}组合并${foodCatalog.removedCount}项。`);
