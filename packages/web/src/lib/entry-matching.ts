/**
 * 新记录的匹配入口，需要内置食品/配方；历史展示不应走此层重新查库。
 * 把这些函数独立出来，让首页的entryBasis/aggregateEnergyRanges只读保存快照。
 * 优先级保持：参考配方 → 基础库 → 个人粗估 → 本次模型候选 → 未知。
 */
import { createId, emptyNutrients, findFood, findRecipe, findEstimatedFood, normalizeFoodName, selectedEstimateOption, applyEstimateLevel, createEstimatedFoodEntry, createFoodEntry, createRecipeEntry, type FoodEntry, type EstimatedFood } from "@shike/shared";

export function manualEntry(name = '', weightG: number | null = null): FoodEntry {
  return { id: createId(), name, weightG, nutrientsPer100g: emptyNutrients(), provenance: '未匹配营养数据，请选择基础食物、参考配方或手动补充。', kind: 'unknown', warnings: [] }
}

export function matchedEntry(name: string, weightG: number | null, personalFoods: EstimatedFood[] = [], currentEstimate?: EstimatedFood): FoodEntry {
  // 可靠来源先匹配：已有数据库和参考配方不能被模型粗估静默替换。
  const recipe = findRecipe(name)
  if (recipe) {
    // 菜名确定但照片无法估重时也能匹配配方；整份营养仍待补重量，不套默认份量。
    const entry = createRecipeEntry(recipe, weightG !== null && weightG > 0 ? weightG : recipe.referenceWeightG)
    entry.weightG = weightG
    return entry
  }
  const food = findFood(name)
  if (food) return createFoodEntry(food, weightG)
  const personal = findEstimatedFood(name, personalFoods.filter(item => item.provider !== 'mock' && Object.values(item.nutrientsPer100g).some(value => value !== null)))
  const currentHasEnergyRange = currentEstimate?.estimateProfile
    ? selectedEstimateOption(currentEstimate.estimateProfile, 'medium').rangesPer100g.energyKcal !== null
    : false
  const personalHasEnergyRange = personal?.estimateProfile
    ? selectedEstimateOption(personal.estimateProfile, 'medium').rangesPer100g.energyKcal !== null
    : false
  // 旧个人单值不能挡住新模型提供的有效三档；只在确认保存后升级原有库条目。
  if (personal && currentEstimate && currentHasEnergyRange && !personalHasEnergyRange) return createEstimatedFoodEntry(currentEstimate, weightG)
  // 新的一餐总是从中档开始；上次少糖／少油不能自动套用到下一份。
  if (personal) {
    const entry = createEstimatedFoodEntry({ ...personal, provenance: `个人估算库 · ${personal.provenance}` }, weightG)
    return personal.estimateProfile ? applyEstimateLevel(entry, 'medium') : entry
  }
  return currentEstimate ? createEstimatedFoodEntry(currentEstimate, weightG) : manualEntry(name, weightG)
}

/** 名称纠正代表另一种食物时，旧模型的数值不能冒充新食物的估算。 */
export function rematchRenamedEntry(entry: FoodEntry, previousName: string, personalFoods: EstimatedFood[]): { entry: FoodEntry; changed: boolean } {
  if (normalizeFoodName(entry.name) === normalizeFoodName(previousName)) return { entry, changed: false }
  // 手动营养值由用户填写，允许用改名修正标签，不替用户改写这些数值。
  if (entry.kind === 'manual' || entry.kind === 'label' || entry.volumeSnapshot) return { entry, changed: true }
  const next = matchedEntry(entry.name, entry.weightG, personalFoods)
  next.id = entry.id
  return { entry: next, changed: true }
}

