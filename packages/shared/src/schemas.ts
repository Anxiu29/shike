import { z } from 'zod';

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
const providerSchema = z.enum(['gemini', 'glm', 'mock']);

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

export const foodEntrySchema = z.object({
  id: shortText,
  name: shortText,
  weightG: weightSchema.nullable(),
  nutrientsPer100g: nutrientsSchema,
  provenance: z.string().max(1000),
  kind: z.enum(['database', 'recipe', 'manual', 'unknown', 'ai']),
  referenceId: shortText.optional(),
  recipeSnapshot: recipeSnapshotSchema.optional(),
  aiEstimateSnapshot: aiEstimateSnapshotSchema.optional(),
  estimateProfile: nutritionEstimateProfileSchema.optional(),
  estimateLevel: estimateLevelSchema.optional(),
  warnings: warningsSchema,
}).strict().superRefine((entry, context) => {
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
export const weightRecordSchema = z.object({
  date: dateSchema,
  weightKg: z.number().finite().min(1).max(600),
  updatedAt: timestampSchema,
}).strict();
export type WeightRecord = z.infer<typeof weightRecordSchema>;
export const settingsSchema = z.object({
  targetWeightKg: z.number().finite().min(1).max(600).nullable(),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;

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
}).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

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

// 旧备份升级为 v2；对外 Backup 类型统一，不要求用户先手动转换文件。
// 导入是一次完整恢复，重复主键或规范化名称不能通过 put 静默覆盖。
export const backupSchema = z.discriminatedUnion('schemaVersion', [backupV1Schema, backupV2Schema])
  .transform((backup) => backup.schemaVersion === 1
    ? { ...backup, schemaVersion: 2 as const, estimatedFoods: [] as EstimatedFood[] }
    : backup)
  .superRefine((backup, context) => {
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
});
export type Backup = z.infer<typeof backupSchema>;
