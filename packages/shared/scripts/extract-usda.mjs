/**
 * 教学：应用不通过 AI 生成营养数据。这个离线脚本将官方 CSV 的 fdc_id
 * 和 nutrient_id 关联，保留来源后生成浏览器可直接打包的 TypeScript 子集。
 * 先下载 / 解压 README 中的官方 ZIP，再从项目根运行：
 * node packages/shared/scripts/extract-usda.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const dataDirectory = resolve(process.argv[2] ?? '.data-cache/usda-sr-legacy-2018/FoodData_Central_sr_legacy_food_csv_2018-04');
const selection = JSON.parse(readFileSync(new URL('../data/usda-selection.json', import.meta.url), 'utf8'));
const sourceUrl = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';

// 支持 CSV 引号、引号内逗号及双引号转义；不靠 split(',') 截断描述。
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((values) => values.length === headers.length)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}
const foodCsv = readFileSync(resolve(dataDirectory, 'food.csv'), 'utf8');
const nutrientsCsv = readFileSync(resolve(dataDirectory, 'food_nutrient.csv'), 'utf8');
const foodMap = new Map(parseCsv(foodCsv).map((food) => [Number(food.fdc_id), food]));
const chosenIds = new Set(selection.map(([id]) => id));
if (chosenIds.size !== selection.length) throw new Error('选择清单有重复的 fdc_id');
const categories = new Set(['主食', '肉类', '水产', '蛋与豆制品', '奶类', '蔬菜', '水果', '坚果种子', '油脂调味', '饮品', '零食']);
const states = new Set(['raw', 'cooked', 'ready', 'dry']);
const normalizeName = (name) => name.trim().toLowerCase().replace(/[\s（）()]/g, '');
const nutrientMap = new Map();
// USDA nutrient ID 1008 是 kcal；1062 是 kJ，不能混用。
const fieldMapping = { 1008: 'energyKcal', 1003: 'proteinG', 1004: 'fatG', 1005: 'carbsG' };
for (const row of parseCsv(nutrientsCsv)) {
  const fdcId = Number(row.fdc_id);
  const field = fieldMapping[row.nutrient_id];
  if (!chosenIds.has(fdcId) || !field) continue;
  if (!nutrientMap.has(fdcId)) nutrientMap.set(fdcId, { energyKcal: null, proteinG: null, fatG: null, carbsG: null });
  const amount = Number(row.amount);
  if (!row.amount || !Number.isFinite(amount) || amount < 0) throw new Error(`无效营养值 ${fdcId}/${field}`);
  nutrientMap.get(fdcId)[field] = amount;
}
const seenNames = new Map();
const foods = selection.map(([fdcId, name, aliases, state, category]) => {
  const record = foodMap.get(fdcId);
  if (!record || !nutrientMap.has(fdcId)) throw new Error(`官方数据缺少 FDC ${fdcId}`);
  if (!states.has(state)) throw new Error(`无效状态 ${fdcId}`);
  if (!categories.has(category)) throw new Error(`无效分类 ${fdcId} ${category ?? ''}`);
  for (const label of [name, ...aliases]) {
    const key = normalizeName(label);
    if (!key) throw new Error(`空名称 ${fdcId}`);
    if (seenNames.has(key)) throw new Error(`名称冲突「${label}」：FDC ${seenNames.get(key)} 与 ${fdcId}`);
    seenNames.set(key, fdcId);
  }
  return {
    id: `fdc-${fdcId}`, name, aliases, state, category,
    nutrientsPer100g: nutrientMap.get(fdcId),
    source: {
      fdcId, description: record.description, dataset: 'USDA SR Legacy', version: '2018-04',
      publicationDate: record.publication_date,
      url: `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`, downloadUrl: sourceUrl,
    },
  };
});
writeFileSync(new URL('../src/usda-foods.generated.ts', import.meta.url),
  '// 此文件由 packages/shared/scripts/extract-usda.mjs 从 USDA 官方 CSV 生成，请勿手改营养数值。\n'
  + "import type { FoodDefinition } from './food-data.js';\n"
  + `export const usdaFoods: FoodDefinition[] = ${JSON.stringify(foods, null, 2)};\n`);
const zipPath = resolve(dataDirectory, '../..', 'usda-sr-legacy-2018.zip');
console.log(JSON.stringify({ count: foods.length, source: sourceUrl,
  foodCsvSha256: createHash('sha256').update(foodCsv).digest('hex'),
  nutrientCsvSha256: createHash('sha256').update(nutrientsCsv).digest('hex'),
  zipSha256: existsSync(zipPath) ? createHash('sha256').update(readFileSync(zipPath)).digest('hex') : null,
}, null, 2));
