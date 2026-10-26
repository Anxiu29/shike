import { assistantBody, mockAssistant, compatibleVisionEndpoint, geminiOutputText, chatCompletionOutputText, glmOutputText, parseAssistantDraft, type AssistantRequest, type AssistantResponse } from '@shike/shared';
import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';
import { postJson } from './vision/http.js';
import { sanitizeImage } from './image.js';
export async function describeMeal(config: ServerConfig, input: AssistantRequest, fetchImpl: typeof fetch = fetch): Promise<AssistantResponse> {
  const clean = async (encoded: string) => {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 1_048_576) throw new ApiError('IMAGE_TOO_LARGE', '助手图片不能超过1 MB。', 413);
    return (await sanitizeImage(bytes, 'image/jpeg')).data.toString('base64');
  };
  // 即使绕过页面直接请求，也不把伪造图片、EXIF或GPS传给模型；不写入磁盘。
  input = { ...input, ...(input.imageBase64 ? { imageBase64: await clean(input.imageBase64) } : {}),
    ...(input.history ? { history: await Promise.all(input.history.map(async turn => ({ ...turn, ...(turn.imageBase64 ? { imageBase64: await clean(turn.imageBase64) } : {}) }))) } : {}) };
  if (config.aiMode === 'mock' || !config.apiKey) return { mode: 'mock', provider: 'mock', model: 'mock-demo-v1', draft: mockAssistant(input) };
  const gemini = config.provider === 'gemini';
  const data = await postJson(gemini ? 'https://generativelanguage.googleapis.com/v1beta/interactions' : compatibleVisionEndpoint(config.provider, config.model), assistantBody(config.provider, config.model, input), gemini ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }, config.timeoutMs, fetchImpl);
  try { return { mode: 'live', provider: config.provider, model: config.model, draft: parseAssistantDraft(gemini ? geminiOutputText(data) : config.provider === 'glm' ? glmOutputText(data, config.model) : chatCompletionOutputText(data, true)) }; }
  catch { throw new ApiError('AI_INVALID_RESULT', '助手返回的草稿格式不完整，请重试；当前草稿已保留。', 502); }
}
