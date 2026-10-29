import { createId, defaultPortion, typicalPortion, portionAmount, emptyNutrients, packagedEntry, packagedCatalogItems, normalizeFoodName, syncPackageEntry, foodEntrySchema, type AssistantDraft, type FoodEntry, type EstimatedFood, type PackagedFood } from '@shike/shared'
import { matchedEntry, manualEntry, resizeEntry } from './entries'
import { applyTypicalPortion } from './typical-portions'
export type AssistantFood = AssistantDraft['foods'][number]
/** 模型只解析语言；营养仍查本地库。未知值不填0，不假定mL与g密度相同。 */
export function assistantEntry(food: AssistantFood, personal: EstimatedFood[], packages: PackagedFood[], inputKind: 'meal' | 'order' = 'meal'): FoodEntry {
  const entry = buildAssistantEntry(food, personal, packages)
  if (inputKind === 'order') {
    // 保留原食品库来源和份量假设；转详细编辑、保存后仍能看见订单来源的限制。
    entry.provenance += ' · 来源：外卖订单草稿'
    entry.warnings = [...new Set([...entry.warnings, '订单下单数量不等于实际摄入；份量与食品库匹配需按实际食用情况核对。'])]
  }
  const parsed = foodEntrySchema.safeParse(entry)
  if (!parsed.success) throw new Error('份量换算超出范围或资料不完整，请修改数量；总量不能超过20000g或mL。')
  return parsed.data
}
function buildAssistantEntry(food: AssistantFood, personal: EstimatedFood[], packages: PackagedFood[]): FoodEntry {
  const product = packagedCatalogItems(packages).find(({ food: item }) => normalizeFoodName(item.name) === normalizeFoodName(food.name) || normalizeFoodName(`${item.brand}${item.name}`) === normalizeFoodName(food.name))?.food
  if (product) {
    const entry = packagedEntry(product), snapshot = entry.packageSnapshot!
    if (food.amount !== null && (food.unit === 'g' || food.unit === 'ml')) { snapshot.consumedAmount = food.amount; snapshot.consumedUnit = food.unit; syncPackageEntry(entry); return entry }
    applyTypicalPortion(entry)
    if (food.amount !== null && snapshot.consumedAmount !== null) { snapshot.consumedAmount *= food.amount; syncPackageEntry(entry) }
    return entry
  }
  if (food.unit === 'ml') {
    const entry = manualEntry(food.name)
    entry.volumeSnapshot = { amountMl: food.amount, nutrientsPer100ml: emptyNutrients() }
    entry.provenance = '文字饮食记录 · 容量按描述记录；缺少对应每100mL营养，需在详细编辑中选择包装食品或补充。'
    entry.warnings = ['未将mL当成g，也未编造饮品营养。可选择对应包装食品补充。']
    return applyTypicalPortion(entry)
  }
  const entry = matchedEntry(food.name, food.unit === 'g' ? food.amount : null, personal)
  if (food.amount === null) return applyTypicalPortion(entry)
  if (food.unit === 'g') return entry
  const common = typicalPortion(food.name), portion = common.unit === food.unit ? common : defaultPortion(food.name, food.unit, 'g')
  portion.quantity = food.amount
  const amount = portionAmount(portion)
  if (amount === null) throw new Error('份量换算超出20000g，请拆分记录或修改数量。')
  resizeEntry(entry, amount); entry.portionSnapshot = portion
  return entry
}
export function assistantMeal(draft: AssistantDraft, entries: FoodEntry[], mode: 'live' | 'mock') {
  const now = new Date().toISOString()
  // Vue的响应式Proxy不能直接structuredClone；领域数据仅含JSON值。
  return { id: createId(), date: draft.date, mealType: draft.mealType, items: JSON.parse(JSON.stringify(entries)) as FoodEntry[], mode, createdAt: now, updatedAt: now }
}
