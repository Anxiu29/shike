/**
 * 从 USDA 官方 FNDDS JSON 提取成人日常食物。中文索引由本地词表生成，
 * 营养值只能来自原始 nutrient.id / amount；缺失为 null，不调用 AI 补数。
 * 用法：node packages/shared/scripts/extract-fndds.mjs [surveyDownload.json]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { glossary, curated } from '../data/fndds-localization.mjs'
// 项目使用 Node 24，直接剥离类型读取配方源码，不依赖可能过期的 dist。
import { recipes } from '../src/recipes.ts'

const inputPath = resolve(process.argv[2] ?? '.data-cache/usda-fndds-2021-2023/surveyDownload.json')
const zipPath = resolve('.data-cache/usda-fndds-2021-2023.zip')
const sourceUrl = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip'
const source = readFileSync(inputPath)
const original = JSON.parse(source.toString('utf8')).SurveyFoods
if (!Array.isArray(original)) throw new Error('官方 JSON 缺少 SurveyFoods')
const normalize = value => value.trim().toLowerCase().replace(/[\s（）()]/g, '')
const existingNames = new Set(JSON.parse(readFileSync(new URL('../data/usda-selection.json', import.meta.url), 'utf8')).flatMap(([, name, aliases]) => [name, ...aliases].map(normalize)))
for (const recipe of recipes) for (const name of [recipe.name, ...recipe.aliases]) existingNames.add(normalize(name))
const phraseMap = new Map()
for (const [key, value] of Object.entries(glossary)) if (!phraseMap.has(key.toLowerCase())) phraseMap.set(key.toLowerCase(), value)
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phrasePattern = new RegExp(`\\b(?:${[...phraseMap.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`, 'gi')
export function translateDescription(description) {
  const parts = description.split(/[,;]/).map(part => part.trim()).filter(Boolean).map(part => glossary[part] ?? part.replace(phrasePattern, match => phraseMap.get(match.toLowerCase())))
  return (parts.length > 1 ? `${parts[0]}（${parts.slice(1).join('；')}）` : parts[0]).replace(/\s+(?=[\u3400-\u9fff])/g, '').replace(/(?<=[\u3400-\u9fff])\s+/g, '').trim()
}

function categoryFor(value) {
  const c = value.toLowerCase()
  if (/condiment|pasta sauces|dips, gravies|salad dressing|mayonnaise|sugars|sugar substitute|butter and animal fats|margarine|jams, syrups/.test(c)) return '油脂调味'
  if (/soups|broth|ramen/.test(c)) return '汤羹'
  if (/sandwich|burger|burrito|taco|pizza|pasta|noodle|rice|oatmeal|cooked cereal|grits|yeast bread|rolls and buns|bagels|muffins|tortilla|pancake|waffle|french toast|cereal,/.test(c)) return '主食'
  if (/mixed dishes|stir-fry|mixtures|vegetable dishes|legume dishes|egg rolls|dumpling|sushi|mexican mixed|nachos/.test(c)) return '熟食菜肴'
  if (/beef|pork|chicken|turkey|duck|poultry|meat|sausage|bacon|frankfurter|liver|organ|lamb|goat|game/.test(c)) return '肉类'
  if (/fish|shellfish/.test(c)) return '水产'
  if (/eggs|omelets|soy and meat-alternative|beans, peas, legumes/.test(c)) return '蛋与豆制品'
  if (/milk,|yogurt|cheese|cottage|ricotta|cream and cream|cream cheese/.test(c) && !/shake/.test(c)) return '奶类'
  if (/nuts and seeds/.test(c)) return '坚果种子'
  if (/juice|drink|beverage|milk shakes|plant-based milk|coffee|tea$|beer|wine|liquor|cocktail|water|smoothie/.test(c)) return '饮品'
  if (/fruit|apples|bananas|melons|grapes|mango|papaya|peach|nectarine|pears|pineapple|blueberr|strawberr/.test(c)) return '水果'
  if (/vegetable|potato|broccoli|lettuce|spinach|carrot|tomato|olive|pickle|bean|cabbage|corn$|onion/.test(c)) return '蔬菜'
  if (/condiment|sauce|dip|grav|butter|fats|margarine|mayonnaise|salad dress|sugars|honey|sugar substitute|jam|syrup/.test(c)) return '油脂调味'
  return '零食'
}
function stateFor(description, category) {
  if (/\b(raw|uncooked)\b/i.test(description) && !/from raw/i.test(description)) return ['水果', '坚果种子'].includes(category) ? 'ready' : 'raw'
  if (/not reconstituted|as ingredient/i.test(description) || (/dry mix|\bpowder\b/i.test(description) && !/prepared|reconstituted|water added|made with/i.test(description))) return 'dry'
  if (/\b(cooked|fried|baked|broiled|roasted|grilled|boiled|steamed|stewed|braised|scrambled|sauteed|poached)\b/i.test(description)) return 'cooked'
  return 'ready'
}
const rows = [], skipped = {}, collisions = []
const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1 }
const nutrientIds = { 1008: ['energyKcal', 'kcal', 1000], 1003: ['proteinG', 'g', 100], 1004: ['fatG', 'g', 100], 1005: ['carbsG', 'g', 100] }
const seenIds = new Set()
for (const food of original) {
  const categoryDescription = food.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? ''
  // 婴幼儿专用食品和供调查内部配方拆分使用的未分类项不放入成人日常列表。
  // 营养棒、营养饮品和蛋白粉保留，品牌及干粉／冲调状态由原描述限定。
  if (/baby|infant|toddler|formula|human milk|not included in a food category/i.test(categoryDescription)) { skip('婴幼儿专用或调查未分类条目'); continue }
  const id = food.fdcId
  if (!Number.isSafeInteger(id) || seenIds.has(id)) throw new Error(`重复或无效 FDC ID ${id}`)
  seenIds.add(id)
  const nutrients = { energyKcal: null, proteinG: null, fatG: null, carbsG: null }
  for (const value of food.foodNutrients ?? []) {
    const field = nutrientIds[value.nutrient?.id]
    if (!field) continue
    const [key, unit, maximum] = field
    if (value.nutrient.unitName.toLowerCase() !== unit || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0 || value.amount > maximum) throw new Error(`营养值或单位不合法：${id}/${key}`)
    if (nutrients[key] !== null) throw new Error(`营养字段重复：${id}/${key}`)
    nutrients[key] = value.amount
  }
  if (Object.values(nutrients).every(value => value === null)) { skip('没有可用营养值'); continue }
  const category = categoryFor(categoryDescription)
  let [name, aliases] = curated[id] ?? [translateDescription(food.description), []]
  if (!name || name.length > 180) { skip('描述过长，待人工整理'); continue }
  // 已有常用食物和配方优先。名称冲突时保留“膳食参考”限定，不覆盖旧别名。
  if (existingNames.has(normalize(name))) name += '（膳食参考）'
  if (existingNames.has(normalize(name))) { collisions.push({ id, description: food.description, translated: name }); name += ` #${id}` }
  existingNames.add(normalize(name))
  aliases = aliases.filter(alias => { const key = normalize(alias); if (existingNames.has(key)) return false; existingNames.add(key); return true })
  const state = stateFor(food.description, category)
  rows.push([id, name, aliases, state, category, nutrients.energyKcal, nutrients.proteinG, nutrients.fatG, nutrients.carbsG, food.description, food.foodCode, food.publicationDate])
}
const output = '// 由 extract-fndds.mjs 从 USDA 官方 FNDDS 2021–2023 JSON 生成，勿手改营养值。\n'
  + "import type { FoodDefinition } from './food-data.js';\n"
  + 'type SurveyRow = [number, string, string[], FoodDefinition["state"], FoodDefinition["category"], number|null, number|null, number|null, number|null, string, string, string];\n'
  + `const rows: SurveyRow[] = [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n];\n`
  + 'export const surveyFoods: FoodDefinition[] = rows.map(([fdcId, name, aliases, state, category, energyKcal, proteinG, fatG, carbsG, description, foodCode, publicationDate]) => ({\n'
  + 'id: `fdc-${fdcId}`, name, aliases, state, category, nutrientsPer100g: { energyKcal, proteinG, fatG, carbsG },\n'
  + `source: { fdcId, description, foodCode, dataset: 'USDA FNDDS', version: '2021-2023', publicationDate, url: 'https://fdc.nal.usda.gov/food-details/' + fdcId + '/nutrients', downloadUrl: '${sourceUrl}' }\n}));\n`
writeFileSync(new URL('../src/fndds-foods.generated.ts', import.meta.url), output)
const manifest = { dataset: 'USDA FNDDS', version: '2021-2023', sourceUrl, originalCount: original.length, importedCount: rows.length, skipped,
  sourceSha256: createHash('sha256').update(source).digest('hex'), zipSha256: existsSync(zipPath) ? createHash('sha256').update(readFileSync(zipPath)).digest('hex') : null,
  chineseSearchNames: rows.filter(row => /[\u3400-\u9fff]/.test(row[1])).length, originalEnglishNames: rows.filter(row => !/[\u3400-\u9fff]/.test(row[1])).length,
  fullyChineseNames: rows.filter(row => !/[a-z]/i.test(row[1])).length, disambiguatedNames: collisions.length }
writeFileSync(new URL('../data/fndds-import-manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
if (collisions.length) console.log('名称消歧：', JSON.stringify(collisions.slice(0, 5)))
