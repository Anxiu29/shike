import { parseRecognition as parse, validateRecognition as validate, geminiOutputText as gemini, chatCompletionOutputText as chat, glmOutputText as glm, VisionValidationError, type RecognitionValidationOptions } from '@shike/shared';
import { ApiError } from '../errors.js';
export type { RecognitionValidationOptions } from '@shike/shared';
// shared承担平台无关的格式/营养约束，Node层只把它的验证错误映射成HTTP可公开的ApiError。
// 不把所有未知异常都转成“格式不对”，这样内部缺陷仍会由app.ts隐藏成统一500。
function mapped<T>(fn: () => T): T {
  try { return fn(); } catch (error) {
    if (error instanceof VisionValidationError) throw new ApiError(error.code, error.message, error.statusCode);
    throw error;
  }
}
export function parseRecognition(text: string, options: RecognitionValidationOptions = {}) { return mapped(() => parse(text, options)); }
export function validateRecognition(data: unknown, options: RecognitionValidationOptions = {}) { return mapped(() => validate(data, options)); }
export function geminiOutputText(data: unknown) { return mapped(() => gemini(data)); }
export function chatCompletionOutputText(data: unknown, requireFinishReason = false) { return mapped(() => chat(data, requireFinishReason)); }
export function glmOutputText(data: unknown, model: string) { return mapped(() => glm(data, model)); }
