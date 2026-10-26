import { describe, expect, it } from 'vitest';
import { calorieBudget, createExercise, defaultDailyGoals, makeDailyPlan, watchBudgetCredit, type Settings } from '../src/index.js';
const date = '2026-10-19';
const settings: Settings = { targetWeightKg: null, personalInfo: { sex: 'male', age: 30, heightCm: 180, startingWeightKg: 69.25, startingDate: date, activityLevel: 'light', autoEstimateAllowed: true }, dailyGoals: { ...defaultDailyGoals } };
const plan = () => makeDailyPlan(date, settings, []);
const watch = (reading: number, includeInBudget = true) => createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: reading, includeInBudget });
describe('手环只补超过常规的差额', () => {
  it('常规为1003.5kcal，低于和等于门槛不增加，1200只补196.5', () => {
    for (const value of [0, 500, 1003.5]) expect(watchBudgetCredit(plan(), value).creditKcal).toBe(0);
    expect(watchBudgetCredit(plan(), 1200)).toEqual({ baselineKcal: 1003.5, excessKcal: 196.5, creditKcal: 196.5 });
    const budget = calorieBudget(plan(), [watch(1200)], 1000); expect(budget.base).toBe(2676); expect(budget.extra).toBe(196.5); expect(budget.remaining).toBe(1872.5);
  });
  it('关闭计入不补差额，旧记录自定上限不扩大，读数本身不改写', () => {
    const record = watch(1200); record.dayBudgetKcal = 120;
    expect(calorieBudget(plan(), [record], 0).extra).toBe(120); expect(record.activeKcal).toBe(1200); expect(record.dayBudgetKcal).toBe(120);
    expect(calorieBudget(plan(), [watch(1200, false)], 0).extra).toBe(0);
  });
  it('没有可用个人资料时不拿手动预算猜活动门槛，读数仅作统计', () => {
    const manual = makeDailyPlan(date, { targetWeightKg: null, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 1800 } }, []);
    const budget = calorieBudget(manual, [watch(1200)], 1000); expect(budget.extra).toBe(0); expect(budget.remaining).toBe(800); expect(budget.activitySummary.estimatedActivityKcal).toBeNull();
    const walk = createExercise({ date, activityCode: '17170', minutes: 30, weightKg: 70, includeInBudget: true });
    expect(calorieBudget(manual, [watch(1200), walk], 0).extra).toBe(70);
  });
  it('普通明细不和全天读数重复叠加，俯卧撑仍可独立补记', () => {
    const pushups = createExercise({ date, activityCode: '02022', count: 30, weightKg: 70, includeInBudget: true });
    const walking = createExercise({ date, activityCode: '17170', minutes: 30, weightKg: 70, includeInBudget: true });
    expect(calorieBudget(plan(), [watch(1200), pushups, walking], 0).extra).toBeCloseTo(196.5 + pushups.activeKcal);
    expect(calorieBudget(plan(), [watch(500), pushups, walking], 0).extra).toBeCloseTo(pushups.activeKcal);
  });
  it('按当日快照的活动水平算门槛，后来修改资料不反写过去的基础预算', () => {
    const source = structuredClone(settings), previous = makeDailyPlan(date, source, []);
    source.personalInfo!.activityLevel = 'active'; expect(watchBudgetCredit(previous, 1200).creditKcal).toBe(196.5);
    expect(watchBudgetCredit(makeDailyPlan(date, source, []), 1200).creditKcal).toBe(0);
  });
});
