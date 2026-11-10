import { createId, defaultPortion, typicalPortion, portionAmount, emptyNutrients, packagedEntry, packagedCatalogItems, normalizeFoodName, syncPackageEntry, foodEntrySchema, calculateNutrients, assistantNutritionSchema, type AssistantNutrition, type AssistantDraft, type FoodEntry, type EstimatedFood, type PackagedFood } from '@shike/shared'
import { matchedEntry, manualEntry, resizeEntry } from './entries'
import { applyTypicalPortion } from './typical-portions'
import { numberLabel, portionLabel } from './dates'
import type { PortionSnapshot } from '@shike/shared'
export type AssistantFood = AssistantDraft['foods'][number]
/** 逐项计算并复制展示依据，聊天快照不随草稿编辑或库更新改变。 */
export function assistantNutrition(entries: FoodEntry[], scope: AssistantNutrition['scope'], date: string, mealType: AssistantNutrition['mealType'], mode: AssistantNutrition['mode']): AssistantNutrition {
  const items = entries.map(entry => ({
    name: entry.name.slice(0, 100), portion: portionLabel(entry).slice(0, 100),
    energyKcal: calculateNutrients(entry).energyKcal, source: entry.provenance.slice(0, 300),
    assumptions: [...new Set([...(entry.portionSnapshot ? [entry.portionSnapshot.assumption] : []), ...(entry.packageSnapshot?.consumptionPortion ? [entry.packageSnapshot.consumptionPortion.assumption] : []), ...entry.warnings])].slice(0, 3).map(value => value.slice(0, 160)),
  }))
  return assistantNutritionSchema.parse({ scope, date, mealType, mode, items,
    knownEnergyKcal: items.reduce((sum, item) => sum + (item.energyKcal ?? 0), 0),
    missingEnergyItems: items.filter(item => item.energyKcal === null).length,
  })
}
export function assistantEnergyLabel(snapshot: AssistantNutrition): string {
  if (snapshot.missingEnergyItems === snapshot.items.length) return `热量待补充 · ${snapshot.missingEnergyItems} 项缺少资料`
  return snapshot.missingEnergyItems ? `已知部分约 ${numberLabel(snapshot.knownEnergyKcal)} kcal · ${snapshot.missingEnergyItems} 项待补充` : `合计约 ${numberLabel(snapshot.knownEnergyKcal)} kcal`
}
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
  const estimate = food.portionEstimate && food.unit !== 'g' && food.unit !== 'ml' ? {
    unit: food.unit, quantity: food.amount, amountPerUnit: food.portionEstimate.amountPerUnit, basis: food.portionEstimate.basis,
    assumption: `${food.portionEstimate.source === 'ai' ? 'AI估重（非实测）' : '用户说明的单份大小'}：${food.portionEstimate.assumption}`,
  } satisfies PortionSnapshot : undefined
  if (product) {
    const entry = packagedEntry(product), snapshot = entry.packageSnapshot!
    if (food.amount !== null && (food.unit === 'g' || food.unit === 'ml')) { snapshot.consumedAmount = food.amount; snapshot.consumedUnit = food.unit; syncPackageEntry(entry); return entry }
    if (estimate) { snapshot.consumptionPortion = estimate; snapshot.consumedAmount = portionAmount(estimate); snapshot.consumedUnit = estimate.basis }
    else if (food.amount === null) return applyTypicalPortion(entry)
    else if (food.unit === '份') { snapshot.consumedAmount = food.amount; snapshot.consumedUnit = 'serving' }
    else if (['盒', '瓶', '罐'].includes(food.unit) && snapshot.label.netContent) {
      const size = snapshot.label.netContent
      snapshot.consumptionPortion = { unit: food.unit as PortionSnapshot['unit'], quantity: food.amount, amountPerUnit: size.amount, basis: size.unit,
        assumption: `标签整包装规格：按每${food.unit}${size.amount}${size.unit}净含量换算；若指其中的小盒或单枚，请另填单个大小。` }
      snapshot.consumedAmount = portionAmount(snapshot.consumptionPortion); snapshot.consumedUnit = size.unit
    }
    else if (food.unit !== 'g' && food.unit !== 'ml') {
      const basis = snapshot.label.basis === '100ml' || snapshot.label.servingSize?.unit === 'ml' ? 'ml' : 'g'
      snapshot.consumptionPortion = { ...defaultPortion(food.name, food.unit, basis), quantity: food.amount }
      snapshot.consumedAmount = portionAmount(snapshot.consumptionPortion); snapshot.consumedUnit = basis
    }
    syncPackageEntry(entry)
    return entry
  }
  if (estimate) {
    if (estimate.basis === 'ml') {
      const entry = manualEntry(food.name)
      entry.volumeSnapshot = { amountMl: portionAmount(estimate), nutrientsPer100ml: emptyNutrients() }; entry.portionSnapshot = estimate
      entry.warnings = ['容量为估算；缺少每100mL营养时热量保持未知，不把mL当g。']; return entry
    }
    const entry = matchedEntry(food.name, null, personal); resizeEntry(entry, portionAmount(estimate)); entry.portionSnapshot = estimate; return entry
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
  if (amount === null && portion.amountPerUnit !== null) throw new Error('份量换算超出20000g，请拆分记录或修改数量。')
  resizeEntry(entry, amount); entry.portionSnapshot = portion
  return entry
}
export function assistantMeal(draft: AssistantDraft, entries: FoodEntry[], mode: 'live' | 'mock') {
  const now = new Date().toISOString()
  // Vue的响应式Proxy不能直接structuredClone；领域数据仅含JSON值。
  return { id: createId(), date: draft.date, mealType: draft.mealType, items: JSON.parse(JSON.stringify(entries)) as FoodEntry[], mode, createdAt: now, updatedAt: now }
}
