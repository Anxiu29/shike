import { assistantDraftSchema, type AssistantRequest, type PortionSnapshot } from '@shike/shared'
import { describeMeal } from './api'
import { localDate, suggestedMealType } from './dates'

export async function estimatePortion(request: NonNullable<AssistantRequest['portionRequest']>): Promise<PortionSnapshot> {
  // 没有包装内件数时，外盒总重不能用于推测单枚大小；不把无关总重当模型的锚点。
  const portionRequest = request.label && ['个', '包', '袋'].includes(request.unit)
    ? { ...request, label: { ...request.label, netContent: null, servingSize: null } } : request
  const response = await describeMeal({ text: `只估计${request.name}每${request.unit}的可食重量或容量；小包与整盒必须区分，使用portionRequest，不记餐。`, date: localDate(), mealType: suggestedMealType(), portionRequest })
  if (response.mode === 'mock') throw new Error('AI估重需要配置真实AI模型；请填写单个大小或实际重量。')
  const draft = assistantDraftSchema.parse(response.draft), food = draft.foods[0]
  if (draft.intent !== 'estimate' || draft.foods.length !== 1 || food?.name !== request.name || food.unit !== request.unit || food.amount !== 1 || !food.portionEstimate) throw new Error('模型未能可靠估计单份大小，请补充规格或手动填写。')
  if (request.basis && food.portionEstimate.basis !== request.basis) throw new Error('估重单位不符，不能把mL当g；请重试或填写对应重量/容量。')
  return { unit: request.unit, quantity: 1, amountPerUnit: food.portionEstimate.amountPerUnit, basis: food.portionEstimate.basis,
    assumption: `AI估重（非实测）· ${response.provider}/${response.model}：${food.portionEstimate.assumption}`.slice(0, 500) }
}
