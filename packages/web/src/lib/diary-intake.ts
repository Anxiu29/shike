import { aggregateNutrients, calorieBudget, makeDailyPlan, type DailyPlan, type ExerciseRecord, type MealRecord, type Settings, type WeightRecord } from '@shike/shared'

export interface DiaryIntakeData {
  meals: MealRecord[]
  settings: Settings
  weights: WeightRecord[]
  exercises: ExerciseRecord[]
  dailyPlans: DailyPlan[]
}

/** 与当日总览共用预算规则；历史使用当日快照，未补齐的数据不生成完整百分比。 */
export function diaryIntake(date: string, data: DiaryIntakeData) {
  const meals = data.meals.filter(meal => meal.date === date)
  const entries = meals.flatMap(meal => meal.items)
  const energy = aggregateNutrients(entries).energyKcal
  const plan = data.dailyPlans.find(plan => plan.date === date) ?? makeDailyPlan(date, data.settings, data.weights)
  const budget = calorieBudget(plan, data.exercises, energy.known, energy.missing)
  const state = !entries.length ? 'empty' : budget.total === null ? 'no-budget'
    : energy.missing || budget.activitySummary.incomplete ? 'incomplete'
      : energy.known > budget.total ? 'over' : 'within'
  const percent = (state === 'within' || state === 'over') && budget.total !== null ? energy.known / budget.total * 100 : null
  const rounded = percent === null ? null : Math.round(percent)
  const label = percent === null ? state === 'empty' ? '未记录' : state === 'no-budget' ? '无预算' : '待补全'
    : percent > 0 && rounded === 0 ? '<1%' : percent < 100 && rounded === 100 ? '<100%'
      : percent > 100 && rounded === 100 ? '>100%' : `${rounded}%`
  const hasMock = meals.some(meal => meal.mode === 'mock' || meal.items.some(entry => entry.aiEstimateSnapshot?.provider === 'mock' || entry.packageSnapshot?.provider === 'mock'))
  return { state, percent, fill: Math.min(100, percent ?? 0), label, consumedKcal: energy.known, budgetKcal: budget.total,
    missingCalories: energy.missing, incompleteActivity: budget.activitySummary.incomplete, hasRecords: !!entries.length, hasMock }
}
