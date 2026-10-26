import { describe, expect, it } from 'vitest';
import { backupSchema, calorieBudget, createExercise, defaultDailyGoals, exerciseActivityTotal, exerciseRecordSchema, makeDailyPlan } from '../src/index.js';
const date = '2026-10-16';
const day = (includeInBudget = true) => createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 500, dayBudgetKcal: includeInBudget ? 120 : null, includeInBudget });
const walk = () => createExercise({ date, activityCode: '17170', minutes: 30, weightKg: 70, includeInBudget: true });
describe('手环全天活动汇总', () => {
  it('新累计保存完整读数，无虚构时长；旧版部分计入上限保持兼容', () => {
    const record = day(); expect(record.minutes).toBeNull(); expect(record.activeKcal).toBe(500); expect(record.dayBudgetKcal).toBe(120); expect(record.deviceReading).toBe('active'); expect(record.grossKcal).toBeNull();
    const direct = createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 500, includeInBudget: true });
    expect(direct.dayBudgetKcal).toBe(500); expect(exerciseActivityTotal([walk(), direct], date, true).activeKcal).toBe(500);
    expect(createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 650, includeInBudget: true }, record).dayBudgetKcal).toBe(650);
    expect(record.dayBudgetKcal).toBe(120);
  });
  it('含静息总消耗和未确认读数不能伪装成活动热量，额外部分不可超过原始读数', () => {
    for (const deviceReading of ['total', 'unknown', ''] as const) expect(() => createExercise({ date, manualScope: 'day', deviceReading, manualActiveKcal: 500, includeInBudget: false })).toThrow('活动热量');
    expect(() => createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 500, dayBudgetKcal: 501, includeInBudget: true })).toThrow('超过');
    for (const changed of [{ minutes: 1440 }, { minutes: 30 }, { deviceReading: 'total' }, { dayBudgetKcal: 501 }, { dayBudgetKcal: null }]) expect(exerciseRecordSchema.safeParse({ ...day(), ...changed }).success).toBe(false);
  });
  it('全天累计覆盖步行但保留俯卧撑独立额外活动；仅统计时预算仍按已选单项算', () => {
    const records = [walk(), createExercise({ date, activityCode: '02022', count: 30, weightKg: 70, includeInBudget: true }), day()];
    expect(exerciseActivityTotal(records, date).activeKcal).toBeCloseTo(504.9); expect(exerciseActivityTotal(records, date).coveredEntries).toBe(1); expect(exerciseActivityTotal(records, date, true).activeKcal).toBeCloseTo(124.9);
    const plan = makeDailyPlan(date, { targetWeightKg: null, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 1800 } }, []);
    expect(calorieBudget(plan, records, 2000).remaining).toBeCloseTo(-125.1);
    expect(calorieBudget(plan, [walk(), day(false)], 2000).extra).toBe(70); expect(exerciseActivityTotal([walk(), day(false)], date).activeKcal).toBe(500);
    expect(calorieBudget(plan, [walk(), { ...day(), date: '2026-10-15' }], 2000).extra).toBe(70);
  });
  it('两种俯卧撑均独立累计，关闭预算只影响计入，其他日期和普通明细不重复加', () => {
    const normal = createExercise({ date, activityCode: '02022', count: 30, weightKg: 70, includeInBudget: true });
    const vigorous = createExercise({ date, activityCode: '02020', count: 20, weightKg: 70, includeInBudget: false });
    const records = [walk(), day(), normal, vigorous, { ...normal, date: '2026-10-15' }];
    const all = exerciseActivityTotal(records, date), budget = exerciseActivityTotal(records, date, true);
    expect(all.activeKcal).toBeCloseTo(500 + normal.activeKcal + vigorous.activeKcal);
    expect(budget.activeKcal).toBeCloseTo(120 + normal.activeKcal); expect(budget.dailyKcal).toBe(120); expect(budget.independentKcal).toBeCloseTo(normal.activeKcal);
    expect(exerciseActivityTotal([walk(), normal], date, true).activeKcal).toBeCloseTo(74.9);
    expect(exerciseActivityTotal([day(), { ...normal, includeInBudget: false }], date, true).activeKcal).toBe(120);
  });
  it('零值是已知数，不完整历史汇总不伪造完整剩余额度', () => {
    const zero = createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 0, dayBudgetKcal: 0, includeInBudget: true }); expect(exerciseActivityTotal([walk(), zero], date, true).activeKcal).toBe(0);
    const invalid = { ...day(), dayBudgetKcal: null }, plan = makeDailyPlan(date, { targetWeightKg: null, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 1800 } }, []); expect(calorieBudget(plan, [invalid], 1000).remaining).toBeNull();
  });
  it('旧单次记录继续按时长累计，编辑当天累计保留标识并替换数值', () => {
    const old = createExercise({ date, minutes: 30, manualName: '设备运动', manualActiveKcal: 50, includeInBudget: true }); expect(old.manualScope).toBeUndefined(); expect(exerciseActivityTotal([old, walk()], date).activeKcal).toBe(120);
    const previous = day(), updated = createExercise({ date, manualScope: 'day', deviceReading: 'active', manualActiveKcal: 650, dayBudgetKcal: 180, includeInBudget: true }, previous); expect(updated.id).toBe(previous.id); expect(updated.createdAt).toBe(previous.createdAt); expect(previous.activeKcal).toBe(500); expect(updated.activeKcal).toBe(650);
  });
  it('v8保存全天读数与额外部分，拒绝同日重复汇总，v7兼容原单次记录', () => {
    const backup = { schemaVersion: 8, exportedAt: new Date().toISOString(), settings: { targetWeightKg: null }, meals: [], weights: [], estimatedFoods: [], packagedFoods: [], water: [], exercises: [day(), walk()], dailyPlans: [] };
    const parsed = backupSchema.parse(JSON.parse(JSON.stringify(backup))); expect(parsed.exercises[0]!.dayBudgetKcal).toBe(120);
    expect(backupSchema.safeParse({ ...backup, exercises: [day(), { ...day(), id: 'another' }] }).success).toBe(false);
    expect(backupSchema.parse({ ...backup, schemaVersion: 7, exercises: [walk()] }).schemaVersion).toBe(11);
  });
});
