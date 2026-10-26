import type { RecognitionResult } from '@shike/shared';
import type { QwenModel } from '../config.js';
import { postJson } from './http.js';
import { chatCompletionOutputText, parseRecognition } from './parse.js';
import { FOOD_PROMPT, FOOD_REQUEST } from './prompt.js';
import type { FetchLike, VisionImage, VisionService } from './types.js';

/** 北京区通用 API：Key 只进 HTTPS 请求头，不放 URL、页面或返回结果。 */
export class QwenVisionService implements VisionService {
  readonly mode = 'live' as const;
  readonly provider = 'qwen' as const;
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 45000,
    private readonly fetchImpl: FetchLike = fetch,
    readonly model: QwenModel = 'qwen3.7-flash',
  ) {}

  async recognize(image: VisionImage): Promise<RecognitionResult> {
    const data = await postJson('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      model: this.model,
      // 识别不需要长思考、工具或聊天历史，限制输出以控制延迟和用量。
      enable_thinking: false,
      max_tokens: 8192,
      // 官方说明：视觉输入的 json_schema 会降级，所以明确使用 JSON Object，
      // 完整结构和三档营养范围仍由本地 Zod 检查，不能只信“有效 JSON”。
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: FOOD_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: FOOD_REQUEST },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data.toString('base64')}` } },
        ] },
      ],
    }, { Authorization: `Bearer ${this.apiKey}` }, this.timeoutMs, this.fetchImpl);
    return parseRecognition(chatCompletionOutputText(data, true), { requireProfile: true });
  }
}
