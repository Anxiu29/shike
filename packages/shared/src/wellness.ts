/**
 * 预算/运动纯函数。输入是记录日的DailyPlan快照，不是随时变化的当前设置。
 * weightOnDate在目标页、体重页和预算共用：按参考起点选当天或之前的称重，不借未来体重。
 * 输入手环的是不含静息的活动读数，每天一条；更新累计传previous以保留ID/创建时间，
 * 不把最新累计当新增差额，也不虚构运动分钟；db.saveExercise在事务内检查同日唯一。
 * 先区分exerciseActivityTotal的原始活动统计与calorieBudget的预算增加额：
 * watchBudgetCredit只增加超过“全天维持−静息”的差额，且受旧dayBudgetKcal上限限制。
 * 无可用资料/关闭自动估算时手环不增加预算，仍可按已选择的单次活动计算；
 * 有有效累计时覆盖普通明细，俯卧撑按记账约定独立相加，设备已计入同动作会重复。
 * 次数先按节奏换分钟，再用(MET−1)×kg×分钟/60估活动消耗；默认3秒/个不含休息。
 * 70kg、30个、3秒/个、3.8MET得到约4.9kcal，只是公式例子；不倒推必须完成的运动量。
 * 当前规则替代早期“手环全量增加预算”；原始读数/运动快照不改，显示预算按现规则计算。
 * 回归：watch-budget、daily-activity、repetitions、wellness测试；公式来源保留在docs/wellness.md。
 */
import { exerciseActivities } from './exercise-catalog.js';
import { createId } from './id.js';
import { exerciseRecordSchema, type DailyGoals, type DailyPlan, type ExerciseRecord, type PersonalInfo, type Settings, type WeightRecord } from './schemas.js';

export const defaultDailyGoals: DailyGoals = { calorieMode: 'auto', manualCaloriesKcal: null, purpose: 'maintain', adjustmentKcal: 200, waterMl: null, exerciseMinutes: null, cupMl: 250 };
/** PAL 是全天活动水平，已经包含通常的日常活动；不是额外运动系数。 */
export const activityLevels = [
  { id: 'sedentary', label: '久坐为主', factor: 1.4 },
  { id: 'light', label: '轻度活动', factor: 1.6 },
  { id: 'moderate', label: '中度活动', factor: 1.8 },
  { id: 'active', label: '较多体力活动', factor: 2.0 },
] as const;
/**
 * 查询指定日期可用的体重：先排除未来记录，再比较最新称重与个人资料的参考起点。
 * 返回weightDate便于页面解释采用哪一天的依据，不能只返回一个无法追溯的数值。
 */
