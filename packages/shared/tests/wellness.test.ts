import { describe, expect, it } from 'vitest';
import { calorieBudget, createExercise, dailyGoalsSchema, defaultDailyGoals, exerciseRecordSchema, goalProgress, makeDailyPlan, metEnergy, personalInfoSchema, restingCalories, waterRecordSchema, weightOnDate, type PersonalInfo, type Settings } from '../src/index.js';

const profile: PersonalInfo = { sex: 'male', age: 30, heightCm: 175, startingWeightKg: 70, startingDate: '2026-10-14', activityLevel: 'sedentary', autoEstimateAllowed: true };
const settings: Settings = { targetWeightKg: 65, personalInfo: profile, dailyGoals: { ...defaultDailyGoals, purpose: 'lose', waterMl: 1800, exerciseMinutes: 30 } };
const now = '2026-10-14T10:00:00.000Z';

describe('个人预算与运动估算', () => {
  it('使用 Mifflin 静息代谢，再按全天活动系数与用户调整计算，不直接把静息当预算', () => {
    expect(restingCalories(profile, 70)).toBe(1648.75);
    expect(restingCalories({ ...profile, sex: 'female' }, 70)).toBe(1482.75);
    const budget = calorieBudget(makeDailyPlan('2026-10-14', settings, [], now), [], 300);
    expect(budget.resting).toBe(1648.75); expect(budget.maintenance).toBeCloseTo(2308.25);
    expect(budget.base).toBeCloseTo(2108.25); expect(budget.remaining).toBeCloseTo(1808.25);
  });
  it('按日期选体重，参考起点优先于起点前旧记录，不能使用未来称重', () => {
    const weights = [ { date: '2026-10-13', weightKg: 90, updatedAt: now }, { date: '2026-10-15', weightKg: 65, updatedAt: now } ];
    expect(weightOnDate('2026-10-14', weights, profile).weightKg).toBe(70);
    expect(weightOnDate('2026-10-15', weights, profile).weightKg).toBe(65);
    expect(weightOnDate('2026-10-12', weights, profile).weightKg).toBeNull();
  });
  it('无资料不猜预算，手动预算不依赖资料，禁用自动估算时保留手动功能', () => {
    const empty = makeDailyPlan('2026-10-14', { targetWeightKg: null }, [], now);
    expect(calorieBudget(empty, [], 0).total).toBeNull();
    const manual = makeDailyPlan('2026-10-14', { ...settings, personalInfo: { ...profile, autoEstimateAllowed: false }, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 1800 } }, [], now);
    expect(calorieBudget(manual, [], 400).remaining).toBe(1400);
    expect(calorieBudget({ ...manual, settingsSnapshot: { ...manual.settingsSnapshot, dailyGoals: defaultDailyGoals } }, [], 0).total).toBeNull();
  });
  it('运动总消耗扣除同段静息消耗，默认不增加饮食预算，仅选择的额外活动计入', () => {
    expect(metEnergy(3, 70, 30)).toEqual({ grossKcal: 105, activeKcal: 70 });
    const regular = createExercise({ date: '2026-10-14', minutes: 30, activityCode: '17170', weightKg: 70, includeInBudget: false });
    const extra = createExercise({ date: '2026-10-14', minutes: 30, activityCode: '17170', weightKg: 70, includeInBudget: true });
    const future = { ...extra, date: '2026-10-15' };
    const budget = calorieBudget(makeDailyPlan('2026-10-14', settings, [], now), [regular, extra, future], 300);
    expect(budget.extra).toBe(70); expect(budget.remaining).toBeCloseTo(1878.25);
    expect(regular.activeKcal).toBe(70); expect(regular.grossKcal).toBe(105);
  });
  it('不完整摄入暂不显示剩余，超出预算保留负值供页面明确展示', () => {
    const plan = makeDailyPlan('2026-10-14', settings, [], now);
    expect(calorieBudget(plan, [], 300, 1).remaining).toBeNull();
    expect(calorieBudget(plan, [], 3000).remaining).toBeCloseTo(-891.75);
  });
  it('目标快照不随设置或体重数组修改而重算，运动保留当时的体重', () => {
    const original = structuredClone(settings), plan = makeDailyPlan('2026-10-14', original, [], now);
    original.dailyGoals!.adjustmentKcal = 400; original.personalInfo!.startingWeightKg = 90;
    expect(calorieBudget(plan, [], 0).base).toBeCloseTo(2108.25);
    const record = createExercise({ date: '2026-10-14', minutes: 30, activityCode: '17170', weightKg: 70, includeInBudget: false });
    const edited = createExercise({ date: record.date, minutes: 60, activityCode: '17170', weightKg: record.weightKg!, includeInBudget: false }, record);
    expect(edited.id).toBe(record.id); expect(edited.createdAt).toBe(record.createdAt); expect(edited.activeKcal).toBe(140);
  });
  it('拒绝未成年人资料、异常输入和运动算术冲突，手动活动能量允许真实的零值', () => {
    expect(personalInfoSchema.safeParse({ ...profile, age: 17 }).success).toBe(false);
    expect(personalInfoSchema.safeParse({ ...profile, heightCm: Infinity }).success).toBe(false);
    expect(dailyGoalsSchema.safeParse({ ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 999 }).success).toBe(false);
    const record = createExercise({ date: '2026-10-14', minutes: 30, activityCode: '17170', weightKg: 70, includeInBudget: false });
    expect(exerciseRecordSchema.safeParse({ ...record, activeKcal: 105 }).success).toBe(false);
    expect(() => metEnergy(3, 70, NaN)).toThrow();
    expect(createExercise({ date: '2026-10-14', minutes: 10, manualName: '拉伸', manualActiveKcal: 0, includeInBudget: false }).activeKcal).toBe(0);
    expect(() => createExercise({ date: '2026-10-14', minutes: 10, activityCode: 'not-real', weightKg: 70, includeInBudget: false })).toThrow();
  });
  it('过低自动结果不静默夹到最低值，饮水目标可关闭，进度最多 100%', () => {
    const small = makeDailyPlan('2026-10-14', { ...settings, personalInfo: { ...profile, age: 100, heightCm: 130, startingWeightKg: 35 } }, [], now);
    expect(calorieBudget(small, [], 0).base).toBeNull();
    expect(calorieBudget(small, [], 0).reason).toContain('支持');
    expect(goalProgress(2500, 1800)).toBe(100); expect(goalProgress(100, null)).toBe(0);
    expect(waterRecordSchema.safeParse({ id: 'water-1', date: '2026-10-14', amountMl: 250.555, createdAt: now, updatedAt: now }).success).toBe(false);
  });
  it('当前或目标体重偏低时不生成自动减重预算，异常称重不生成静息估算', () => {
    const lowCurrent = makeDailyPlan('2026-10-14', { ...settings, personalInfo: { ...profile, startingWeightKg: 50 } }, [], now);
    expect(calorieBudget(lowCurrent, [], 0).reason).toContain('体重偏低');
    const lowTarget = makeDailyPlan('2026-10-14', { ...settings, targetWeightKg: 50 }, [], now);
    expect(calorieBudget(lowTarget, [], 0).base).toBeNull();
    const invalid = { ...makeDailyPlan('2026-10-14', settings, [], now), weightKg: 600 };
    expect(calorieBudget(invalid, [], 0).resting).toBeNull();
  });
});
