/**
 * 领域契约：Zod在运行时校验外部JSON，z.infer从同一schema推导TypeScript类型。
 * TypeScript只在开发/构建时检查，不能保证模型、备份或本地存储的实际内容正确。
 * 顺着FoodEntry → MealRecord → Backup阅读；来源与数值快照一起保存，null表示未知。
 * superRefine检查跨字段关系，如份量乘积、区间中值、运动能量及同日累计唯一性。
 * backupSchema兼容v1～v11并转换到v11；它的版本号与Dexie建表版本6没有一一对应关系。
 * 修改约束时同时检查模型解析、前端保存和备份迁移；不要编辑generated.ts来绕过校验。
 */
import { z } from 'zod';
import { exerciseActivities } from './exercise-catalog.js';
import { validBarcode, normalizeBarcode } from './barcode.js';
import { packageNutrientsPer100g, packageWeight } from './package-label.js';

// null 表示缺失数据，不能把它写成 0；0 才表示数据源明确记录为零。
const nullableNutrient = z.number().finite().min(0).max(100).nullable();
export const nutrientsSchema = z.object({
  energyKcal: z.number().finite().min(0).max(1000).nullable(),
  proteinG: nullableNutrient,
  fatG: nullableNutrient,
  carbsG: nullableNutrient,
}).strict();
export type Nutrients = z.infer<typeof nutrientsSchema>;

const createNumericRangeSchema = (maximum: number) => z.object({
  min: z.number().finite().min(0).max(maximum),
  max: z.number().finite().min(0).max(maximum),
}).strict().refine((range) => range.min <= range.max, '范围下限不能大于上限');
export const numericRangeSchema = createNumericRangeSchema(1000);
export type NumericRange = z.infer<typeof numericRangeSchema>;
export const nutrientRangesSchema = z.object({
  energyKcal: numericRangeSchema.nullable(),
  proteinG: createNumericRangeSchema(100).nullable(),
  fatG: createNumericRangeSchema(100).nullable(),
  carbsG: createNumericRangeSchema(100).nullable(),
}).strict();
export type NutrientRanges = z.infer<typeof nutrientRangesSchema>;
export const estimateLevelSchema = z.enum(['low', 'medium', 'high']);
export type EstimateLevel = z.infer<typeof estimateLevelSchema>;
export const estimateLevels: EstimateLevel[] = ['low', 'medium', 'high'];

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '日期必须是实际存在的 YYYY-MM-DD');
const timestampSchema = z.iso.datetime({ offset: true });
const shortText = z.string().trim().min(1).max(200);
const warningsSchema = z.array(z.string().max(500)).max(30);
const weightSchema = z.number().finite().min(0).max(20000);
const providerSchema = z.enum(['gemini', 'glm', 'qwen', 'siliconflow', 'openrouter', 'deepseek', 'mock']);

const packageMeasureSchema = z.object({ amount: z.number().finite().positive().max(20000), unit: z.enum(['g', 'ml']) }).strict();
/** 模型只抄标签原数值；未知单位／基准不猜，营养百分比不进数值字段。 */
export const packageLabelSchema = z.object({
  basis: z.enum(['100g', '100ml', 'serving', 'package', 'unknown']),
  energy: z.object({ value: z.number().finite().min(0).max(100000), unit: z.enum(['kJ', 'kcal']) }).strict().nullable(),
  proteinG: z.number().finite().min(0).max(5000).nullable(),
  fatG: z.number().finite().min(0).max(5000).nullable(),
  carbsG: z.number().finite().min(0).max(5000).nullable(),
  servingSize: packageMeasureSchema.nullable(), netContent: packageMeasureSchema.nullable(),
}).strict().superRefine((label, context) => {
  const per100 = packageNutrientsPer100g(label);
  if (!nutrientsSchema.safeParse(per100).success) context.addIssue({ code: 'custom', message: '标签换算后超出合理范围，请核对单位与每份大小' });
  const volume = label.basis === '100ml' ? 100 : label.basis === 'serving' && label.servingSize?.unit === 'ml' ? label.servingSize.amount : label.basis === 'package' && label.netContent?.unit === 'ml' ? label.netContent.amount : null;
  if (volume !== null && ((label.energy && label.energy.value / (label.energy.unit === 'kJ' ? 4.184 : 1) * 100 / volume > 2000) || [label.proteinG, label.fatG, label.carbsG].some(value => value !== null && value * 100 / volume > 200)))
    context.addIssue({ code: 'custom', message: '每100mL标签数值超出范围' });
});
export type PackageLabel = z.infer<typeof packageLabelSchema>;
export const barcodeSchema = z.string().refine(validBarcode, '请输入有效的8、12、13或14位商品条码，检查末位校验码').transform(normalizeBarcode);
export const catalogSourceSchema = z.object({ type: z.literal('openfoodfacts'), barcode: barcodeSchema,
  url: z.string().url().refine(value => /^https:\/\/world\.openfoodfacts\.org\/product\/\d{8,14}$/.test(value)),
  license: z.literal('ODbL-1.0'), retrievedAt: timestampSchema }).strict()
  .refine(source => source.url === `https://world.openfoodfacts.org/product/${source.barcode}`, '来源链接须与商品条码一致');