export function weightOnDate(date: string, weights: WeightRecord[], profile?: PersonalInfo | null) {
  const record = weights.filter(value => value.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  // 新起点后的体重记录优先；不把未来体重倒灌到旧日期。
  if (record && (!profile || record.date >= profile.startingDate)) return { weightKg: record.weightKg, weightDate: record.date };
  if (profile && profile.startingDate <= date) return { weightKg: profile.startingWeightKg, weightDate: profile.startingDate };
  return record ? { weightKg: record.weightKg, weightDate: record.date } : { weightKg: null, weightDate: null };
}
/** 冻结当日计算输入；深复制设置，防止之后改目标时连带改变已保存的历史预算依据。 */
export function makeDailyPlan(date: string, settings: Settings, weights: WeightRecord[], now = new Date().toISOString()): DailyPlan {
  return { date, formulaVersion: 'mifflin-1990-v1', settingsSnapshot: JSON.parse(JSON.stringify(settings)) as Settings,
    ...weightOnDate(date, weights, settings.personalInfo), createdAt: now, updatedAt: now };
}
export function restingCalories(profile: PersonalInfo, weightKg: number): number {
  return 10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age + (profile.sex === 'male' ? 5 : -161);
}
/**
 * 先计算基础预算，再合并允许计入的活动，最后减去“已知摄入”。
 * 返回各中间值供页面说明来源；只要摄入或活动不完整，remaining=null，不把缺失当零。
 * 这是本应用的估算记账规则，代码中的范围保护不意味着对任何人的摄入量作出医学保证。
 */
export function calorieBudget(plan: DailyPlan, exercises: ExerciseRecord[], consumedKcal: number, missingCalories = 0) {
  const profile = plan.settingsSnapshot.personalInfo;
  const goals = plan.settingsSnapshot.dailyGoals ?? defaultDailyGoals;
  const validProfile = profile?.autoEstimateAllowed && plan.weightKg !== null && plan.weightKg >= 20 && plan.weightKg <= 400;
  const resting = validProfile ? restingCalories(profile, plan.weightKg!) : null;
  const factor = profile ? activityLevels.find(level => level.id === profile.activityLevel)!.factor : null;
  const maintenance = resting !== null && factor !== null ? resting * factor : null;
  const adjustment = goals.purpose === 'lose' ? -goals.adjustmentKcal : goals.purpose === 'gain' ? goals.adjustmentKcal : 0;
  let base = goals.calorieMode === 'manual' ? goals.manualCaloriesKcal : maintenance === null ? null : maintenance + adjustment;
  let reason = base === null ? '填写个人资料或设置手动热量预算后，即可查看剩余估算。' : '';
  if (base === null && goals.calorieMode === 'auto' && profile) {
    if (!profile.autoEstimateAllowed) reason = '当前已关闭自动估算，仍可记录或自行设置手动预算。';
    else if (plan.weightKg === null) reason = '此日期没有可用体重，请到体重页补充相应日期的记录。';
    else reason = '当前体重超出自动估算支持的 20–400 kg 范围，记录功能仍可使用。';
  }
  // BMI 只作自动减重的筛查边界，不用于诊断或给出理想体重。
  if (goals.calorieMode === 'auto' && goals.purpose === 'lose' && profile && plan.weightKg !== null) {
    const heightM = profile.heightCm / 100;
    if (plan.weightKg / heightM ** 2 < 18.5 || (plan.settingsSnapshot.targetWeightKg !== null && plan.settingsSnapshot.targetWeightKg / heightM ** 2 < 18.5)) {
      base = null; reason = '当前或目标体重偏低，已暂停自动减重预算；仍可记录，请先确认适合自己的目标。';
    }
  }
  // 不把过低估算当成安全摄入建议，也不静默抬高目标。
  if (base !== null && (base < 1000 || base > 6000)) { base = null; reason = '结果超出本工具支持的每日 1000–6000 kcal 范围，请调整预算或咨询专业人士。'; }
  const recordedActivity = exerciseActivityTotal(exercises, plan.date, true);
  const watch = watchBudgetCredit(plan, recordedActivity.daily?.activeKcal ?? 0, recordedActivity.daily?.dayBudgetKcal ?? 0);
  const extra = recordedActivity.daily ? watch.baselineKcal === null
    ? exerciseActivityTotal(exercises.filter(record => record.manualScope !== 'day'), plan.date, true).activeKcal
    : watch.creditKcal + recordedActivity.independentKcal : recordedActivity.activeKcal;
  const activitySummary = { ...recordedActivity, activeKcal: extra, dailyKcal: recordedActivity.daily ? watch.creditKcal : 0,
    dailyReadingKcal: recordedActivity.daily?.activeKcal ?? 0, estimatedActivityKcal: watch.baselineKcal };
  if (activitySummary.incomplete && !reason) reason = '请确认全天汇总中计入额外预算的热量，或关闭该记录的计入选项。';
  const total = base === null ? null : base + extra;
  return { resting, maintenance, base, extra, total, consumedKcal, missingCalories, activitySummary,
    remaining: total === null || missingCalories > 0 || activitySummary.incomplete ? null : total - consumedKcal, reason };
}
/** 全天维持已含常规非静息消耗；手环仅增加高于该粗估的差额，不全量叠加。 */
export function watchBudgetCredit(plan: DailyPlan, activeKcal: number, legacyCap = activeKcal) {
  const profile = plan.settingsSnapshot.personalInfo;
  const resting = profile?.autoEstimateAllowed && plan.weightKg !== null && plan.weightKg >= 20 && plan.weightKg <= 400 ? restingCalories(profile, plan.weightKg) : null;
  const factor = profile ? activityLevels.find(level => level.id === profile.activityLevel)?.factor : undefined;
  const baselineKcal = resting !== null && factor !== undefined ? Math.max(0, resting * factor - resting) : null;
  const excessKcal = baselineKcal === null || !Number.isFinite(activeKcal) ? 0 : Math.max(0, activeKcal - baselineKcal);
  // 保留旧记录曾明确设置的上限；不因升级把旧的部分计入扩大成全部计入。
  const creditKcal = Math.min(excessKcal, Number.isFinite(legacyCap) ? Math.max(0, legacyCap) : 0);
  return { baselineKcal, excessKcal, creditKcal };
}
/** 俯卧撑按用户选择独立计入，不被手环累计覆盖；不表示手环一定漏测。 */
export function isPushupExercise(record: ExerciseRecord) {
  return record.method === 'repetitions' && (record.activityCode === '02022' || record.activityCode === '02020');
}
/** 手环覆盖普通明细，俯卧撑作为独立额外活动相加；关闭计入的记录仅参与活动统计。 */
export function exerciseActivityTotal(records: ExerciseRecord[], date: string, selectedOnly = false) {
  const selected = records.filter(record => record.date === date && (!selectedOnly || record.includeInBudget));
  // 正常保存与备份校验只允许一条汇总；历史异常数据仍按最新快照确定性显示。
  const daily = selected.filter(record => record.method === 'manual' && record.manualScope === 'day').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0] ?? null;
  const pushups = selected.filter(isPushupExercise);
  const independentKcal = pushups.reduce((sum, record) => sum + record.activeKcal, 0);
  const dailyKcal = daily ? selectedOnly ? daily.dayBudgetKcal ?? 0 : daily.activeKcal : 0;
  return { activeKcal: daily ? dailyKcal + independentKcal : selected.reduce((sum, record) => sum + record.activeKcal, 0), daily, dailyKcal, independentKcal,
    coveredEntries: daily ? selected.length - pushups.length - 1 : 0, incomplete: !!(selectedOnly && daily && daily.dayBudgetKcal == null) };
}
/** MET 总消耗含静息部分；可计入额外预算的是扣除 1 MET 后的活动部分。 */
export function metEnergy(met: number, weightKg: number, minutes: number) {
  if (![met, weightKg, minutes].every(Number.isFinite) || met < 1 || met > 30 || weightKg <= 0 || weightKg > 600 || minutes <= 0 || minutes > 600) throw new Error('请输入有效的运动强度、体重和时长。');
  const restingPart = weightKg * minutes / 60;
  return { grossKcal: met * restingPart, activeKcal: (met - 1) * restingPart };
}
export function repetitionMinutes(count: number, secondsPerRep = 3): number {
  if (!Number.isInteger(count) || count < 1 || count > 2000 || !Number.isFinite(secondsPerRep) || secondsPerRep < 1 || secondsPerRep > 10 || Math.abs(secondsPerRep * 100 - Math.round(secondsPerRep * 100)) > 1e-7) throw new Error('俯卧撑请输入1–2000个整数，每个动作1–10秒。');
  // 这是用户可调整的动作节奏假设，默认3秒/个；只算做动作的时间，不把组间休息算进去。
  return count * secondsPerRep / 60;
}
export function createExercise(input: { date: string; minutes?: number; includeInBudget: boolean; activityCode?: string; weightKg?: number; count?: number; secondsPerRep?: number; manualName?: string; manualActiveKcal?: number; manualScope?: 'session' | 'day'; deviceReading?: 'active' | 'total' | 'unknown' | ''; dayBudgetKcal?: number | null }, previous?: ExerciseRecord): ExerciseRecord {
  const activity = exerciseActivities.find(value => value.code === input.activityCode);
  const now = new Date().toISOString();
  if (input.activityCode && (!activity || input.weightKg == null)) throw new Error('请选择有效运动项目，并填写本次体重。');
  if (activity && input.manualScope !== undefined) throw new Error('项目估算不能混用全天活动汇总。');
  const daily = input.manualScope === 'day';
  if (daily && input.deviceReading !== 'active') throw new Error('请确认手环显示的是活动热量。含静息的总消耗或未确认的读数不能直接当作活动热量。');
  if (!daily && (input.deviceReading !== undefined || input.dayBudgetKcal !== undefined)) throw new Error('请勿将全天设备读数混入单次运动。');
  // 保存原读数及兼容上限；实际预算由watchBudgetCredit仅计入高于常规的差额。
  const dayBudgetKcal = daily ? input.dayBudgetKcal ?? (input.includeInBudget ? input.manualActiveKcal ?? null : null) : null;
  if (daily && input.dayBudgetKcal != null && input.manualActiveKcal != null && input.dayBudgetKcal > input.manualActiveKcal) throw new Error('计入额外预算的部分不能超过手环当天活动热量。');
  const repetitions = activity?.unit === 'repetitions';
  if (!repetitions && (input.count !== undefined || input.secondsPerRep !== undefined)) throw new Error('当前运动不按次数计量。');
  const minutes = repetitions ? repetitionMinutes(input.count ?? 0, input.secondsPerRep ?? 3) : input.manualScope === 'day' ? null : input.minutes ?? 0;
  const record = { id: previous?.id ?? createId(), date: input.date, minutes,
    includeInBudget: input.includeInBudget, createdAt: previous?.createdAt ?? now, updatedAt: now,
    ...(repetitions ? { repetitionSnapshot: { count: input.count!, secondsPerRep: input.secondsPerRep ?? 3, formulaVersion: 'repetitions-met-v1' as const } } : {}),
    ...(activity ? { method: repetitions ? 'repetitions' as const : 'met' as const, name: activity.name, activityCode: activity.code, met: activity.met, weightKg: input.weightKg!, ...metEnergy(activity.met, input.weightKg!, minutes!) }
      : { method: 'manual' as const, name: input.manualScope === 'day' ? '当天累计活动' : input.manualName ?? '', ...(input.manualScope ? { manualScope: input.manualScope } : {}), ...(daily ? { deviceReading: 'active' as const, dayBudgetKcal } : {}), activityCode: null, met: null, weightKg: null, grossKcal: null, activeKcal: input.manualActiveKcal }),
  };
  const parsed = exerciseRecordSchema.safeParse(record);
  if (!parsed.success) throw new Error(daily ? '活动热量请输入0–20000 kcal，最多两位小数。' : '请检查运动名称、时长（1–600 分钟）和活动消耗数值。');
  return parsed.data;
}
export function goalProgress(value: number, target: number | null | undefined): number { return target && target > 0 ? Math.min(100, Math.max(0, value / target * 100)) : 0; }
