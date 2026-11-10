import { assistantDraftSchema, calculateNutrients, statedFoodQuantity, type AssistantDraft, type AssistantRequest, type AssistantResponse, type EstimatedFood, type LibraryFood, type PackagedFood } from '@shike/shared'
import { buildFoodChoices, recommendFoodChoices, type FoodChoice } from './food-picker'
import { assistantEntry, type AssistantEntryContext, type AssistantFood } from './meal-assistant'

/** 只向模型提供本轮描述相关的少量候选，不发送完整个人食品库或饮食历史。 */
export function assistantCandidates(text: string, personal: readonly EstimatedFood[], packages: readonly PackagedFood[], library: readonly LibraryFood[], names: string[] = []): NonNullable<AssistantRequest['catalogCandidates']> {
  const choices = buildFoodChoices([...personal], undefined, undefined, [...packages], [...library])
  const selected = new Map<string, FoodChoice>()
  for (const name of [...names, ...text.split(/[，,、；;\n]/)].slice(0, 12)) {
    if (!name.trim()) continue
    for (const { choice } of recommendFoodChoices(choices, { name, visibleIngredients: [] }, names.includes(name) ? 4 : 12)) selected.set(choice.id, choice)
  }
  return [...selected.values()].slice(0, 24).map(choice => ({ id: choice.id, name: choice.name, description: choice.description.slice(0, 300),
    basis: choice.nutritionPerUnit ? choice.nutritionPerUnit.unitLabel.includes('100 mL') ? 'ml' : choice.nutritionPerUnit.unitLabel.includes('100 g') ? 'g' : 'unknown' : 'g' }))
}

export interface AssistantResolutionContext {
  personal: readonly EstimatedFood[]; packages: readonly PackagedFood[]; library: readonly LibraryFood[]
  provider: AssistantResponse['provider']; model: string; mode?: 'live' | 'mock'; inputKind?: 'meal' | 'order'
  candidates?: NonNullable<AssistantRequest['catalogCandidates']>
  text?: string
  // 防止补问前用户退出/切换模型后悄悄走另一条路由。
  canEnrich?: () => boolean
}
export async function resolveAssistantDraft(draft: AssistantDraft, context: AssistantResolutionContext, ask: (input: AssistantRequest) => Promise<AssistantResponse>) {
  draft = { ...draft, foods: draft.foods.map(food => {
    const stated = context.text ? statedFoodQuantity(context.text, food.name) : undefined
    return stated ? { ...food, ...stated, ...(['g', 'ml'].includes(stated.unit) ? { portionEstimate: null } : {}) } : food
  }) }
  const personal = [...context.personal], packages = [...context.packages], library = [...context.library]
  const choices = buildFoodChoices(personal, undefined, undefined, packages, library)
  const entryContext: AssistantEntryContext = { provider: context.provider, model: context.model, library, choices, offeredCandidates: context.candidates }
  const build = (foods: AssistantFood[], ctx = entryContext) => foods.map(food => assistantEntry(food, personal, packages, context.inputKind, ctx))
  const original = build(draft.foods), missing = original.flatMap((entry, index) => calculateNutrients(entry).energyKcal === null ? [index] : [])
  if (!missing.length || context.mode === 'mock' || ['offline', 'mock'].includes(context.provider) || context.canEnrich?.() === false) return { foods: draft.foods, entries: original, notice: '', entryContext }
  const candidates = assistantCandidates('', personal, packages, library, missing.map(index => draft.foods[index]!.name))
  try {
    const response = await ask({ text: '请补齐以下食品的重量与营养参考范围。优先采用相符候选；无法精确查库的普通食品给有假设的AI粗估。只补估算，不创建或保存记录。', date: draft.date, mealType: draft.mealType,
      enrichment: missing.map(index => draft.foods[index]!), ...(context.inputKind === 'order' ? { inputKind: 'order' as const } : {}), ...(candidates.length ? { catalogCandidates: candidates } : {}) })
    if (response.mode !== 'live' || response.provider !== context.provider || response.model !== context.model) throw new Error('补估算的模型已改变，未采用结果，请重新发送。')
    const next = assistantDraftSchema.parse(response.draft)
    if (next.intent !== 'estimate' || next.foods.length !== missing.length || next.foods.some((food, i) => food.name !== draft.foods[missing[i]!]!.name)) throw new Error('模型未按原食品补齐估算，已保留原草稿。')
    const foods = draft.foods.map(food => ({ ...food }))
    for (let i = 0; i < missing.length; i++) {
      const index = missing[i]!, before = foods[index]!, after = next.foods[i]!
      const hasAmount = before.amount !== null
      if (hasAmount && before.unit !== after.unit) throw new Error('补估算改变了原单位，不能把每份大小套成每个大小；已保留原草稿。')
      foods[index] = { ...after, name: before.name, amount: hasAmount ? before.amount : after.amount, unit: hasAmount ? before.unit : after.unit,
        portionEstimate: (hasAmount ? before.unit : after.unit) === 'g' || (hasAmount ? before.unit : after.unit) === 'ml' ? null : before.portionEstimate ?? after.portionEstimate }
    }
    const resolvedContext = { ...entryContext, provider: response.provider, model: response.model, offeredCandidates: [...(context.candidates ?? []), ...candidates] }
    const entries = build(foods, resolvedContext)
    const stillMissing = entries.filter(entry => calculateNutrients(entry).energyKcal === null).length
    return { foods, entries, notice: stillMissing ? `${stillMissing}项暂无可靠估值，已保留为待补充；${next.message}` : '', entryContext: resolvedContext }
  } catch (cause) {
    return { foods: draft.foods, entries: original, notice: `自动补估未完成：${cause instanceof Error ? cause.message : '服务暂不可用'} 现有草稿已保留，未知热量没有当作0。`, entryContext }
  }
}
