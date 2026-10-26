import { parseRecognition as parse, validateRecognition as validate, geminiOutputText as gemini, chatCompletionOutputText as chat, glmOutputText as glm, VisionValidationError, type RecognitionValidationOptions } from '@shike/shared';
import { ApiError } from '../errors.js';
export type { RecognitionValidationOptions } from '@shike/shared';
// 服务端保留 ApiError，由统一错误处理器转换 HTTP 状态。
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
