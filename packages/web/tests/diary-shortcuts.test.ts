import { describe, expect, it } from 'vitest'
import { applyEstimateLevel, calculateNutrients, createEstimatedFoodEntry, createFoodEntry, findFood, type FoodEntry, type MealRecord } from '@shike/shared'
import { copyHistoryFood, diaryMonth, diaryWeek, duplicateMealDraft, historyFoodShortcuts } from '../src/lib/diary-shortcuts'
import { recognitionEstimate } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'

function meal(id: string, date: string, items: FoodEntry[], mode: MealRecord['mode'] = 'manual'): MealRecord {
  return { id, date, mealType: 'lunch', items, mode, createdAt: date + 'T04:00:00.000Z', updatedAt: date + 'T04:00:00.000Z' }
}
const rice = (weight = 150) => createFoodEntry(findFood('米饭')!, weight)

describe('日记快捷记录', () => {
  it('最近食物按用餐日期排序，合并相同营养的不同份量，保留最近份量', () => {
    const a = meal('older', '2026-10-20', [rice(100)]), b = meal('newer', '2026-10-22', [rice(220)])
    const { recent, frequent } = historyFoodShortcuts([a, b], '2026-10-23')
    expect(recent).toHaveLength(1); expect(recent[0]!.entry.weightG).toBe(220)
    expect(frequent[0]!.uses).toBe(2)
    const entry = copyHistoryFood(recent[0]!)
    expect(entry.id).not.toBe(b.items[0]!.id)
    entry.nutrientsPer100g.energyKcal = 1
    expect(b.items[0]!.nutrientsPer100g.energyKcal).not.toBe(1)
  })
  it('一次餐食中的重复条目只计算一次，不将只吃过一次的食物称作常吃', () => {
    const result = historyFoodShortcuts([meal('one', '2026-10-22', [rice(), rice(250)])], '2026-10-23')
    expect(result.recent).toHaveLength(1); expect(result.recent[0]!.uses).toBe(1); expect(result.frequent).toEqual([])
  })
  it('不索引未来日期或模拟餐食，也拒绝混入错误标记下的模拟快照', () => {
    const mock = rice(); mock.aiEstimateSnapshot = { nutrientsPer100g: mock.nutrientsPer100g, provider: 'mock', model: 'test', assumptions: ['模拟'] }
    const rows = [meal('future', '2026-10-24', [rice()]), meal('mock', '2026-10-21', [rice()], 'mock'), meal('mislabelled', '2026-10-22', [mock])]
    expect(historyFoodShortcuts(rows, '2026-10-23').recent).toEqual([])
  })
  it('同名但营养值、来源种类或估算档位不同的食物不会合并', () => {
    const estimate = recognitionEstimate('杂粮粥', null, ['测试'], 'qwen', 'test', porridgeProfile)!
    const high = applyEstimateLevel(createEstimatedFoodEntry(estimate, 200), 'high')
    const low = applyEstimateLevel(createEstimatedFoodEntry(estimate, 200), 'low')
    const changed = rice(); changed.nutrientsPer100g.energyKcal = 80
    const result = historyFoodShortcuts([meal('one', '2026-10-22', [rice(), changed, high, low])], '2026-10-23')
    expect(result.recent).toHaveLength(4)
  })
  it('体积与未知份量沿用历史值，不补成100g，也不会丢掉每100mL基准', () => {
    const drink: FoodEntry = { id: 'drink', name: '自制豆乳', kind: 'manual', weightG: null, nutrientsPer100g: { energyKcal: null, proteinG: null, fatG: null, carbsG: null }, warnings: [], provenance: '用户填写', volumeSnapshot: { amountMl: 250, nutrientsPer100ml: { energyKcal: 60, proteinG: null, fatG: null, carbsG: null } } }
    const unknown = { ...rice(), weightG: null }
    const recent = historyFoodShortcuts([meal('one', '2026-10-22', [drink, unknown])], '2026-10-23').recent
    const copied = copyHistoryFood(recent[0]!)
    expect(copied.weightG).toBeNull(); expect(copied.volumeSnapshot?.amountMl).toBe(250)
    expect(calculateNutrients(copied).energyKcal).toBe(150)
    expect(copyHistoryFood(recent[1]!).weightG).toBeNull()
  })
  it('复制整餐创建独立ID并保留模拟标记、时间、份量与来源，原历史不变', () => {
    const source = meal('source', '2026-10-20', [rice(), createFoodEntry(findFood('鸡蛋')!, 50)], 'mock')
    const copy = duplicateMealDraft(source, '2026-10-23')
    expect(copy.id).not.toBe(source.id); expect(copy.items[0]!.id).not.toBe(source.items[0]!.id)
    expect(copy.items).toHaveLength(2); expect(copy.items[1]!.id).not.toBe(source.items[1]!.id)
    expect(copy.date).toBe('2026-10-23'); expect(copy.mode).toBe('mock'); expect(copy.mealType).toBe('lunch')
    copy.items[0]!.weightG = 300
    expect(source.items[0]!.weightG).toBe(150); expect(source.date).toBe('2026-10-20')
  })
  it('周条跨年、闰日按本地日历生成，今天标记只出现在对应日期', () => {
    expect(diaryWeek('2026-01-01', '2026-01-01').map(day => day.date)).toEqual(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])
    expect(diaryWeek('2024-02-29', '2024-02-29').filter(day => day.today).map(day => day.date)).toEqual(['2024-02-29'])
    expect(diaryWeek('2024-02-29').at(-1)!.date).toBe('2024-03-03')
  })
  it('月历覆盖本月每一天并正确对齐星期，区分闰年与平年', () => {
    const october = diaryMonth('2026-10-23', '2026-10-23')
    expect(october).toHaveLength(31); expect(october[0]).toMatchObject({ date: '2026-10-01', column: 4, label: '四' })
    expect(october.at(-1)!.date).toBe('2026-10-31')
    expect(october.filter(day => day.today).map(day => day.day)).toEqual([23])
    expect(diaryMonth('2024-02-29')).toHaveLength(29)
    expect(diaryMonth('2025-02-28')).toHaveLength(28)
    expect(diaryMonth('2026-12-31').at(-1)!.date).toBe('2026-12-31')
    expect(diaryMonth('0001-01-01')[0]!.date).toBe('0001-01-01')
  })
})
