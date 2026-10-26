import { recognitionResultSchema, type NumericRange, type RecognitionResult } from './schemas.js';
// 安全错误不包含原始模型响应或密钥。
export class VisionValidationError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 502) { super(message); this.name = 'VisionValidationError'; }
}

export interface RecognitionValidationOptions { requireProfile?: boolean; discardInvalidNutrition?: boolean; }

export function parseRecognition(text: string, options: RecognitionValidationOptions = {}): RecognitionResult {
  // 只接受完整 JSON 或完整外围围栏；不截取片段、不修复字段、不用 eval。
  const cleaned = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let data: unknown;
  try { data = JSON.parse(cleaned); }
  catch { throw new VisionValidationError('AI_INVALID_JSON', '模型没有返回有效 JSON，请重新识别或手动记录。', 502); }
  return validateRecognition(data, options);
}

/** 营养粗估必须带假设；兼容旧结果省略粗估，但不能接受无依据的新增数值。 */
export function validateRecognition(data: unknown, options: RecognitionValidationOptions = {}): RecognitionResult {
  if (!options.discardInvalidNutrition) return validateStrictRecognition(data, options);
  try { return validateStrictRecognition(data, options); }
  catch (error) {
    if (!(error instanceof VisionValidationError) || error.code !== 'AI_INVALID_RESULT' || !isRecord(data) || !Array.isArray(data.foods)) throw error;
    // GLM 的可选营养估算失败时，只舍弃这组估算；核心字段和包装标签仍按原标准校验。
    const foods = data.foods.map(food => {
      if (!isRecord(food) || food.packageLabel != null) return food;
      try { validateStrictRecognition({ isFood: true, foods: [food], uncertainties: [] }, options); return food; }
      catch {
        const candidate = { ...food, estimatedNutrientsPer100g: null, nutritionEstimateProfile: null, nutritionAssumptions: [] };
        let checked: RecognitionResult;
        try { checked = validateStrictRecognition({ isFood: true, foods: [candidate], uncertainties: [] }, options); }
        catch { throw error; }
        const warnings = checked.foods[0]!.uncertainties;
        if (warnings.length >= 30) throw error; // 不通过丢弃原有警告来腾位置。
        return { ...candidate, uncertainties: [...warnings, '模型营养估算格式不完整，已舍弃该项AI营养数值；请从食物库选择或手动补充。'] };
      }
    });
    return validateStrictRecognition({ ...data, foods }, options);
  }
}

