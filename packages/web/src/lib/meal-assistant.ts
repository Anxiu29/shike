import { createId, defaultPortion, typicalPortion, portionAmount, emptyNutrients, packagedEntry, packagedCatalogItems, normalizeFoodName, syncPackageEntry, foodEntrySchema, calculateNutrients, assistantNutritionSchema, type AssistantNutrition, type AssistantDraft, type FoodEntry, type EstimatedFood, type PackagedFood } from '@shike/shared'
import { matchedEntry, manualEntry, resizeEntry, recognitionEstimate } from './entries'
import { buildFoodChoices, entryForFoodChoice, type FoodChoice } from './food-picker'
import { calculateEnergyRange, rangesToMidpoints, type AssistantResponse, type LibraryFood, type NutritionEstimateProfile } from '@shike/shared'
import { applyTypicalPortion } from './typical-portions'
import { numberLabel, portionLabel } from './dates'
import type { PortionSnapshot } from '@shike/shared'
export type AssistantFood = AssistantDraft['foods'][number]
export interface AssistantEntryContext {
  provider?: AssistantResponse['provider']; model?: string; library?: readonly LibraryFood[]
  choices?: FoodChoice[]; offeredCandidates?: readonly { id: string }[]
}
/** 逐项计算并复制展示依据，聊天快照不随草稿编辑或库更新改变。 */
export function assistantNutrition(entries: FoodEntry[], scope: AssistantNutrition['scope'], date: string, mealType: AssistantNutrition['mealType'], mode: AssistantNutrition['mode']): AssistantNutrition {
  const items = entries.map(entry => ({
    name: entry.name.slice(0, 100), portion: portionLabel(entry).slice(0, 100),
    energyKcal: calculateNutrients(entry).energyKcal, source: entry.provenance.slice(0, 300),
    ...(calculateEnergyRange(entry) ? { energyRange: calculateEnergyRange(entry)! } : {}),
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
export function assistantEntry(food: AssistantFood, personal: EstimatedFood[], packages: PackagedFood[], inputKind: 'meal' | 'order' = 'meal', context: AssistantEntryContext = {}): FoodEntry {
  const entry = buildAssistantEntry(food, personal, packages, context)
  if (inputKind === 'order') {
    // 保留原食品库来源和份量假设；转详细编辑、保存后仍能看见订单来源的限制。
    entry.provenance += ' · 来源：外卖订单草稿'
    entry.warnings = [...new Set([...entry.warnings, '订单下单数量不等于实际摄入；份量与食品库匹配需按实际食用情况核对。'])]
  }
  const parsed = foodEntrySchema.safeParse(entry)
  if (!parsed.success) throw new Error('份量换算超出范围或资料不完整，请修改数量；总量不能超过20000g或mL。')
  return parsed.data
}
function buildAssistantEntry(food: AssistantFood, personal: EstimatedFood[], packages: PackagedFood[], context: AssistantEntryContext): FoodEntry {
  const library = [...(context.library ?? [])]
  const choices = context.choices ?? ((food.referenceId || library.length) ? buildFoodChoices(personal, undefined, undefined, packages, library) : [])
  const requested = food.referenceId && context.offeredCandidates?.some(item => item.id === food.referenceId) ? choices.find(item => item.id === food.referenceId) : undefined
  const exactSaved = library.find(item => normalizeFoodName(item.entry.name) === normalizeFoodName(food.name))
  const selected = requested ? entryForFoodChoice(requested.id, null, personal, packages, library) : exactSaved ? entryForFoodChoice(exactSaved.choiceId, null, personal, packages, library) : null
  if (selected) {
    const name = selected.name
    selected.name = food.name
    selected.provenance += ` · 对话采用食品库：${name}`
    selected.warnings = [...new Set([...selected.warnings, `采用「${name}」作为参考，请核对做法和规格。`])]
  }
  const savedPortion = selected?.portionSnapshot ? { ...selected.portionSnapshot } : undefined
  const savedAmount = selected?.volumeSnapshot ? selected.volumeSnapshot.amountMl : selected?.weightG
  const product = packagedCatalogItems(packages).find(({ food: item }) => normalizeFoodName(item.name) === normalizeFoodName(food.name) || normalizeFoodName(`${item.brand}${item.name}`) === normalizeFoodName(food.name))?.food
  const estimate = food.portionEstimate && food.unit !== 'g' && food.unit !== 'ml' ? {
    unit: food.unit, quantity: food.amount ?? 1, amountPerUnit: food.portionEstimate.amountPerUnit, basis: food.portionEstimate.basis,
    assumption: `${food.portionEstimate.source === 'ai' ? 'AI估重（非实测）' : '用户说明的单份大小'}：${food.portionEstimate.assumption}`,
  } satisfies PortionSnapshot : undefined
  if (selected?.packageSnapshot || product) {
    const entry = selected?.packageSnapshot ? selected : packagedEntry(product!), snapshot = entry.packageSnapshot!
    if (selected && food.amount === null && !estimate) return entry
    delete snapshot.consumptionPortion
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
  const online = context.provider && !['offline', 'mock'].includes(context.provider)
  const nutrition = online ? food.nutritionEstimate : null
  const ai = nutrition?.basis === 'g' ? recognitionEstimate(food.name, null, nutrition.assumptions, context.provider as EstimatedFood['provider'], context.model ?? '未标注模型', estimateProfile(nutrition)) : undefined
  const massEntry = (amount: number | null) => {
    if (selected && !selected.volumeSnapshot) { resizeEntry(selected, amount); return selected }
    return matchedEntry(food.name, amount, personal, ai)
  }
  const volumeEntry = (amount: number | null, portion?: PortionSnapshot) => {
    const entry = selected?.volumeSnapshot ? selected : manualEntry(food.name)
    if (!entry.volumeSnapshot) entry.volumeSnapshot = { amountMl: amount, nutrientsPer100ml: emptyNutrients() }
    entry.volumeSnapshot.amountMl = amount
    if (nutrition?.basis === 'ml' && entry.volumeSnapshot.nutrientsPer100ml.energyKcal === null) {
      const estimateValues = rangesToMidpoints(nutrition.rangesPer100)
      for (const key of Object.keys(estimateValues) as Array<keyof typeof estimateValues>) if (entry.volumeSnapshot.nutrientsPer100ml[key] === null) entry.volumeSnapshot.nutrientsPer100ml[key] = estimateValues[key]
      entry.provenance = `${selected?.volumeSnapshot ? `${entry.provenance} · 缺失项补充：` : ''}AI容量营养粗估 · ${context.provider}/${context.model} · 每100mL，非实测`
      const range = nutrition.rangesPer100.energyKcal
      entry.warnings = [...entry.warnings, 'AI仅补充缺失营养，未把mL当g；已有值保留原来源。', ...(range ? [`每100mL热量参考范围${range.min}–${range.max}kcal；按中值记账。`] : []), ...nutrition.assumptions].slice(0, 30)
    } else if (!selected?.volumeSnapshot) entry.warnings = ['容量按描述记录；缺少每100mL营养时保留未知，不把mL当g。']
    if (portion) entry.portionSnapshot = portion
    else delete entry.portionSnapshot
    return entry
  }
  if (selected?.volumeSnapshot && food.unit !== 'g') {
    if (food.unit === 'ml') return volumeEntry(food.amount)
    if (estimate?.basis === 'ml') return volumeEntry(portionAmount(estimate), estimate)
    if (food.amount === null) return selected
    const portion = savedPortion?.unit === food.unit && savedPortion.basis === 'ml' ? savedPortion
      : food.unit === '份' && savedAmount != null ? { unit: food.unit, quantity: 1, amountPerUnit: savedAmount, basis: 'ml' as const, assumption: '按已保存食品的容量作为1份参考，可修改。' }
      : defaultPortion(food.name, food.unit, 'ml')
    portion.quantity = food.amount
    return volumeEntry(portionAmount(portion), portion)
  }
  if (estimate) {
    if (estimate.basis === 'ml') return volumeEntry(portionAmount(estimate), estimate)
    const entry = massEntry(portionAmount(estimate)); entry.portionSnapshot = estimate; return entry
  }
  if (food.unit === 'ml') {
    return applyTypicalPortion(volumeEntry(food.amount))
  }
  if (selected && food.amount === null) return applyTypicalPortion(selected)
  const entry = massEntry(food.unit === 'g' ? food.amount : null)
  if (food.amount === null) return applyTypicalPortion(entry)
  if (food.unit === 'g') return entry
  const common = savedPortion?.unit === food.unit ? savedPortion
    : food.unit === '份' && savedAmount != null ? { unit: food.unit, quantity: 1, amountPerUnit: savedAmount, basis: 'g' as const, assumption: '按已保存食品的重量作为1份参考，可修改。' }
    : typicalPortion(food.name)
  const portion = common.unit === food.unit ? common : defaultPortion(food.name, food.unit, 'g')
  portion.quantity = food.amount
  const amount = portionAmount(portion)
  if (amount === null && portion.amountPerUnit !== null) throw new Error('份量换算超出20000g，请拆分记录或修改数量。')
  resizeEntry(entry, amount); entry.portionSnapshot = portion
  return entry
}
function estimateProfile(nutrition: NonNullable<AssistantFood['nutritionEstimate']>): NutritionEstimateProfile {
  // 用同一估计区间的下界/中值/上界复用既有情景快照，未假装三种配方是实测。
  return { factor: 'general', options: (['low', 'medium', 'high'] as const).map(level => ({
    level, label: level === 'low' ? '估计下界' : level === 'high' ? '估计上界' : '参考范围中值',
    rangesPer100g: Object.fromEntries(Object.entries(nutrition.rangesPer100).map(([key, range]) => [key, !range ? null : level === 'medium' ? { ...range } : { min: level === 'low' ? range.min : range.max, max: level === 'low' ? range.min : range.max }])) as typeof nutrition.rangesPer100,
    assumptions: [...nutrition.assumptions, 'AI营养范围非实测；默认按区间中值记账，下界与上界仅表示该区间端点。'],
  })) }
}
export function assistantMeal(draft: AssistantDraft, entries: FoodEntry[], mode: 'live' | 'mock') {
  const now = new Date().toISOString()
  // Vue的响应式Proxy不能直接structuredClone；领域数据仅含JSON值。
  return { id: createId(), date: draft.date, mealType: draft.mealType, items: JSON.parse(JSON.stringify(entries)) as FoodEntry[], mode, createdAt: now, updatedAt: now }
}