export const packageSnapshotSchema = z.object({
  label: packageLabelSchema,
  consumedAmount: z.number().finite().min(0).max(20000).nullable(),
  consumedUnit: z.enum(['g', 'ml', 'serving', 'package']),
  provider: z.union([providerSchema, z.literal('manual')]), model: shortText, manuallyEdited: z.boolean(),
  source: catalogSourceSchema.optional(), brand: z.string().max(200).optional(), barcode: barcodeSchema.optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.source && snapshot.barcode !== snapshot.source.barcode) context.addIssue({ code: 'custom', message: '标签条码与公开来源不一致' });
  const amount = snapshot.consumedAmount;
  const measure = snapshot.consumedUnit === 'package' ? snapshot.label.netContent : snapshot.consumedUnit === 'serving' ? snapshot.label.servingSize : null;
  if (amount !== null && (((snapshot.consumedUnit === 'package' || snapshot.consumedUnit === 'serving') && amount > 100) || (measure && measure.amount * amount > 20000)))
    context.addIssue({ code: 'custom', message: '实际摄入不能超过100份／包或20000g／mL' });
});
export type PackageSnapshot = z.infer<typeof packageSnapshotSchema>;
export const packagedFoodSchema = z.object({
  id: shortText, name: shortText, brand: z.string().trim().max(200), barcode: barcodeSchema.nullable(), label: packageLabelSchema,
  provider: z.enum(['gemini', 'glm', 'qwen', 'siliconflow', 'openrouter', 'deepseek', 'manual']), model: shortText, manuallyEdited: z.boolean(),
  source: catalogSourceSchema.optional(), createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().refine(food => !food.source || food.barcode === food.source.barcode, '包装条码与公开来源不一致');
export type PackagedFood = z.infer<typeof packagedFoodSchema>;

export const nutritionEstimateOptionSchema = z.object({
  level: estimateLevelSchema,
  label: shortText,
  rangesPer100g: nutrientRangesSchema,
  assumptions: warningsSchema,
  oilWeightPer100g: createNumericRangeSchema(100).optional(),
}).strict();
export type NutritionEstimateOption = z.infer<typeof nutritionEstimateOptionSchema>;
export const nutritionEstimateProfileSchema = z.object({
  factor: z.enum(['sweetness', 'oil', 'general']),
  options: z.array(nutritionEstimateOptionSchema).length(3)
    .refine((options) => new Set(options.map((option) => option.level)).size === 3, '三档估算必须各有一个 low、medium 和 high')
    // 外部可重排，应用里始终按低、中、高展示。
    .transform((options) => [...options].sort((first, second) => estimateLevels.indexOf(first.level) - estimateLevels.indexOf(second.level))),
}).strict().superRefine((profile, context) => {
  const low = profile.options.find((option) => option.level === 'low')?.rangesPer100g.energyKcal;
  const medium = profile.options.find((option) => option.level === 'medium')?.rangesPer100g.energyKcal;
  const high = profile.options.find((option) => option.level === 'high')?.rangesPer100g.energyKcal;
  if (low && medium && high && !(low.min <= medium.min && medium.min <= high.min && low.max <= medium.max && medium.max <= high.max)) {
    context.addIssue({ code: 'custom', message: '三档热量范围须按低、中、高依次不减', path: ['options'] });
  }
});
export type NutritionEstimateProfile = z.infer<typeof nutritionEstimateProfileSchema>;

const schemaNutrientKeys = ['energyKcal', 'proteinG', 'fatG', 'carbsG'] as const;
function inconsistentMidpointKeys(nutrients: Nutrients, profile: NutritionEstimateProfile, level: EstimateLevel): (keyof Nutrients)[] {
  const selected = profile.options.find((option) => option.level === level);
  if (!selected) return [...schemaNutrientKeys];
  return schemaNutrientKeys.filter((key) => {
    const range = selected.rangesPer100g[key];
    const point = nutrients[key];
    if (range === null) return point !== null;
    return point === null || Math.abs(point - (range.min + range.max) / 2) > 1e-7;
  });
}

// 只统一空白、括号和大小写；绝不删除生、熟、糖、酱等会改变食物含义的词。
export const normalizeFoodName = (name: string): string => name.trim().toLowerCase().replace(/[\s（）()]/g, '');

export const aiEstimateSnapshotSchema = z.object({
  nutrientsPer100g: nutrientsSchema,
  assumptions: warningsSchema,
  provider: providerSchema,
  model: shortText,
}).strict();
export type AiEstimateSnapshot = z.infer<typeof aiEstimateSnapshotSchema>;

// AI 粗估单独留在用户本地，不加入 USDA 公共参考数据数组。
export const estimatedFoodSchema = z.object({
  id: shortText,
  name: shortText,
  nutrientsPer100g: nutrientsSchema,
  provenance: z.string().max(1000),
  assumptions: warningsSchema,
  provider: providerSchema,
  model: shortText,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  estimateProfile: nutritionEstimateProfileSchema.optional(),
  estimateLevel: estimateLevelSchema.optional(),
}).strict().superRefine((food, context) => {
  if (food.estimateLevel && !food.estimateProfile) {
    context.addIssue({ code: 'custom', message: '估算档位必须对应完整三档资料', path: ['estimateLevel'] });
  }
  if (food.estimateProfile) {
    for (const key of inconsistentMidpointKeys(food.nutrientsPer100g, food.estimateProfile, food.estimateLevel ?? 'medium')) {
      context.addIssue({ code: 'custom', message: '个人食物营养须等于所选估算档位的中值；确定数请撤销范围', path: ['nutrientsPer100g', key] });
    }
  }
}).transform((food) => food.estimateProfile && !food.estimateLevel ? { ...food, estimateLevel: 'medium' as const } : food);
export const personalFoodSchema = estimatedFoodSchema;
export type EstimatedFood = z.infer<typeof estimatedFoodSchema>;
export type PersonalFood = EstimatedFood;

export const recipeIngredientSnapshotSchema = z.object({
  id: shortText,
  foodId: shortText,
  name: shortText,
  weightG: weightSchema,
  nutrientsPer100g: nutrientsSchema,
  provenance: z.string().max(1000),
  note: z.string().max(500),
}).strict();
export const recipeSnapshotSchema = z.object({
  recipeId: shortText,
  name: shortText,
  referenceWeightG: weightSchema.positive(),
  ingredients: z.array(recipeIngredientSnapshotSchema).min(1).max(50),
  warnings: warningsSchema,
}).strict();
export type RecipeSnapshot = z.infer<typeof recipeSnapshotSchema>;

/** 独立的体积快照，不把mL写进weightG，也不复用每100g参考值。 */
export const volumeSnapshotSchema = z.object({
  amountMl: weightSchema.nullable(),
  nutrientsPer100ml: z.object({ energyKcal: z.number().finite().min(0).max(2000).nullable(), proteinG: z.number().finite().min(0).max(200).nullable(), fatG: z.number().finite().min(0).max(200).nullable(), carbsG: z.number().finite().min(0).max(200).nullable() }).strict(),
}).strict();
export const portionSnapshotSchema = z.object({
  unit: z.enum(['个', '根', '块', '碗', '片', '勺', '杯', '份']),
  quantity: weightSchema.nullable(),
  amountPerUnit: weightSchema.positive().nullable(),
  basis: z.enum(['g', 'ml']),
  assumption: z.string().min(1).max(500),
}).strict();
export type PortionSnapshot = z.infer<typeof portionSnapshotSchema>;
export const foodEntrySchema = z.object({
  id: shortText,
  name: shortText,
  weightG: weightSchema.nullable(),
  nutrientsPer100g: nutrientsSchema,
  provenance: z.string().max(1000),
  kind: z.enum(['database', 'recipe', 'manual', 'unknown', 'ai', 'label']),
  packageSnapshot: packageSnapshotSchema.optional(),
  volumeSnapshot: volumeSnapshotSchema.optional(),
  portionSnapshot: portionSnapshotSchema.optional(),
  referenceId: shortText.optional(),
  recipeSnapshot: recipeSnapshotSchema.optional(),
  aiEstimateSnapshot: aiEstimateSnapshotSchema.optional(),
  estimateProfile: nutritionEstimateProfileSchema.optional(),
  estimateLevel: estimateLevelSchema.optional(),
  warnings: warningsSchema,
}).strict().superRefine((entry, context) => {
  if (entry.portionSnapshot) {
    const portion = entry.portionSnapshot;
    const expected = portion.quantity === null || portion.amountPerUnit === null ? null : Math.round((portion.quantity * portion.amountPerUnit + Number.EPSILON) * 100) / 100;
    const actual = portion.basis === 'ml' ? entry.volumeSnapshot?.amountMl ?? null : entry.weightG;
    if (entry.packageSnapshot || (portion.basis === 'ml') !== Boolean(entry.volumeSnapshot) || (expected === null) !== (actual === null) || (expected !== null && (expected > 20000 || Math.abs(expected - actual!) > 1e-7)))
      context.addIssue({ code: 'custom', message: '计量单位快照必须与实际重量或容量一致，不能混用包装份量', path: ['portionSnapshot'] });
  }
  if (entry.volumeSnapshot && (entry.weightG !== null || Object.values(entry.nutrientsPer100g).some(value => value !== null) || entry.packageSnapshot || entry.referenceId || entry.aiEstimateSnapshot || entry.recipeSnapshot || entry.estimateProfile || entry.estimateLevel || !['manual', 'unknown'].includes(entry.kind)))
    context.addIssue({ code: 'custom', message: '体积记录只能使用独立的每100mL数据，不能混入质量或其他快照' });
  if ((entry.kind === 'label') !== Boolean(entry.packageSnapshot)) context.addIssue({ code: 'custom', message: '包装记录必须对应独立的标签快照' });
  if (entry.packageSnapshot) {
    if (entry.estimateProfile || entry.aiEstimateSnapshot || entry.recipeSnapshot || entry.referenceId) context.addIssue({ code: 'custom', message: '包装标注不能与食物库或AI粗估重复累计' });
    const expected = packageNutrientsPer100g(entry.packageSnapshot.label), weight = packageWeight(entry.packageSnapshot);
    if ((weight === null) !== (entry.weightG === null) || (weight !== null && Math.abs(weight - entry.weightG!) > 1e-7)) context.addIssue({ code: 'custom', message: '包装可食重量与摄入份量不一致' });
    for (const key of schemaNutrientKeys) if ((expected[key] === null) !== (entry.nutrientsPer100g[key] === null) || (expected[key] !== null && Math.abs(expected[key]! - entry.nutrientsPer100g[key]!) > 1e-7)) context.addIssue({ code: 'custom', message: '包装营养快照与原标签不一致' });
  }
  if (entry.estimateLevel && !entry.estimateProfile) {
    context.addIssue({ code: 'custom', message: '估算档位必须对应完整三档资料', path: ['estimateLevel'] });
  }
  if (entry.estimateProfile) {
    if (entry.kind === 'manual') {
      context.addIssue({ code: 'custom', message: '手动确定营养数值必须撤销估算范围', path: ['estimateProfile'] });
    }
    for (const key of inconsistentMidpointKeys(entry.nutrientsPer100g, entry.estimateProfile, entry.estimateLevel ?? 'medium')) {
      context.addIssue({ code: 'custom', message: '记录营养须等于所选估算档位的中值；确定数请撤销范围', path: ['nutrientsPer100g', key] });
    }
    if (entry.aiEstimateSnapshot) {
      for (const key of inconsistentMidpointKeys(entry.aiEstimateSnapshot.nutrientsPer100g, entry.estimateProfile, entry.estimateLevel ?? 'medium')) {
        context.addIssue({ code: 'custom', message: 'AI 快照须与当前估算档位中值一致', path: ['aiEstimateSnapshot', 'nutrientsPer100g', key] });
      }
    }
  }
}).transform((entry) => entry.estimateProfile && !entry.estimateLevel ? { ...entry, estimateLevel: 'medium' as const } : entry);
export type FoodEntry = z.infer<typeof foodEntrySchema>;

export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealType = z.infer<typeof mealTypeSchema>;
export const mealRecordSchema = z.object({
  id: shortText,
  date: dateSchema,
  mealType: mealTypeSchema,
  items: z.array(foodEntrySchema).min(1).max(100),
  mode: z.enum(['live', 'mock', 'manual']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();
export type MealRecord = z.infer<typeof mealRecordSchema>;
// 仅保留经客户端重编码的 JPEG，拒绝远程 URL、SVG 和超过 1 MB 的单张图片。
export const mealPhotoDataSchema = z.string().max(23 + Math.ceil(1024 * 1024 / 3) * 4)
  .regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/)
  .refine(value => {
    const body = value.slice(23), padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
    return body.length % 4 === 0 && body.length * 3 / 4 - padding <= 1024 * 1024;
  }, '照片必须是不超过1 MB的JPEG');
export const mealPhotoSchema = z.object({
  id: shortText, mealId: shortText, position: z.number().int().min(0).max(2), dataUrl: mealPhotoDataSchema, createdAt: timestampSchema,
}).strict();
export type MealPhoto = z.infer<typeof mealPhotoSchema>;
export const weightRecordSchema = z.object({
  date: dateSchema,
  weightKg: z.number().finite().min(1).max(600),
  updatedAt: timestampSchema,
}).strict();
export type WeightRecord = z.infer<typeof weightRecordSchema>;
export const personalInfoSchema = z.object({
  sex: z.enum(['male', 'female']),
  age: z.number().int().min(18).max(100),
  heightCm: z.number().finite().min(100).max(250),
  startingWeightKg: z.number().finite().min(20).max(400),
  startingDate: dateSchema,
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active']),
  autoEstimateAllowed: z.boolean(),
}).strict();
export type PersonalInfo = z.infer<typeof personalInfoSchema>;
export const dailyGoalsSchema = z.object({
  calorieMode: z.enum(['auto', 'manual']),
  manualCaloriesKcal: z.number().finite().min(1000).max(6000).nullable(),
  purpose: z.enum(['maintain', 'lose', 'gain']),
  adjustmentKcal: z.number().finite().min(0).max(500),
  waterMl: z.number().finite().min(250).max(6000).nullable(),
  exerciseMinutes: z.number().finite().min(1).max(300).nullable(),
  cupMl: z.number().finite().min(50).max(1500),
}).strict().refine(value => value.calorieMode !== 'manual' || value.manualCaloriesKcal !== null, '手动热量预算不能为空');
export type DailyGoals = z.infer<typeof dailyGoalsSchema>;
export const settingsSchema = z.object({
  targetWeightKg: z.number().finite().min(1).max(600).nullable(),
  // 可选字段使旧设备原位升级，旧设置不会被强行补成个人资料。
  personalInfo: personalInfoSchema.nullable().optional(),
  dailyGoals: dailyGoalsSchema.optional(),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;

const twoDecimal = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
export const waterRecordSchema = z.object({
  id: shortText, date: dateSchema,
  amountMl: z.number().finite().min(1).max(3000).refine(twoDecimal, '饮水量最多两位小数'),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict();
export type WaterRecord = z.infer<typeof waterRecordSchema>;
export const exerciseRecordSchema = z.object({
  id: shortText, date: dateSchema, name: z.string().trim().min(1).max(80),
  minutes: z.number().finite().positive().max(600).nullable(),
  method: z.enum(['met', 'manual', 'repetitions']),
  manualScope: z.enum(['session', 'day']).optional(),
  deviceReading: z.literal('active').optional(),
  dayBudgetKcal: z.number().finite().min(0).max(20000).refine(twoDecimal).nullable().optional(),
  repetitionSnapshot: z.object({ count: z.number().int().min(1).max(2000), secondsPerRep: z.number().finite().min(1).max(10).refine(twoDecimal), formulaVersion: z.literal('repetitions-met-v1') }).strict().optional(),
  activityCode: z.string().nullable(), met: z.number().finite().min(1).max(30).nullable(),
  weightKg: z.number().finite().min(1).max(600).nullable(),
  activeKcal: z.number().finite().min(0).max(20000),
  grossKcal: z.number().finite().min(0).max(20000).nullable(),
  includeInBudget: z.boolean(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().superRefine((record, context) => {
  const daily = record.method === 'manual' && record.manualScope === 'day';
  if (daily && record.deviceReading !== 'active') context.addIssue({ code: 'custom', message: '全天汇总请确认手环标注为活动热量，不可使用含静息的总消耗' });
  if (!daily && (record.deviceReading !== undefined || record.dayBudgetKcal !== undefined)) context.addIssue({ code: 'custom', message: '单次运动不能混入全天设备读数' });
  if (daily && record.includeInBudget && record.dayBudgetKcal == null) context.addIssue({ code: 'custom', message: '请填写其中计入额外预算的热量，不确定可关闭计入' });
  if (daily && record.dayBudgetKcal != null && record.dayBudgetKcal > record.activeKcal) context.addIssue({ code: 'custom', message: '额外预算部分不能超过当天活动热量' });
  if (record.manualScope !== undefined && record.method !== 'manual') context.addIssue({ code: 'custom', message: '只有手动活动消耗可以选择全天汇总' });
  if (daily && record.minutes !== null) context.addIssue({ code: 'custom', message: '全天活动汇总不能冒充运动分钟数' });
  if (!daily && record.minutes === null) context.addIssue({ code: 'custom', message: '单次运动缺少时长' });
  if (record.method !== 'repetitions' && (record.repetitionSnapshot || (!daily && record.minutes !== null && (record.minutes < 1 || !twoDecimal(record.minutes)))))
    context.addIssue({ code: 'custom', message: '按时长运动须为1–600分钟，不能混入按次数估算资料' });
  if (record.method === 'manual') {
    if (record.met !== null || record.activityCode !== null || record.grossKcal !== null || record.weightKg !== null || !twoDecimal(record.activeKcal))
      context.addIssue({ code: 'custom', message: '设备活动消耗与 MET 估算不能混用' });
    return;
  }
  const activity = exerciseActivities.find(value => value.code === record.activityCode);
  if (!activity || record.met !== activity.met || record.weightKg === null || record.grossKcal === null || record.minutes === null) {
    context.addIssue({ code: 'custom', message: '运动估算缺少有效强度或体重快照' }); return;
  }
  if ((activity.unit === 'repetitions') !== (record.method === 'repetitions'))
    context.addIssue({ code: 'custom', message: '运动项目与计量方式不一致' });
  if (record.method === 'repetitions') {
    const snapshot = record.repetitionSnapshot;
    if (!snapshot || Math.abs(record.minutes - snapshot.count * snapshot.secondsPerRep / 60) > 1e-7)
      context.addIssue({ code: 'custom', message: '俯卧撑次数、节奏和估计时长不一致' });
  }
  const base = record.weightKg * record.minutes / 60;
  if (Math.abs(record.grossKcal - record.met! * base) > 1e-7 || Math.abs(record.activeKcal - Math.max(0, record.met! - 1) * base) > 1e-7)
    context.addIssue({ code: 'custom', message: '运动热量与当时的强度、体重及时间不一致' });
});
export type ExerciseRecord = z.infer<typeof exerciseRecordSchema>;
/** 保存当日目标和计算资料，未来修改个人信息不改写已经记录的历史日。 */
export const dailyPlanSchema = z.object({
  date: dateSchema, formulaVersion: z.literal('mifflin-1990-v1'),
  settingsSnapshot: settingsSchema, weightKg: z.number().finite().min(1).max(600).nullable(),
  weightDate: dateSchema.nullable(), createdAt: timestampSchema, updatedAt: timestampSchema,
}).strict().refine(plan => (plan.weightKg === null) === (plan.weightDate === null) && (plan.weightDate === null || plan.weightDate <= plan.date), '日期目标不能引用未来体重，体重与日期须一起保存');
export type DailyPlan = z.infer<typeof dailyPlanSchema>;

export const recognitionResultSchema = z.object({
  isFood: z.boolean(),
  foods: z.array(z.object({
    name: shortText,
    estimatedWeightG: weightSchema.nullable(),
    visibleIngredients: z.array(shortText).max(30),
    uncertainties: warningsSchema,
    estimatedNutrientsPer100g: nutrientsSchema.nullable().optional().default(null),
    nutritionAssumptions: warningsSchema.optional().default([]),
    nutritionEstimateProfile: nutritionEstimateProfileSchema.nullable().optional().default(null),
    packageLabel: packageLabelSchema.nullable().optional(),
  }).strict()).max(30),
  uncertainties: warningsSchema,
}).strict().refine((result) => result.isFood || result.foods.length === 0, {
  message: '非食物识别结果不能包含食物',
});
export type RecognitionResult = z.infer<typeof recognitionResultSchema>;
export const recognitionResponseSchema = z.object({
  result: recognitionResultSchema,
  mode: z.enum(['live', 'mock']),
  provider: providerSchema,
  model: shortText,
}).strict();
export type RecognitionResponse = z.infer<typeof recognitionResponseSchema>;
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  mode: z.enum(['live', 'mock']),
  provider: providerSchema,
  model: shortText,
  authRequired: z.boolean().optional(),
}).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** 个人食品库保存完整快照，收藏库内食物也保留副本，避免库更新后丢失。 */
export const libraryFoodSchema = z.object({
  id: shortText,
  choiceId: shortText,
  origin: z.enum(['ai', 'manual', 'library']),
  entry: foodEntrySchema,
  favorite: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict().superRefine((food, context) => {
  if (food.entry.aiEstimateSnapshot?.provider === 'mock' || food.entry.packageSnapshot?.provider === 'mock')
    context.addIssue({ code: 'custom', message: '模拟数据不能保存为个人食品', path: ['entry'] });
  if (food.origin !== 'library' && food.choiceId !== `saved:${food.id}`)
    context.addIssue({ code: 'custom', message: '个人食品选择标识无效', path: ['choiceId'] });
});
export type LibraryFood = z.infer<typeof libraryFoodSchema>;

const backupV1Schema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: timestampSchema,
  meals: z.array(mealRecordSchema).max(100000),
  weights: z.array(weightRecordSchema).max(100000),
  settings: settingsSchema,
}).strict();
const backupV2Schema = backupV1Schema.extend({
  schemaVersion: z.literal(2),
  estimatedFoods: z.array(estimatedFoodSchema).max(100000),
}).strict();
const backupV3Schema = backupV2Schema.extend({
  schemaVersion: z.literal(3),
  water: z.array(waterRecordSchema).max(100000),
  exercises: z.array(exerciseRecordSchema).max(100000),
  dailyPlans: z.array(dailyPlanSchema).max(100000),
}).strict();
const backupV4Schema = backupV3Schema.extend({ schemaVersion: z.literal(4) }).strict();
const backupV5Schema = backupV4Schema.extend({ schemaVersion: z.literal(5), packagedFoods: z.array(packagedFoodSchema).max(100000) }).strict();
const backupV6Schema = backupV5Schema.extend({ schemaVersion: z.literal(6) }).strict();
const backupV7Schema = backupV6Schema.extend({ schemaVersion: z.literal(7) }).strict();
const backupV8Schema = backupV7Schema.extend({ schemaVersion: z.literal(8) }).strict();
const backupV9Schema = backupV8Schema.extend({ schemaVersion: z.literal(9) }).strict();
const backupV10Schema = backupV9Schema.extend({ schemaVersion: z.literal(10), libraryFoods: z.array(libraryFoodSchema).max(100000) }).strict();
const backupV11Schema = backupV10Schema.extend({ schemaVersion: z.literal(11), mealPhotos: z.array(mealPhotoSchema).max(300000) }).strict();

// v4包装标签；v5包装库；v6饮品mL；v7次数运动；v8全天活动；v9日常单位；v10个人食品与收藏；v11餐次照片。
// 导入是一次完整恢复，重复主键或规范化名称不能通过 put 静默覆盖。
export const backupSchema = z.discriminatedUnion('schemaVersion', [backupV1Schema, backupV2Schema, backupV3Schema, backupV4Schema, backupV5Schema, backupV6Schema, backupV7Schema, backupV8Schema, backupV9Schema, backupV10Schema, backupV11Schema])
  .transform(backup => ({
    ...backup, schemaVersion: 11 as const,
    mealPhotos: 'mealPhotos' in backup ? backup.mealPhotos : [] as MealPhoto[],
    libraryFoods: 'libraryFoods' in backup ? backup.libraryFoods : [] as LibraryFood[],
    packagedFoods: 'packagedFoods' in backup ? backup.packagedFoods : [] as PackagedFood[],
    estimatedFoods: 'estimatedFoods' in backup ? backup.estimatedFoods : [] as EstimatedFood[],
    water: 'water' in backup ? backup.water : [] as WaterRecord[],
    exercises: 'exercises' in backup ? backup.exercises : [] as ExerciseRecord[],
    dailyPlans: 'dailyPlans' in backup ? backup.dailyPlans : [] as DailyPlan[],
  }))
  .superRefine((backup, context) => {
  const mealIds = new Set(backup.meals.map(meal => meal.id)), photoCounts = new Map<string, number>();
  if (new Set(backup.mealPhotos.map(photo => photo.id)).size !== backup.mealPhotos.length)
    context.addIssue({ code: 'custom', message: '照片包含重复ID', path: ['mealPhotos'] });
  if (new Set(backup.mealPhotos.map(photo => JSON.stringify([photo.mealId, photo.position]))).size !== backup.mealPhotos.length)
    context.addIssue({ code: 'custom', message: '同一餐次的照片序号不能重复', path: ['mealPhotos'] });
  for (const photo of backup.mealPhotos) {
    const count = (photoCounts.get(photo.mealId) ?? 0) + 1; photoCounts.set(photo.mealId, count);
    if (!mealIds.has(photo.mealId) || count > 3)
      context.addIssue({ code: 'custom', message: '照片需对应已有餐次，每餐最多3张', path: ['mealPhotos'] });
  }
  if (new Set(backup.libraryFoods.map(food => food.id)).size !== backup.libraryFoods.length || new Set(backup.libraryFoods.map(food => food.choiceId)).size !== backup.libraryFoods.length)
    context.addIssue({ code: 'custom', message: '食品库包含重复ID或选择标识', path: ['libraryFoods'] });
  const dailyActivityDates = backup.exercises.filter(record => record.method === 'manual' && record.manualScope === 'day').map(record => record.date);
  if (new Set(dailyActivityDates).size !== dailyActivityDates.length) context.addIssue({ code: 'custom', message: '同一天只能保留一条活动累计汇总', path: ['exercises'] });
  if (new Set(backup.packagedFoods.map(food => food.id)).size !== backup.packagedFoods.length || new Set(backup.packagedFoods.flatMap(food => food.barcode ? [food.barcode] : [])).size !== backup.packagedFoods.filter(food => food.barcode).length)
    context.addIssue({ code: 'custom', message: '包装库包含重复ID或条码', path: ['packagedFoods'] });
  if (new Set(backup.meals.map((meal) => meal.id)).size !== backup.meals.length) {
    context.addIssue({ code: 'custom', message: '备份包含重复饮食记录 ID', path: ['meals'] });
  }
  if (new Set(backup.weights.map((weight) => weight.date)).size !== backup.weights.length) {
    context.addIssue({ code: 'custom', message: '备份包含重复体重日期', path: ['weights'] });
  }
  if (new Set(backup.estimatedFoods.map((food) => food.id)).size !== backup.estimatedFoods.length) {
    context.addIssue({ code: 'custom', message: '备份包含重复个人估算食物 ID', path: ['estimatedFoods'] });
  }
  if (new Set(backup.estimatedFoods.map((food) => normalizeFoodName(food.name))).size !== backup.estimatedFoods.length) {
    context.addIssue({ code: 'custom', message: '备份包含重复个人估算食物名称', path: ['estimatedFoods'] });
  }
  for (const [key, records] of [['water', backup.water], ['exercises', backup.exercises]] as const) {
    if (new Set(records.map(record => record.id)).size !== records.length) context.addIssue({ code: 'custom', message: '备份包含重复记录 ID', path: [key] });
  }
  if (new Set(backup.dailyPlans.map(plan => plan.date)).size !== backup.dailyPlans.length)
    context.addIssue({ code: 'custom', message: '备份包含重复日期目标', path: ['dailyPlans'] });
});
export type Backup = z.infer<typeof backupSchema>;
