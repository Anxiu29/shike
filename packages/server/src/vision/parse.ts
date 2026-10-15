import { recognitionResultSchema, type NumericRange, type RecognitionResult } from '@shike/shared';
import { ApiError } from '../errors.js';

export interface RecognitionValidationOptions { requireProfile?: boolean; }

export function parseRecognition(text: string, options: RecognitionValidationOptions = {}): RecognitionResult {
  // 只接受完整 JSON 或完整外围围栏；不截取片段、不修复字段、不用 eval。
  const cleaned = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let data: unknown;
  try { data = JSON.parse(cleaned); }
  catch { throw new ApiError('AI_INVALID_JSON', '模型没有返回有效 JSON，请重新识别或手动记录。', 502); }
  return validateRecognition(data, options);
}

/** 营养粗估必须带假设；兼容旧结果省略粗估，但不能接受无依据的新增数值。 */
export function validateRecognition(data: unknown, options: RecognitionValidationOptions = {}): RecognitionResult {
  const result = recognitionResultSchema.safeParse(data);
  if (!result.success || (!result.data.isFood && result.data.foods.length > 0)) {
    throw new ApiError('AI_INVALID_RESULT', '模型结果结构不符合要求，请重新识别或手动记录。', 502);
  }
  if (result.data.foods.length > 10) throw new ApiError('AI_INVALID_RESULT', '一次最多识别 10 项食物，请把照片中的食物分次识别。', 502);
  for (const food of result.data.foods) {
    const profile = food.nutritionEstimateProfile;
    if (!profile) {
      if (options.requireProfile && food.estimatedNutrientsPer100g?.energyKcal != null) {
        throw new ApiError('AI_INVALID_RESULT', '模型给出了热量粗估但没有三档范围，请重新识别或手动补充。', 502);
      }
      continue; // 旧响应兼容；新的真实请求必须为可估热量给出范围。
    }
    if (profile.options.some((option) => !option.assumptions.some((assumption) => assumption.trim().length > 0))) {
      throw new ApiError('AI_INVALID_RESULT', '模型营养范围缺少各档具体假设，请重新识别或手动补充。', 502);
    }
    const medium = profile.options.find((option) => option.level === 'medium');
    if (!medium) throw new ApiError('AI_INVALID_RESULT', '模型营养范围缺少默认中档，请重新识别。', 502);
    const midpoint = (range: NumericRange | null) => range ? (range.min + range.max) / 2 : null;
    // 中值统一由代码计算，防止模型把整份热量或自行算错的单值当作默认营养。
    food.estimatedNutrientsPer100g = {
      energyKcal: midpoint(medium.rangesPer100g.energyKcal), proteinG: midpoint(medium.rangesPer100g.proteinG),
      fatG: midpoint(medium.rangesPer100g.fatG), carbsG: midpoint(medium.rangesPer100g.carbsG),
    };
    food.nutritionAssumptions = [...medium.assumptions];
  }
  if (result.data.foods.some((food) => food.estimatedNutrientsPer100g
    && Object.values(food.estimatedNutrientsPer100g).some((value) => value !== null)
    && !food.nutritionAssumptions.some((assumption) => assumption.trim().length > 0))) {
    throw new ApiError('AI_INVALID_RESULT', '模型营养粗估缺少具体假设，请重新识别或手动补充。', 502);
  }
  return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

export function geminiOutputText(data: unknown): string {
  if (!isRecord(data)) return '';
  // 语法完整不代表生成完成；失败或被截断的单轮响应不能作为成功结果保存。
  if (Object.prototype.hasOwnProperty.call(data, 'status') && data.status !== 'completed') {
    throw new ApiError('AI_INVALID_RESULT', '模型没有完整完成识别，请重新识别或手动记录。', 502);
  }
  if (typeof data.output_text === 'string') return data.output_text;
  // REST 返回 steps，SDK 便利属性 output_text 未必出现在 REST 响应里。
  if (!Array.isArray(data.steps)) return '';
  return data.steps.filter((step) => isRecord(step) && step.type === 'model_output')
    .flatMap((step) => isRecord(step) && Array.isArray(step.content) ? step.content : [])
    .filter((content) => isRecord(content) && content.type === 'text' && typeof content.text === 'string')
    .map((content) => isRecord(content) ? content.text : '').join('');
}

export function glmOutputText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.choices)) return '';
  const first: unknown = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return '';
  if (Object.prototype.hasOwnProperty.call(first, 'finish_reason') && first.finish_reason !== 'stop') {
    throw new ApiError('AI_INVALID_RESULT', '模型输出被截断或未正常结束，请重新识别或手动记录。', 502);
  }
  return typeof first.message.content === 'string' ? first.message.content : '';
}
