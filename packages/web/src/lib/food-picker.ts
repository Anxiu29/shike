import { foods, recipes, foodCategories, createRecipeEntry, rangesToMidpoints, selectedEstimateOption, normalizeFoodName, type FoodEntry, type EstimatedFood, type Nutrients, type NumericRange } from '@shike/shared'

export interface FoodChoice {
  id: string
  name: string
  aliases: string[]
  category: string
  origin: 'database' | 'recipe' | 'personal' | 'ai' | 'snapshot'
  state?: 'raw' | 'cooked' | 'ready' | 'dry'
  description: string
  searchText: string
  nutrientsPer100g: Nutrients
  energyRange: NumericRange | null
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
export const pickerCategories = ['全部', '家常菜', '轻食早餐', ...foodCategories, '我的食物', '本次识别', '当前记录']

const foodById = new Map(foods.map(food => [food.id, food]))
// 食物库只建立浏览索引，不改写 USDA 营养值；配方按原有普通油档展示。
const baseChoices: FoodChoice[] = [
  ...foods.map(food => ({ id: food.id, name: food.name, aliases: food.aliases, category: food.category, origin: 'database' as const, state: food.state, description: food.source.dataset === 'USDA FNDDS' ? `膳食参考 · ${food.state === 'ready' ? '请核对做法' : foodStateLabels[food.state]}` : `基础食物 · ${foodStateLabels[food.state]}`, searchText: [food.name, ...food.aliases, food.source.description].join(' '), nutrientsPer100g: food.nutrientsPer100g, energyRange: null })),
  ...recipes.map(recipe => {
    const entry = createRecipeEntry(recipe, recipe.referenceWeightG)
    const ingredientNames = recipe.ingredients.filter(ingredient => ingredient.id !== 'oil').flatMap(ingredient => { const food = foodById.get(ingredient.foodId); return food ? [food.name, ...food.aliases] : [] })
    return { id: recipe.id, name: recipe.name, aliases: recipe.aliases, category: recipe.category ?? '家常菜', origin: 'recipe' as const, state: 'ready' as const, description: '参考配方 · 可调整配料', searchText: [recipe.name, ...recipe.aliases, ...ingredientNames].join(' '), nutrientsPer100g: entry.nutrientsPer100g, energyRange: entry.estimateProfile ? selectedEstimateOption(entry.estimateProfile).rangesPer100g.energyKcal : null }
  }),
]

function snapshotChoice(entry: FoodEntry, id: string, origin: 'ai' | 'snapshot'): FoodChoice {
  return { id, name: entry.name, aliases: [], category: origin === 'ai' ? '本次识别' : '当前记录', origin, description: origin === 'ai' ? entry.aiEstimateSnapshot?.provider === 'mock' ? '模拟 AI 估算 · 非实测' : 'AI 估算 · 非实测' : '已保存的营养快照', searchText: entry.name, nutrientsPer100g: entry.nutrientsPer100g, energyRange: entry.estimateProfile ? selectedEstimateOption(entry.estimateProfile, entry.estimateLevel ?? 'medium').rangesPer100g.energyKcal : null }
}

export function buildFoodChoices(personal: EstimatedFood[], aiCandidate?: FoodEntry, current?: { entry: FoodEntry; selectedId: string }): FoodChoice[] {
  const choices: FoodChoice[] = [...baseChoices, ...personal.filter(food => food.provider !== 'mock' && Object.values(food.nutrientsPer100g).some(value => value !== null)).map(food => ({
    id: `personal:${food.id}`, name: food.name, aliases: [], category: '我的食物', origin: 'personal' as const,
    description: '个人食物 · AI 估算', searchText: food.name,
    nutrientsPer100g: food.estimateProfile ? rangesToMidpoints(selectedEstimateOption(food.estimateProfile).rangesPer100g) : food.nutrientsPer100g,
    energyRange: food.estimateProfile ? selectedEstimateOption(food.estimateProfile).rangesPer100g.energyKcal : null,
  }))]
  if (aiCandidate) choices.unshift(snapshotChoice(aiCandidate, 'ai-current', 'ai'))
  if (current?.selectedId) {
    const index = choices.findIndex(choice => choice.id === current.selectedId)
    const snapshot = snapshotChoice(current.entry, current.selectedId, 'snapshot')
    // 已选条目展示当前档位，不把历史少油／多油误显示为普通档；再次选中不会重置。
    if (index >= 0) choices[index] = { ...choices[index]!, nutrientsPer100g: snapshot.nutrientsPer100g, energyRange: snapshot.energyRange }
    else choices.unshift(snapshot)
  }
  return choices
}

const searchIndices = new WeakMap<FoodChoice, string>()
// 只扩展检索同义词，不据此改变自动匹配或营养值，用户仍需核对具体做法。
const searchKey = (value: string) => normalizeFoodName(value).replace(/西红柿|蕃茄/g, '番茄').replace(/马铃薯/g, '土豆').replace(/朱古力/g, '巧克力').replace(/花椰菜/g, '花菜')
export function searchFoodChoices(choices: FoodChoice[], query: string, category = '全部'): FoodChoice[] {
  const tokens = query.toLowerCase().trim().split(/[\s,，、]+/).map(searchKey).filter(Boolean)
  return choices.filter(choice => {
    if (category !== '全部' && choice.category !== category) return false
    if (!tokens.length) return true
    let index = searchIndices.get(choice)
    if (index === undefined) { index = searchKey(choice.searchText); searchIndices.set(choice, index) }
    return tokens.every(token => index.includes(token))
  })
}

const ingredientGroups: Array<[string, RegExp]> = [
  ['番茄', /番茄|西红柿/], ['鸡蛋', /鸡蛋|炒蛋|全蛋|蛋清|蛋黄|蛋花/], ['西兰花', /西兰花|花椰菜/], ['土豆', /土豆|马铃薯/],
  ['鸡肉', /鸡肉|鸡胸|鸡腿|鸡翅/], ['牛肉', /牛肉|牛腩|牛排/], ['猪肉', /猪肉|肉丝|里脊|排骨|猪排/], ['鱼', /鱼|鲑|鳕|三文/], ['虾', /虾/],
  ['豆腐', /豆腐|豆干|豆皮/], ['红豆', /红豆|赤小豆/], ['燕麦', /燕麦/], ['玉米', /玉米/], ['南瓜', /南瓜/], ['蘑菇', /蘑菇|香菇|菌菇/],
  ['牛奶', /牛奶|乳饮|拿铁/], ['酸奶', /酸奶/], ['苹果', /苹果/], ['香蕉', /香蕉/], ['蓝莓', /蓝莓/],
]
const familyGroups: Array<[string, RegExp]> = [
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
    const names = [choice.name, ...choice.aliases].map(normalizeFoodName)
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
    if (choice.origin === 'recipe' && sharedIngredients.length >= 2) score += 10
    // 粥／熟饭不推荐干谷物，熟肉不推荐生肉。搜索仍可查看这些条目并明确核对口径。
    if (!exact && ((cooked && (choice.state === 'raw' || choice.state === 'dry')) || (dryOrRaw && choice.state === 'cooked'))) score -= 180
    const evidence = exact || contained || closeness >= .3 || sharedIngredients.length > 0 || sharedFamilies.length > 0
    const reason = exact ? choice.origin === 'personal' ? '个人库中有同名食物' : '名称相符' : sharedIngredients.length ? `配料接近：${sharedIngredients.slice(0, 2).join('、')}` : sharedFamilies.length ? `同类${sharedFamilies[0]}` : '名称接近'
    return { choice, reason, score, evidence, index }
  }).filter(item => item.evidence && item.score >= 30).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(({ choice, reason }) => ({ choice, reason }))
}
