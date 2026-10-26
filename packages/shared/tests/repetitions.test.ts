import { describe, expect, it } from 'vitest';
import { calorieBudget, createExercise, defaultDailyGoals, exerciseRecordSchema, makeDailyPlan, repetitionMinutes } from '../src/index.js';
const base = { date: '2026-10-16', activityCode: '02022', count: 30, weightKg: 70, includeInBudget: false };
describe('俯卧撑按次数估算', () => {
  it('次数按明确节奏换算时长，中等／较高强度保留来源原值，扣除静息', () => {
    const record = createExercise(base); expect(record.method).toBe('repetitions'); expect(record.minutes).toBe(1.5); expect(record.met).toBe(3.8); expect(record.activeKcal).toBeCloseTo(4.9); expect(record.grossKcal).toBeCloseTo(6.65);
    expect(record.repetitionSnapshot).toEqual({ count: 30, secondsPerRep: 3, formulaVersion: 'repetitions-met-v1' });
    expect(createExercise({ ...base, activityCode: '02020' }).activeKcal).toBeCloseTo(11.375);
  });
  it('少于一分钟也能保存，内部保留精度，不将每个热量伪装为固定值', () => {
    expect(createExercise({ ...base, count: 1 }).minutes).toBe(0.05);
    const changed = createExercise({ ...base, count: 1, secondsPerRep: 4 }); expect(changed.minutes).toBeCloseTo(1 / 15); expect(changed.activeKcal).toBeCloseTo(2.8 * 70 / 900);
    expect(createExercise({ ...base, weightKg: 100 }).activeKcal).toBeCloseTo(7);
    expect(() => createExercise({ ...base, activityCode: '17170', count: undefined, minutes: 0.5 })).toThrow();
  });
  it('拒绝小数个数、缺失体重、非法节奏、串用模式和篡改热量／时间的备份', () => {
    for (const count of [0, -1, 1.5, 2001, Infinity, NaN]) expect(() => createExercise({ ...base, count })).toThrow();
    for (const secondsPerRep of [0, 11, NaN, 3.001]) expect(() => repetitionMinutes(30, secondsPerRep)).toThrow();
    expect(() => createExercise({ ...base, weightKg: undefined })).toThrow();
    const record = createExercise(base);
    for (const changed of [{ minutes: 30 }, { activeKcal: 500 }, { method: 'met' }, { repetitionSnapshot: undefined }]) expect(exerciseRecordSchema.safeParse({ ...record, ...changed }).success).toBe(false);
    const timed = createExercise({ date: base.date, activityCode: '17170', minutes: 30, weightKg: 70, includeInBudget: false }); expect(exerciseRecordSchema.safeParse({ ...timed, repetitionSnapshot: record.repetitionSnapshot }).success).toBe(false);
  });
  it('只把实际记录且选入预算的活动消耗计入，超额不转换成必须完成的次数', () => {
    const plan = makeDailyPlan(base.date, { targetWeightKg: null, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 1800 } }, []);
    const regular = createExercise(base), extra = createExercise({ ...base, includeInBudget: true });
    expect(calorieBudget(plan, [regular], 2000).remaining).toBe(-200);
    expect(calorieBudget(plan, [regular, extra], 2000).remaining).toBeCloseTo(-195.1);
    expect(calorieBudget(plan, [{ ...extra, date: '2026-10-15' }], 2000).remaining).toBe(-200);
    expect(calorieBudget(plan, [extra], 2000, 1).remaining).toBeNull();
  });
  it('编辑次数重算，改为计时清除次数，保留原记录标识且不改旧快照', () => {
    const previous = createExercise(base), edited = createExercise({ ...base, count: 50 }, previous);
    expect(edited.id).toBe(previous.id); expect(edited.createdAt).toBe(previous.createdAt); expect(previous.repetitionSnapshot!.count).toBe(30); expect(edited.activeKcal).toBeCloseTo(8.1666667);
    const timed = createExercise({ date: base.date, activityCode: '17170', minutes: 30, weightKg: 70, includeInBudget: false }, edited); expect(timed.repetitionSnapshot).toBeUndefined(); expect(timed.method).toBe('met');
  });
});
