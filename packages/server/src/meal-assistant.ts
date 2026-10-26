import { assistantBody, mockAssistant, compatibleVisionEndpoint, geminiOutputText, chatCompletionOutputText, glmOutputText, parseAssistantDraft, type AssistantRequest, type AssistantResponse } from '@shike/shared';
import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';
import { postJson } from './vision/http.js';
export async function describeMeal(config: ServerConfig, input: AssistantRequest, fetchImpl: typeof fetch = fetch): Promise<AssistantResponse> {
  if (config.aiMode === 'mock' || !config.apiKey) return { mode: 'mock', provider: 'mock', model: 'mock-demo-v1', draft: mockAssistant(input) };
  const gemini = config.provider === 'gemini';
  const data = await postJson(gemini ? 'https://generativelanguage.googleapis.com/v1beta/interactions' : compatibleVisionEndpoint(config.provider, config.model), assistantBody(config.provider, config.model, input), gemini ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }, config.timeoutMs, fetchImpl);
  try { return { mode: 'live', provider: config.provider, model: config.model, draft: parseAssistantDraft(gemini ? geminiOutputText(data) : config.provider === 'glm' ? glmOutputText(data, config.model) : chatCompletionOutputText(data, true)) }; }
  catch { throw new ApiError('AI_INVALID_RESULT', '助手返回的草稿格式不完整，请重试；当前草稿已保留。', 502); }
}