function validateStrictRecognition(data: unknown, options: RecognitionValidationOptions): RecognitionResult {
  const result = recognitionResultSchema.safeParse(data);
  if (!result.success || (!result.data.isFood && result.data.foods.length > 0)) {
    const path = result.success ? [] : result.error.issues[0]?.path ?? [];
    const fields: Record<string, string> = { isFood: '食物判断', foods: '食物列表', name: '名称', estimatedWeightG: '重量', visibleIngredients: '可见配料', uncertainties: '不确定性说明', estimatedNutrientsPer100g: '营养数值', nutritionAssumptions: '营养假设', nutritionEstimateProfile: '三档营养范围', packageLabel: '包装标签' };
    const field = fields[String(path[2] ?? path[0])] ?? '字段';
    const location = path[0] === 'foods' && typeof path[1] === 'number' ? `第${path[1] + 1}项食物的${field}` : field;
    throw new VisionValidationError('AI_INVALID_RESULT', `模型结果结构不符合要求（${location}），请重新识别或手动记录。`, 502);
  }
  if (result.data.foods.length > 10) throw new VisionValidationError('AI_INVALID_RESULT', '一次最多识别 10 项食物，请把照片中的食物分次识别。', 502);
  for (const food of result.data.foods) {
    if (food.packageLabel) {
      if (food.nutritionEstimateProfile || (food.estimatedNutrientsPer100g && Object.values(food.estimatedNutrientsPer100g).some(value => value !== null)))
        throw new VisionValidationError('AI_INVALID_RESULT', '包装标注与AI粗估不能混用，请重拍清晰营养表或手动补充。');
      // 包装净含量不是摄入量：即便模型填了重量，也交由用户明确选择份量。
      food.estimatedWeightG = null;
      food.estimatedNutrientsPer100g = null; food.nutritionAssumptions = [];
      continue;
    }
    const profile = food.nutritionEstimateProfile;
    if (!profile) {
      if (options.requireProfile && food.estimatedNutrientsPer100g?.energyKcal != null) {
        throw new VisionValidationError('AI_INVALID_RESULT', '模型给出了热量粗估但没有三档范围，请重新识别或手动补充。', 502);
      }
      continue; // 旧响应兼容；新的真实请求必须为可估热量给出范围。
    }
    if (profile.options.some((option) => !option.assumptions.some((assumption) => assumption.trim().length > 0))) {
      throw new VisionValidationError('AI_INVALID_RESULT', '模型营养范围缺少各档具体假设，请重新识别或手动补充。', 502);
    }
    const medium = profile.options.find((option) => option.level === 'medium');
    if (!medium) throw new VisionValidationError('AI_INVALID_RESULT', '模型营养范围缺少默认中档，请重新识别。', 502);
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
    throw new VisionValidationError('AI_INVALID_RESULT', '模型营养粗估缺少具体假设，请重新识别或手动补充。', 502);
  }
  return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

export function geminiOutputText(data: unknown): string {
  if (!isRecord(data)) return '';
  // 语法完整不代表生成完成；失败或被截断的单轮响应不能作为成功结果保存。
  if (Object.prototype.hasOwnProperty.call(data, 'status') && data.status !== 'completed') {
    throw new VisionValidationError('AI_INVALID_RESULT', '模型没有完整完成识别，请重新识别或手动记录。', 502);
  }
  if (typeof data.output_text === 'string') return data.output_text;
  // REST 返回 steps，SDK 便利属性 output_text 未必出现在 REST 响应里。
  if (!Array.isArray(data.steps)) return '';
  return data.steps.filter((step) => isRecord(step) && step.type === 'model_output')
    .flatMap((step) => isRecord(step) && Array.isArray(step.content) ? step.content : [])
    .filter((content) => isRecord(content) && content.type === 'text' && typeof content.text === 'string')
    .map((content) => isRecord(content) ? content.text : '').join('');
}

/** GLM 与百炼的兼容接口共用 choices 格式，不读取 reasoning_content。 */
export function chatCompletionOutputText(data: unknown, requireFinishReason = false): string {
  if (!isRecord(data) || !Array.isArray(data.choices)) return '';
  const first: unknown = data.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return '';
  if ((requireFinishReason || Object.prototype.hasOwnProperty.call(first, 'finish_reason')) && first.finish_reason !== 'stop') {
    throw new VisionValidationError('AI_INVALID_RESULT', '模型输出被截断或未正常结束，请重新识别或手动记录。', 502);
  }
  return typeof first.message.content === 'string' ? first.message.content : '';
}

/** 4.1V实测将思考与最终答案放在完整标签中；只接受确切外围，不捞取任意JSON片段。 */
export function glmOutputText(data: unknown, model: string): string {
  return glmFinalAnswer(chatCompletionOutputText(data, true), model);
}
export function glmFinalAnswer(text: string, model: string): string {
  if (model !== 'glm-4.1v-thinking-flash') return text;
  let value = text.trim();
  const invalid = () => { throw new VisionValidationError('AI_INVALID_RESULT', '模型思考或答案未完整结束，请重新识别或手动记录。', 502) };
  const hasTags = (part: string) => ['<think>', '</think>', '<answer>', '</answer>'].some(tag => part.includes(tag));
  if (value.startsWith('<think>')) {
    const end = value.indexOf('</think>'); if (end < 0 || hasTags(value.slice(7, end))) invalid();
    value = value.slice(end + 8).trim();
    if (!value.startsWith('<answer>')) invalid();
  }
  if (value.startsWith('<answer>')) {
    if (!value.endsWith('</answer>')) invalid();
    value = value.slice(8, -9).trim(); if (hasTags(value)) invalid();
  }
  // 4.1V还会把最终JSON放入官方box特殊标记中，只移除完整、唯一的外围。
  const begin = '<|begin_of_box|>', end = '<|end_of_box|>';
  if (value.startsWith(begin)) {
    if (!value.endsWith(end)) invalid();
    value = value.slice(begin.length, -end.length).trim();
    if (value.includes(begin) || value.includes(end)) invalid();
  }
  return value;
}
