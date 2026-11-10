import { describe, expect, it, vi } from 'vitest'
import { calculateNutrients, emptyNutrients, type LibraryFood } from '@shike/shared'
import { assistantEntry } from '../src/lib/meal-assistant'
import { assistantCandidates, resolveAssistantDraft } from '../src/lib/assistant-resolution'

const estimate = { basis: 'g', rangesPer100: { energyKcal: { min: 180, max: 260 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['合成测试：按面粉、鸡蛋和少量油的中等煎饼，未经称重'] }
const food = { name: '鸡蛋饼', amount: 1, unit: '个', portionEstimate: { amountPerUnit: 150, basis: 'g', source: 'ai', assumption: '合成测试单个约150g，非规格实测' }, nutritionEstimate: estimate }
const draft = { intent: 'update', date: '2026-11-10', mealType: 'breakfast', foods: [food], message: '待核对' }
const context = { personal: [], packages: [], library: [], provider: 'qwen', model: 'qwen3.7-flash' } as const
describe('对话自动解析重量与营养', () => {
  it('自然语言明确的一个优先于模型漏掉的数量，不改成空的一份', async () => {
    const result = await resolveAssistantDraft({ ...draft, foods: [{ ...food, amount: null, unit: '份' }] } as any, { ...context, text: '一个鸡蛋饼' } as any, vi.fn())
    expect(result.foods[0]).toMatchObject({ amount: 1, unit: '个' }); expect(result.entries[0]?.weightG).toBe(150)
  })
  it('鸡蛋饼无精确条目时采用有来源的AI营养范围，重量和每100g中值相乘', () => {
    const entry = assistantEntry(food as any, [], [], 'meal', { provider: 'qwen', model: 'qwen3.7-flash' })
    expect(entry.kind).toBe('ai'); expect(entry.weightG).toBe(150)
    expect(calculateNutrients(entry).energyKcal).toBe(330)
    expect(entry.aiEstimateSnapshot?.model).toBe('qwen3.7-flash')
    expect(entry.estimateProfile?.options.find(x => x.level === 'medium')?.rangesPer100g.energyKcal).toEqual({ min: 180, max: 260 })
  })
  it('已匹配基础库不被模型营养覆盖；mL估值不会套用到g', () => {
    const rice = assistantEntry({ ...food, name: '米饭', amount: 150, unit: 'g', portionEstimate: null } as any, [], [], 'meal', { provider: 'qwen', model: 'qwen3.7-flash' })
    expect(rice.kind).toBe('database'); expect(calculateNutrients(rice).energyKcal).toBe(195)
    const mismatch = assistantEntry({ ...food, nutritionEstimate: { ...estimate, basis: 'ml' } } as any, [], [], 'meal', { provider: 'qwen', model: 'qwen3.7-flash' })
    expect(calculateNutrients(mismatch).energyKcal).toBeNull()
  })
  it('个人常用食物快照参与匹配，既有份量优先于通用200g', async () => {
    const library = [{ id: 'saved1', choiceId: 'saved:saved1', origin: 'manual', favorite: true, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', entry: { id: 'entry1', name: '我的蛋饼', weightG: 120, nutrientsPer100g: { ...emptyNutrients(), energyKcal: 220 }, provenance: '用户手动填写', kind: 'manual', warnings: [] } }] as LibraryFood[]
    const candidates = assistantCandidates('一个我的蛋饼', [], [], library)
    expect(candidates.some(x => x.id === 'saved:saved1')).toBe(true)
    const result = await resolveAssistantDraft({ ...draft, foods: [{ name: '我的蛋饼', amount: null, unit: '份' }] } as any, { ...context, library }, vi.fn())
    expect(result.entries[0]?.weightG).toBe(120); expect(calculateNutrients(result.entries[0]!).energyKcal).toBe(264)
    const two = await resolveAssistantDraft({ ...draft, foods: [{ name: '我的蛋饼', amount: 2, unit: '份' }] } as any, { ...context, library }, vi.fn())
    expect(two.entries[0]?.weightG).toBe(240)
  })
  it('只接受本次提供的候选ID，已保存容量食品不被当成g', () => {
    const library = [{ id: 'drink', choiceId: 'saved:drink', origin: 'manual', favorite: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', entry: { id: 'drink1', name: '特制酸奶', weightG: null, nutrientsPer100g: emptyNutrients(), provenance: '核对过的每100mL标签', kind: 'manual', warnings: [], volumeSnapshot: { amountMl: 250, nutrientsPer100ml: { ...emptyNutrients(), energyKcal: 60 } } } }] as LibraryFood[]
    const selected = assistantEntry({ name: '我的酸奶饮品', amount: 2, unit: '杯', referenceId: 'saved:drink' } as any, [], [], 'meal', { library, offeredCandidates: [{ id: 'saved:drink' }] })
    expect(selected.weightG).toBeNull(); expect(selected.volumeSnapshot?.amountMl).toBe(500); expect(calculateNutrients(selected).energyKcal).toBe(300)
    const rejected = assistantEntry({ name: '不相关食物', amount: 100, unit: 'g', referenceId: 'saved:drink' } as any, [], [], 'meal', { library, offeredCandidates: [] })
    expect(rejected.kind).toBe('unknown'); expect(calculateNutrients(rejected).energyKcal).toBeNull()
  })
  it('容量按每100mL估计，清楚保留假设而不套质量库值', () => {
    const entry = assistantEntry({ name: '测试奶饮', amount: 250, unit: 'ml', nutritionEstimate: { ...estimate, basis: 'ml', rangesPer100: { ...estimate.rangesPer100, energyKcal: { min: 50, max: 70 } } } } as any, [], [], 'meal', { provider: 'qwen', model: 'qwen3.7-flash' })
    expect(entry.weightG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBe(150)
    expect(entry.provenance).toContain('每100mL'); expect(entry.warnings.join('')).toContain('参考范围')
  })
  it('模型漏掉营养时自动补问一次，补问不能改用户明确数量', async () => {
    const ask = vi.fn(async () => ({ mode: 'live', provider: 'qwen', model: 'qwen3.7-flash', draft: { ...draft, intent: 'estimate', foods: [{ ...food, amount: 9 }] } }))
    const result = await resolveAssistantDraft({ ...draft, foods: [{ ...food, nutritionEstimate: undefined, amount: 2 }] } as any, context as any, ask as any)
    expect(ask).toHaveBeenCalledTimes(1); expect(result.foods[0]?.amount).toBe(2)
    expect(calculateNutrients(result.entries[0]!).energyKcal).toBe(660)
  })
  it('补问失败保留草稿与缺失状态，本机和Mock不自动调用在线模型', async () => {
    const missing = { ...draft, foods: [{ name: '鸡蛋饼', amount: 1, unit: '个' }] }
    for (const provider of ['offline', 'mock']) {
      const ask = vi.fn(); const result = await resolveAssistantDraft(missing as any, { ...context, provider } as any, ask)
      expect(ask).not.toHaveBeenCalled(); expect(calculateNutrients(result.entries[0]!).energyKcal).toBeNull()
    }
    const ask = vi.fn().mockRejectedValue(new Error('估算暂不可用'))
    const result = await resolveAssistantDraft(missing as any, context as any, ask)
    expect(result.foods).toEqual(missing.foods); expect(result.notice).toContain('估算暂不可用')
  })
  it('补问把个换成份时拒绝单份估重，不能把两只一份重新贴成每个', async () => {
    const missing = { ...draft, foods: [{ name: '鸡蛋饼', amount: 2, unit: '个' }] }
    const ask = vi.fn().mockResolvedValue({ mode: 'live', provider: 'qwen', model: 'qwen3.7-flash', draft: { ...draft, intent: 'estimate', foods: [{ ...food, amount: 1, unit: '份', portionEstimate: { ...food.portionEstimate, amountPerUnit: 500 } }] } })
    const result = await resolveAssistantDraft(missing as any, context as any, ask)
    expect(result.entries[0]?.weightG).toBeNull(); expect(result.notice).toContain('单位')
  })
  it('AI补容量营养只填缺失字段，保留用户核对的蛋白质、来源和提醒', () => {
    const library = [{ id: 'p', choiceId: 'saved:p', origin: 'manual', favorite: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', entry: { id: 'p1', name: '核对过的饮品', weightG: null, nutrientsPer100g: emptyNutrients(), provenance: '用户核对原标签', kind: 'manual', warnings: ['保留原标签提醒'], volumeSnapshot: { amountMl: 100, nutrientsPer100ml: { ...emptyNutrients(), proteinG: 5 } } } }] as LibraryFood[]
    const entry = assistantEntry({ name: '核对过的饮品', amount: 200, unit: 'ml', nutritionEstimate: { ...estimate, basis: 'ml' } } as any, [], [], 'meal', { provider: 'qwen', model: 'qwen3.7-flash', library })
    expect(entry.volumeSnapshot?.nutrientsPer100ml.proteinG).toBe(5); expect(calculateNutrients(entry).energyKcal).toBe(440)
    expect(entry.provenance).toContain('用户核对原标签'); expect(entry.warnings).toContain('保留原标签提醒')
    expect(library[0]?.entry.volumeSnapshot?.nutrientsPer100ml.energyKcal).toBeNull()
  })
})
