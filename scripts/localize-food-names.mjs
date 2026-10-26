import { readFile, writeFile } from 'node:fs/promises';
import { usdaFoods } from '../packages/shared/dist/usda-foods.generated.js';
import { surveyFoods } from '../packages/shared/dist/fndds-foods.generated.js';
import { chineseFoods } from '../packages/shared/dist/chinese-foods.generated.js';
import { foodNameOverrides, translateFoodLabel } from '../packages/shared/data/food-name-glossary.mjs';

// 输入是原始生成表，不能从已翻译的foods索引反复翻译。ID/营养/来源都不在输出中。
const original = [...usdaFoods, ...surveyFoods, ...chineseFoods];
const key = value => value.trim().toLowerCase().replace(/[\s（）()]/g, '');
const owners = new Map(original.flatMap(food => [food.name, ...food.aliases].map(name => [key(name), food.id])));
const rows = [];
for (const food of original) {
  let name = foodNameOverrides[food.id] ?? translateFoodLabel(food.name);
  if (food.source.description.startsWith('Milk,') && /\bwhole\b/i.test(food.source.description)) name = name.replace(/整粒或完整型/g, '全脂');
  if (name === food.name) continue;
  const base = name;
  for (let i = 1; owners.has(key(name)) && owners.get(key(name)) !== food.id; i++) name = `${base}（参考${i === 1 ? '' : i}）`;
  owners.set(key(name), food.id);
  rows.push({ id: food.id, name, originalName: food.name });
}
const root = new URL('../packages/shared/', import.meta.url);
await writeFile(new URL('src/food-names.zh.generated.ts', root), '// 离线中文补译，仅有ID和名称；不包含或修改营养值。\nexport const foodNameTranslations: Record<string, { name: string; originalName: string }> = '
  + JSON.stringify(Object.fromEntries(rows.map(({ id, ...value }) => [id, value])), null, 2) + ';\n');
const after = original.map(food => rows.find(row => row.id === food.id)?.name ?? food.name);
const report = { version: 1, translatedCount: rows.length, total: original.length,
  allChineseBefore: original.filter(food => !/[a-z]{3}/i.test(food.name)).length,
  allChineseAfter: after.filter(name => !/[a-z]{3}/i.test(name)).length,
  noChineseBefore: original.filter(food => !/[\u3400-\u9fff]/.test(food.name)).length,
  noChineseAfter: after.filter(name => !/[\u3400-\u9fff]/.test(name)).length,
  remaining: original.flatMap((food, i) => /[a-z]{3}/i.test(after[i]) ? [{ id: food.id, name: after[i], description: food.source.description }] : []) };
await writeFile(new URL('data/food-translation-report.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, remaining: report.remaining.length }));
