import { foods, catalogFoods, recipes, foodCategories, packagedCatalogItems, createId, createFoodEntry, createEstimatedFoodEntry, applyEstimateLevel, packagedEntry, packageNutrientsPer100g, labelNutrients, createRecipeEntry, rangesToMidpoints, selectedEstimateOption, normalizeFoodName, type LibraryFood, type PackagedFood, type PackagedCategory, type FoodEntry, type EstimatedFood, type Nutrients, type NumericRange } from '@shike/shared'
import { resizeEntry } from './entries'
import { applyTypicalPortion } from './typical-portions'

/**
 * 选择器的纯逻辑层：完整原始foods用于旧ID/配方，精简catalogFoods用于新选择。
 * buildFoodChoices合并公共库、配方、AI估算、个人包装、收藏及当前历史快照。
 * 搜索可扩展同义词；自动识别匹配仍走entries.matchedEntry的精确规则，不能混为一谈。
 * 推荐是本地启发式排序，不是视觉概率，也不自动改条目；WeakMap缓存搜索文本。
 * FoodPicker.vue负责弹窗、收藏星标和每次60项展示；星标操作不触发选择/添加。
 */
export interface FoodChoice {
  id: string
  name: string
  originalName?: string
  aliases: string[]
  category: string
  origin: 'database' | 'recipe' | 'personal' | 'ai' | 'snapshot' | 'package' | 'saved'
  state?: 'raw' | 'cooked' | 'ready' | 'dry'
  description: string
  searchText: string
  nutrientsPer100g: Nutrients
  energyRange: NumericRange | null
  nutritionPerUnit?: { value: Nutrients; unitLabel: string }
  packageCategory?: PackagedCategory
}
export interface FoodMatchContext { name: string; visibleIngredients: string[] }
export interface FoodRecommendation { choice: FoodChoice; reason: string }
// 即食蔬果保留；生肉、生蛋、待烹调蔬菜及需复水的干粮移到“包含生重食材”。
const rawEdibleIds = new Set(['fdc-170457', 'fdc-168409', 'fdc-169225', 'fdc-169249', 'fdc-169247', 'fdc-169248', 'fdc-169387', 'fdc-168421', 'fdc-169276', 'fdc-170108', 'fdc-169383', 'fdc-170427', 'fdc-169997'])
export function isEverydayFood(choice: FoodChoice): boolean {
  if (choice.origin !== 'database') return true
  if (choice.state === 'raw') return rawEdibleIds.has(choice.id) || choice.category === '水果' || (choice.category === '蔬菜' && /番茄|黄瓜|生菜|芝麻菜/.test(choice.name))
  if (choice.state === 'dry') return ['水果', '零食', '油脂调味'].includes(choice.category)
  return true
}
export const foodStateLabels = { raw: '生重', cooked: '熟重', ready: '即食', dry: '干重' } as const
export const categorySymbols: Record<string, string> = { 主食: '🍚', 家常菜: '🍲', 熟食菜肴: '🥘', 汤羹: '🥣', 轻食早餐: '🥪', 肉类: '🥩', 水产: '🐟', 蛋与豆制品: '🥚', 奶类: '🥛', 蔬菜: '🥬', 水果: '🍎', 坚果种子: '🥜', 油脂调味: '🫒', 饮品: '☕', 零食: '🍪', 我的食物: '📒', 本次识别: '✨', 当前记录: '🍽️' }
categorySymbols['包装食品'] = '📦'
export const pickerCategories = ['常用食物', '收藏', '全部', '我的食物', '包装食品', '家常菜', '轻食早餐', ...foodCategories, '本次识别', '当前记录']
const packageBasis = { '100g': '每100 g', '100ml': '每100 mL', serving: '每份', package: '每包', unknown: '基准待确认' }

