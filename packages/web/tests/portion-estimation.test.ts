import { describe, expect, it, vi } from 'vitest'
import { estimatePortion } from '../src/lib/portion-estimation'
const { describeMeal } = vi.hoisted(() => ({ describeMeal: vi.fn() }))
vi.mock('../src/lib/api', () => ({ describeMeal }))
const draft = { intent: 'estimate', date: '2026-11-06', mealType: 'snack', message: '单独小包约34g，规格需核对。', foods: [{ name: '好丽友派', amount: 1, unit: '包', portionEstimate: { amountPerUnit: 34, basis: 'g', source: 'ai', assumption: '估计为单枚小包装，不是整盒' } }] }
describe('所选模型的单个/小包估重', () => {
  it('请求明确小包且保留原标签上下文，只采用当前模型返回的单份大小', async () => {
    describeMeal.mockResolvedValue({ mode: 'live', provider: 'qwen', model: 'test-model', draft })
    const result = await estimatePortion({ name: '好丽友派', unit: '包' })
    expect(result).toMatchObject({ unit: '包', quantity: 1, amountPerUnit: 34, basis: 'g' }); expect(result.assumption).toContain('AI估重'); expect(result.assumption).toContain('qwen');
    expect(describeMeal.mock.calls.at(-1)![0].portionRequest).toEqual({ name: '好丽友派', unit: '包' })
  })
  it('模拟模式、失败或型号返回其它商品/单位时不产生可用估重', async () => {
    describeMeal.mockResolvedValue({ mode: 'mock', draft }); await expect(estimatePortion({ name: '好丽友派', unit: '包' })).rejects.toThrow('真实AI模型')
    for (const changed of [{ ...draft, intent: 'question', foods: [] }, { ...draft, foods: [{ ...draft.foods[0], name: '别的食物' }] }, { ...draft, foods: [{ ...draft.foods[0], unit: '盒' }] }, { ...draft, foods: [{ ...draft.foods[0], portionEstimate: null }] }]) {
      describeMeal.mockResolvedValue({ mode: 'live', provider: 'qwen', model: 'test', draft: changed }); await expect(estimatePortion({ name: '好丽友派', unit: '包' })).rejects.toThrow('未能可靠估计')
    }
  })
  it('质量编辑不能偷偷采用模型的容量估计', async () => {
    describeMeal.mockResolvedValue({ mode: 'live', provider: 'qwen', model: 'test', draft: { ...draft, foods: [{ ...draft.foods[0], portionEstimate: { ...draft.foods[0]!.portionEstimate, basis: 'ml' } }] } })
    await expect(estimatePortion({ name: '好丽友派', unit: '包', basis: 'g' } as any)).rejects.toThrow('不能把')
  })
  it('估独立小包时不让外盒总重或不明每份大小诱导模型猜盒内枚数，原标签不变', async () => {
    describeMeal.mockResolvedValue({ mode: 'live', provider: 'qwen', model: 'test-model', draft });
    const label = { basis: '100g' as const, energy: { value: 1801, unit: 'kJ' as const }, proteinG: null, fatG: null, carbsG: null, netContent: { amount: 445, unit: 'g' as const }, servingSize: null };
    await estimatePortion({ name: '好丽友派', unit: '包', label });
    expect(describeMeal.mock.calls.at(-1)![0].portionRequest.label.netContent).toBeNull(); expect(label.netContent.amount).toBe(445);
  })
})
