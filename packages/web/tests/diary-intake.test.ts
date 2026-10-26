import { describe, expect, it } from 'vitest'
import { createExercise, defaultDailyGoals, makeDailyPlan, type MealRecord, type Settings } from '@shike/shared'
import { diaryIntake, type DiaryIntakeData } from '../src/lib/diary-intake'

const date = '2026-10-23'
const settings: Settings = { targetWeightKg: null, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 2000 } }
function meal(kcal: number | null, onDate = date): MealRecord {
  return { id: `meal-${onDate}`, date: onDate, mealType: 'lunch', mode: 'manual', createdAt: `${onDate}T04:00:00Z`, updatedAt: `${onDate}T04:00:00Z`,
    items: [{ id: `food-${onDate}`, name: '测试食物', kind: 'manual', weightG: 250, nutrientsPer100g: { energyKcal: kcal === null ? null : kcal / 2.5, proteinG: null, fatG: null, carbsG: null }, warnings: [], provenance: '测试' }] }
}
function data(kcal: number | null): DiaryIntakeData { return { meals: [meal(kcal)], settings, weights: [], exercises: [], dailyPlans: [] } }

describe('日期摄入进度', () => {
  it('按各日完整摄入与预算计算，100%仍为预算内，超出后保留实际比例但填色封顶', () => {
    expect(diaryIntake(date, data(500))).toMatchObject({ percent: 25, fill: 25, label: '25%', state: 'within' })
    expect(diaryIntake(date, data(2000))).toMatchObject({ percent: 100, fill: 100, label: '100%', state: 'within' })
    expect(diaryIntake(date, data(2500))).toMatchObject({ percent: 125, fill: 100, label: '125%', state: 'over' })
  })
  it('合计同日多餐与mL条目，不混入其它日期', () => {
    const input = data(500), drink = meal(null)
    drink.items[0]!.weightG = null
    drink.items[0]!.volumeSnapshot = { amountMl: 250, nutrientsPer100ml: { energyKcal: 100, proteinG: null, fatG: null, carbsG: null } }
    input.meals.push(drink, meal(2000, '2026-10-22'))
    expect(diaryIntake(date, input)).toMatchObject({ consumedKcal: 750, percent: 37.5, state: 'within' })
  })
  it('使用历史预算快照，不将当前目标套到所有日期', () => {
    const input = data(1000)
    input.dailyPlans = [makeDailyPlan(date, { ...settings, dailyGoals: { ...settings.dailyGoals!, manualCaloriesKcal: 2500 } }, [])]
    expect(diaryIntake(date, input)).toMatchObject({ budgetKcal: 2500, percent: 40 })
    expect(settings.dailyGoals!.manualCaloriesKcal).toBe(2000)
  })
  it('仅将当天已选择计入的额外活动加到分母', () => {
    const input = data(1250)
    const activity = createExercise({ date, manualScope: 'session', manualName: '额外活动', minutes: 60, manualActiveKcal: 500, includeInBudget: true })
    input.exercises = [activity, { ...activity, id: 'previous', date: '2026-10-22', activeKcal: 900 }, { ...activity, id: 'excluded', includeInBudget: false }]
    expect(diaryIntake(date, input)).toMatchObject({ budgetKcal: 2500, percent: 50 })
  })
  it('没有记录与明确的零热量记录分开显示', () => {
    expect(diaryIntake(date, { ...data(0), meals: [] })).toMatchObject({ state: 'empty', percent: null, label: '未记录' })
    expect(diaryIntake(date, data(0))).toMatchObject({ state: 'within', percent: 0, label: '0%' })
  })
  it('无预算、部分热量缺失、重量未知和活动预算待确认都不生成完整百分比', () => {
    expect(diaryIntake(date, { ...data(500), settings: { targetWeightKg: null } })).toMatchObject({ state: 'no-budget', percent: null, label: '无预算' })
    const input = data(500); input.meals.push(meal(null))
    expect(diaryIntake(date, input)).toMatchObject({ state: 'incomplete', percent: null, fill: 0, consumedKcal: 500, missingCalories: 1 })
    const unknownWeight = data(500); unknownWeight.meals[0]!.items[0]!.weightG = null
    expect(diaryIntake(date, unknownWeight).percent).toBeNull()
    const activity = createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 500, includeInBudget: true })
    expect(diaryIntake(date, { ...data(500), exercises: [{ ...activity, dayBudgetKcal: undefined }] })).toMatchObject({ state: 'incomplete', percent: null, incompleteActivity: true })
  })
  it('缺少历史可用体重时不使用未来称重填补自动预算', () => {
    const input = data(500)
    input.settings = { targetWeightKg: null, personalInfo: { sex: 'male', age: 30, heightCm: 175, startingWeightKg: 70, startingDate: '2026-10-24', activityLevel: 'light', autoEstimateAllowed: true } }
    input.weights = [{ date: '2026-10-24', weightKg: 70, updatedAt: '2026-10-24T04:00:00Z' }]
    expect(diaryIntake(date, input)).toMatchObject({ state: 'no-budget', percent: null })
  })
  it('紧邻0和100的显示不掩盖实际边界，模拟记录有独立标记', () => {
    expect(diaryIntake(date, data(1)).label).toBe('<1%')
    expect(diaryIntake(date, data(1999)).label).toBe('<100%')
    expect(diaryIntake(date, data(2001))).toMatchObject({ label: '>100%', state: 'over' })
    const input = data(1000); input.meals[0]!.mode = 'mock'
    expect(diaryIntake(date, input)).toMatchObject({ label: '50%', hasMock: true })
  })
})
