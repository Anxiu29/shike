import { assistantBody, mockAssistant, compatibleVisionEndpoint, geminiOutputText, chatCompletionOutputText, glmOutputText, parseAssistantDraft, type AssistantRequest, type AssistantResponse } from '@shike/shared';
import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';
import { postJson } from './vision/http.js';
import { sanitizeImage } from './image.js';
/**
 * 文字/图片助手的业务流程：清洗本轮及历史图片→预留额度→选协议→解析结构化草稿。
 * input已由app.ts的共享schema约束文本长度、轮数和图片数量；本函数负责真实图片验证。
 * 返回的是需要用户确认的AssistantResponse草稿，不直接写入浏览器餐食或数据库。
 * beforeRequest让路由层掌握配额策略，业务函数只保证它发生在验证后、模型调用前。
 */
export async function describeMeal(config: ServerConfig, input: AssistantRequest, fetchImpl: typeof fetch = fetch, beforeRequest?: () => Promise<void>): Promise<AssistantResponse> {
  // base64只是传输编码，不能证明这是图片。解码后再次限字节、检查MIME并去EXIF/GPS。
  const clean = async (encoded: string) => {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 1_048_576) throw new ApiError('IMAGE_TOO_LARGE', '助手图片不能超过1 MB。', 413);
    return (await sanitizeImage(bytes, 'image/jpeg')).data.toString('base64');
  };
  // 即使绕过页面直接请求，也不把伪造图片、EXIF或GPS传给模型；不写入磁盘。
  const imageBase64 = input.imageBase64 ? await clean(input.imageBase64) : undefined;
  const history: NonNullable<AssistantRequest['history']> = [];
  // 顺序处理最多三张图片：任一失败时，不会提前释放槽位却留下其它解码任务。
  for (const turn of input.history ?? []) history.push({ ...turn, ...(turn.imageBase64 ? { imageBase64: await clean(turn.imageBase64) } : {}) });
  input = { ...input, ...(imageBase64 ? { imageBase64 } : {}), ...(input.history ? { history } : {}) };
  // 全部图片验证成功后再预留调用额度，损坏图片不应耗尽用户当天的可用次数。
  await beforeRequest?.();
  // Mock也验证图片并明确标识，避免演示模式掩盖上传边界问题；真实失败不回退到Mock。
  if (config.aiMode === 'mock' || !config.apiKey) return { mode: 'mock', provider: 'mock', model: 'mock-demo-v1', draft: mockAssistant(input) };
  const gemini = config.provider === 'gemini';
  const data = await postJson(gemini ? 'https://generativelanguage.googleapis.com/v1beta/interactions' : compatibleVisionEndpoint(config.provider, config.model), assistantBody(config.provider, config.model, input), gemini ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }, config.timeoutMs, fetchImpl);
  // 供应商封装层与业务草稿是两次解析：先提取生成文本，再验证日期、食物及份量字段。
  // 不能仅凭HTTP200或“能JSON.parse”就允许不完整数据进入编辑器。
  try { return { mode: 'live', provider: config.provider, model: config.model, draft: parseAssistantDraft(gemini ? geminiOutputText(data) : config.provider === 'glm' ? glmOutputText(data, config.model) : chatCompletionOutputText(data, true)) }; }
  catch { throw new ApiError('AI_INVALID_RESULT', '助手返回的草稿格式不完整，请重试；当前草稿已保留。', 502); }
}
