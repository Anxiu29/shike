import { createId, normalizeFoodName, type FoodEntry, type MealRecord } from '@shike/shared'
import { localDate, shiftDate } from './dates'

export interface HistoryFood {
  id: string
  entry: FoodEntry
  date: string
  uses: number
}

/** 只索引已保存、非模拟的历史。相同营养快照忽略本次份量，保留最近一次完整记录。 */
function historyKey(entry: FoodEntry): string {
  const { consumedAmount: _amount, consumedUnit: _unit, ...label } = entry.packageSnapshot ?? {}
  return JSON.stringify({
    name: normalizeFoodName(entry.name), kind: entry.kind, referenceId: entry.referenceId,
    nutrients: entry.nutrientsPer100g, volume: entry.volumeSnapshot?.nutrientsPer100ml,
    package: entry.packageSnapshot ? label : undefined,
    recipe: entry.recipeSnapshot, ai: entry.aiEstimateSnapshot,
    profile: entry.estimateProfile, level: entry.estimateLevel,
  })
}

export function historyFoodShortcuts(meals: MealRecord[], throughDate: string) {
  const ordered = meals.filter(meal => meal.mode !== 'mock' && meal.date <= throughDate)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const foods = new Map<string, HistoryFood>()
  for (const meal of ordered) {
    const usedInMeal = new Set<string>()
    for (const entry of meal.items) {
      if (entry.aiEstimateSnapshot?.provider === 'mock' || entry.packageSnapshot?.provider === 'mock') continue
      const key = historyKey(entry)
      if (usedInMeal.has(key)) continue
      usedInMeal.add(key)
      const previous = foods.get(key)
      if (previous) previous.uses++
      else foods.set(key, { id: entry.id, entry, date: meal.date, uses: 1 })
    }
  }
  const recent = [...foods.values()]
  // 单次记录仍在“最近”里，不将它描述成经常吃的食物。
  const frequent = recent.filter(food => food.uses >= 2).sort((a, b) => b.uses - a.uses || b.date.localeCompare(a.date))
  return { recent, frequent }
}

export function copyHistoryFood(food: HistoryFood): FoodEntry {
  const entry = JSON.parse(JSON.stringify(food.entry)) as FoodEntry
  entry.id = createId()
  return entry
}

/** 复用只创建草稿；完整保留来源与模拟标记，保存后才产生新的餐食记录。 */
export function duplicateMealDraft(record: MealRecord, date: string): MealRecord {
  const copy = JSON.parse(JSON.stringify(record)) as MealRecord
  const now = new Date().toISOString()
  return { ...copy, id: createId(), date, items: copy.items.map(entry => ({ ...entry, id: createId() })), createdAt: now, updatedAt: now }
}

export function diaryWeek(date: string, today = localDate()) {
  const weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  const start = shiftDate(date, -weekday)
  return Array.from({ length: 7 }, (_, index) => {
    const value = shiftDate(start, index)
    return { date: value, day: Number(value.slice(8)), label: ['一', '二', '三', '四', '五', '六', '日'][index]!, today: value === today }
  })
}

/** 月视图只生成本月实际日期；第一天的列由当地星期决定，避免月初错位。 */
export function diaryMonth(date: string, today = localDate()) {
  const first = `${date.slice(0, 7)}-01`
  const last = new Date(`${first}T12:00:00`)
  last.setMonth(last.getMonth() + 1, 0)
  const offset = (new Date(`${first}T12:00:00`).getDay() + 6) % 7
  return Array.from({ length: last.getDate() }, (_, index) => {
    const value = `${date.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`
    const weekday = (offset + index) % 7
    return { date: value, day: index + 1, label: ['一', '二', '三', '四', '五', '六', '日'][weekday]!, today: value === today, column: weekday + 1 }
  })
}