const foodById = new Map(foods.map(food => [food.id, food]))
// 食物库只建立浏览索引，不改写 USDA 营养值；配方按原有普通油档展示。
const baseChoices: FoodChoice[] = [
  ...catalogFoods.map(food => ({ id: food.id, name: food.name, ...(food.originalName ? { originalName: food.originalName } : {}), aliases: food.aliases, category: food.category, origin: 'database' as const, state: food.state, description: food.source.dataset === 'TFDA 食品营养成分' ? 'TFDA 成品参考 · 请核对做法' : food.source.dataset === 'USDA FNDDS' ? `膳食参考 · ${food.state === 'ready' ? '请核对做法' : foodStateLabels[food.state]}` : `基础食物 · ${foodStateLabels[food.state]}`, searchText: [food.name, ...food.aliases, food.source.description].join(' '), nutrientsPer100g: food.nutrientsPer100g, energyRange: null })),
  ...recipes.map(recipe => {
    const entry = createRecipeEntry(recipe, recipe.referenceWeightG)
    const ingredientNames = recipe.ingredients.filter(ingredient => ingredient.id !== 'oil').flatMap(ingredient => { const food = foodById.get(ingredient.foodId); return food ? [food.name, ...food.aliases] : [] })
    return { id: recipe.id, name: recipe.name, aliases: recipe.aliases, category: recipe.category ?? '家常菜', origin: 'recipe' as const, state: 'ready' as const, description: '参考配方 · 可调整配料', searchText: [recipe.name, ...recipe.aliases, ...ingredientNames].join(' '), nutrientsPer100g: entry.nutrientsPer100g, energyRange: entry.estimateProfile ? selectedEstimateOption(entry.estimateProfile).rangesPer100g.energyKcal : null }
  }),
]

function snapshotChoice(entry: FoodEntry, id: string, origin: 'ai' | 'snapshot'): FoodChoice {
  const nutritionPerUnit = entry.packageSnapshot ? { value: labelNutrients(entry.packageSnapshot.label), unitLabel: packageBasis[entry.packageSnapshot.label.basis] } : entry.volumeSnapshot ? { value: entry.volumeSnapshot.nutrientsPer100ml, unitLabel: '每100 mL' } : undefined
  return { id, name: entry.name, aliases: [], category: origin === 'ai' ? '本次识别' : '当前记录', origin, description: origin === 'ai' ? entry.aiEstimateSnapshot?.provider === 'mock' ? '模拟 AI 估算 · 非实测' : 'AI 估算 · 非实测' : '已保存的营养快照', searchText: entry.name, nutrientsPer100g: entry.nutrientsPer100g, ...(nutritionPerUnit ? { nutritionPerUnit } : {}), energyRange: entry.estimateProfile ? selectedEstimateOption(entry.estimateProfile, entry.estimateLevel ?? 'medium').rangesPer100g.energyKcal : null }
}

export function buildFoodChoices(personal: EstimatedFood[], aiCandidate?: FoodEntry, current?: { entry: FoodEntry; selectedId: string }, packagedFoods: PackagedFood[] = [], libraryFoods: LibraryFood[] = []): FoodChoice[] {
  const choices: FoodChoice[] = [...baseChoices, ...personal.filter(food => food.provider !== 'mock' && Object.values(food.nutrientsPer100g).some(value => value !== null)).map(food => ({
    id: `personal:${food.id}`, name: food.name, aliases: [], category: '我的食物', origin: 'personal' as const,
    description: '个人食物 · AI 估算', searchText: food.name,
    nutrientsPer100g: food.estimateProfile ? rangesToMidpoints(selectedEstimateOption(food.estimateProfile).rangesPer100g) : food.nutrientsPer100g,
    energyRange: food.estimateProfile ? selectedEstimateOption(food.estimateProfile).rangesPer100g.energyKcal : null,
  }))]
  choices.push(...packagedCatalogItems(packagedFoods).map(({ food, aliases, category, originalName, nameTranslation }) => ({ id: `package:${food.id}`, name: food.name, ...(originalName && originalName !== food.name ? { originalName } : {}), aliases, category: '包装食品', packageCategory: category, origin: 'package' as const, description: [food.brand, food.label.netContent ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(food.label.netContent.amount) + ' ' + (food.label.netContent.unit === 'ml' ? 'mL' : 'g') : '', food.barcode, nameTranslation === 'category' ? '中文类别提示 · 非完整译名' : nameTranslation === 'translated' ? '中文译名参考' : '', food.source ? 'OFF · 请核对标签' : '个人包装标签'].filter(Boolean).join(' · '), searchText: [food.name, ...aliases, food.brand, food.barcode].join(' '), nutrientsPer100g: packageNutrientsPer100g(food.label), energyRange: null, nutritionPerUnit: { value: labelNutrients(food.label), unitLabel: packageBasis[food.label.basis] } })))
  for (const saved of libraryFoods) {
    if (saved.origin === 'library' && choices.some(choice => choice.id === saved.choiceId)) continue
    const choice = snapshotChoice(saved.entry, saved.choiceId, 'snapshot')
    choices.push({ ...choice, origin: 'saved', category: '我的食物', description: saved.origin === 'ai' ? `个人保存 · ${saved.entry.kind === 'ai' ? 'AI粗估，非实测' : '识别后核对的快照'}` : saved.origin === 'library' ? '收藏的历史食物快照' : '个人保存 · 营养快照' })
  }
  if (aiCandidate) choices.unshift(snapshotChoice(aiCandidate, 'ai-current', 'ai'))
  if (current?.selectedId) {
    const index = choices.findIndex(choice => choice.id === current.selectedId)
    const snapshot = snapshotChoice(current.entry, current.selectedId, 'snapshot')
    // 已选条目展示当前档位，不把历史少油／多油误显示为普通档；再次选中不会重置。
    if (index >= 0) choices[index] = { ...choices[index]!, nutrientsPer100g: snapshot.nutrientsPer100g, energyRange: snapshot.energyRange, ...(snapshot.nutritionPerUnit ? { nutritionPerUnit: snapshot.nutritionPerUnit } : {}) }
    else choices.unshift(snapshot)
  }
  return choices
}

/** 内置食品创建本餐快照，个人食品沿用可编辑的保存份量；mL标签不能套用旧食物的g。 */
export function entryForFoodChoice(id: string, weightG: number | null, personal: EstimatedFood[], packagedFoods: PackagedFood[], libraryFoods: LibraryFood[] = []): FoodEntry | null {
  const entry = rawFoodChoice(id, weightG, personal, packagedFoods, libraryFoods)
  return entry ? applyTypicalPortion(entry) : null
}
function rawFoodChoice(id: string, weightG: number | null, personal: EstimatedFood[], packagedFoods: PackagedFood[], libraryFoods: LibraryFood[] = []): FoodEntry | null {
  const saved = libraryFoods.find(food => food.choiceId === id)
  // 个人食品复用完整营养／配方／份量快照，新记录必须生成新ID，避免多次添加串联编辑。
  if (saved && (saved.origin !== 'library' || !buildFoodChoices(personal, undefined, undefined, packagedFoods).some(choice => choice.id === id))) {
    const entry = JSON.parse(JSON.stringify(saved.entry)) as FoodEntry
    entry.id = createId()
    if (weightG !== null && !entry.packageSnapshot && !entry.volumeSnapshot) resizeEntry(entry, weightG)
    return entry
  }
  const packaged = id.startsWith('package:') ? packagedCatalogItems(packagedFoods).find(item => item.food.id === id.slice(8))?.food : undefined
  if (packaged) return packagedEntry(packaged)
  const food = foods.find(food => food.id === id)
  if (food) return createFoodEntry(food, weightG)
  const recipe = recipes.find(recipe => recipe.id === id)
  if (recipe) { const entry = createRecipeEntry(recipe, weightG && weightG > 0 ? weightG : recipe.referenceWeightG); entry.weightG = weightG; return entry }
  const estimated = personal.find(food => `personal:${food.id}` === id)
  if (estimated) { const entry = createEstimatedFoodEntry(estimated, weightG); return estimated.estimateProfile ? applyEstimateLevel(entry, 'medium') : entry }
  return null
}

const searchIndices = new WeakMap<FoodChoice, string>()
// 只扩展检索同义词，不据此改变自动匹配或营养值，用户仍需核对具体做法。
const searchKey = (value: string) => normalizeFoodName(value).replace(/西红柿|蕃茄/g, '番茄').replace(/马铃薯/g, '土豆').replace(/朱古力/g, '巧克力').replace(/花椰菜/g, '花菜').replace(/包含/g, '含有')
export function searchFoodChoices(choices: FoodChoice[], query: string, category = '全部'): FoodChoice[] {
  const tokens = query.toLowerCase().trim().split(/[\s,，、]+/).map(searchKey).filter(Boolean)
  const results = choices.filter(choice => {
    if (category !== '全部' && choice.category !== category) return false
    if (!tokens.length) return true
    let index = searchIndices.get(choice)
    // 保留词段边界：“卷心菜 包菜”不能拼成“菜包”，英文多词仍可逐词搜索。
    if (index === undefined) { index = choice.searchText.split(/\s+/).map(searchKey).join('\0'); searchIndices.set(choice, index) }
    // “肉包”不能因为子串命中“无肉包子”而推荐给用户。
    if (tokens.some(token => /肉包|鲜肉|猪肉/.test(token)) && /无肉|素食|素包/.test(choice.name)) return false
    return tokens.every(token => index.includes(token))
  })
  if (!tokens.length) return results
  // 精确名称/别名放在配料、说明文字之前，避免中式条目埋在几千项结果后面。
  const rank = (choice: FoodChoice) => {
    const names = [choice.name, ...choice.aliases].map(searchKey)
    return tokens.every(token => names.includes(token)) ? 0 : tokens.every(token => names.some(name => name.includes(token))) ? 1 : 2
  }
  return results.sort((a, b) => rank(a) - rank(b))
}

const ingredientGroups: Array<[string, RegExp]> = [
  ['番茄', /番茄|西红柿/], ['鸡蛋', /鸡蛋|炒蛋|全蛋|蛋清|蛋黄|蛋花/], ['西兰花', /西兰花|花椰菜/], ['土豆', /土豆|马铃薯/],
  ['鸡肉', /鸡肉|鸡胸|鸡腿|鸡翅/], ['牛肉', /牛肉|牛腩|牛排/], ['猪肉', /猪肉|肉丝|里脊|排骨|猪排/], ['鱼', /鱼|鲑|鳕|三文/], ['虾', /虾/],
  ['豆腐', /豆腐|豆干|豆皮/], ['红豆', /红豆|赤小豆/], ['燕麦', /燕麦/], ['玉米', /玉米/], ['南瓜', /南瓜/], ['蘑菇', /蘑菇|香菇|菌菇/],
  ['牛奶', /牛奶|乳饮|拿铁/], ['酸奶', /酸奶/], ['苹果', /苹果/], ['香蕉', /香蕉/], ['蓝莓', /蓝莓/],
]
const familyGroups: Array<[string, RegExp]> = [
  ['包点', /包子|菜包(?!含)|肉包|豆沙包|芝麻包|叉烧包|牛肉包|鸡肉包|馒头|花卷/],
  ['粥食', /粥|米糊|谷物糊/], ['米饭', /米饭|炒饭|盖饭|盖浇|烩饭|糙米|糯米饭/], ['面食', /面条|汤面|拌面|拉面|挂面|意面|意大利面|米粉|粉丝|粉条/],
  ['面包', /面包|吐司|馒头|花卷/], ['沙拉', /沙拉/], ['咖啡', /咖啡|拿铁|美式/], ['奶茶', /奶茶/], ['豆类', /豆浆|红豆|绿豆|黑豆|黄豆/],
]
const tags = (text: string, groups: Array<[string, RegExp]>) => groups.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
function bigrams(text: string): Set<string> {
  const value = normalizeFoodName(text)
  return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)))
}
function similarity(a: Set<string>, b: Set<string>): number {
  return a.size && b.size ? 2 * [...a].filter(token => b.has(token)).length / (a.size + b.size) : 0
}
const recommendationIndices = new WeakMap<FoodChoice, { names: string[]; grams: Set<string>[]; ingredients: string[]; families: string[] }>()
function recommendationIndex(choice: FoodChoice) {
  let cached = recommendationIndices.get(choice)
  if (!cached) {
    const names = [choice.name, ...choice.aliases].map(value => normalizeFoodName(value).replace(/包含/g, '含有'))
    cached = { names, grams: names.map(bigrams), ingredients: tags(choice.searchText, ingredientGroups), families: tags(choice.name, familyGroups) }
    recommendationIndices.set(choice, cached)
  }
  return cached
}

/** 本地相关性排序，不是视觉模型概率，也不据此自动替换用户选择。 */
export function recommendFoodChoices(choices: FoodChoice[], context: FoodMatchContext, limit = 6): FoodRecommendation[] {
  const name = normalizeFoodName(context.name)
  if (!name) return []
  const grams = bigrams(name)
  const contextText = [context.name, ...context.visibleIngredients].join(' ')
  const ingredients = tags(contextText, ingredientGroups), families = tags(context.name, familyGroups)
  const cooked = /熟|炒|蒸|煮|炖|烤|炸|焖|卤|粥|米饭|汤面/.test(context.name)
  const dryOrRaw = /生重|干重|未煮|生米|生肉|干燕麦|燕麦片|干面/.test(context.name) && !cooked
  return choices.map((choice, index) => {
    const cached = recommendationIndex(choice)
    const names = cached.names
    const exact = names.includes(name)
    const contained = names.some(candidate => Math.min(candidate.length, name.length) >= 2 && (candidate.includes(name) || name.includes(candidate)))
    const closeness = Math.max(...cached.grams.map(candidate => similarity(candidate, grams)))
    const candidateIngredients = cached.ingredients
    const sharedIngredients = ingredients.filter(tag => candidateIngredients.includes(tag))
    const candidateFamilies = cached.families
    const sharedFamilies = families.filter(tag => candidateFamilies.includes(tag))
    let score = (exact ? 180 : contained ? 85 : 0) + closeness * 70 + sharedIngredients.length * 18 + sharedFamilies.length * 35
    if (/肉包|鲜肉|猪肉/.test(context.name) && /无肉|素食|素包/.test(choice.name)) score -= 300
    if (choice.origin === 'recipe' && sharedIngredients.length >= 2) score += 10
    // 粥／熟饭不推荐干谷物，熟肉不推荐生肉。搜索仍可查看这些条目并明确核对口径。
    if (!exact && ((cooked && (choice.state === 'raw' || choice.state === 'dry')) || (dryOrRaw && choice.state === 'cooked'))) score -= 180
    const evidence = exact || contained || closeness >= .3 || sharedIngredients.length > 0 || sharedFamilies.length > 0
    const reason = exact ? choice.origin === 'personal' ? '个人库中有同名食物' : '名称相符' : sharedIngredients.length ? `配料接近：${sharedIngredients.slice(0, 2).join('、')}` : sharedFamilies.length ? `同类${sharedFamilies[0]}` : '名称接近'
    return { choice, reason, score, evidence, index }
  }).filter(item => item.evidence && item.score >= 30).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(({ choice, reason }) => ({ choice, reason }))
}
