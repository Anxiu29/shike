import { compatibleVisionEndpoint, compatibleVisionOptions, compatibleVisionResponseFormat, type RecognitionResult } from '@shike/shared';
import { postJson } from './http.js';
import { chatCompletionOutputText, parseRecognition } from './parse.js';
import { FOOD_PROMPT, FOOD_REQUEST, recognitionJsonSchema } from './prompt.js';
import type { FetchLike, VisionImage, VisionService } from './types.js';

/** 本机H5适配器；Key只进入固定平台的HTTPS请求头，输出仍执行完整结构校验。 */
export class CompatibleVisionService implements VisionService {
  readonly mode = 'live' as const;
  constructor(readonly provider: 'siliconflow' | 'openrouter' | 'deepseek', readonly model: string, private readonly apiKey: string, private readonly timeoutMs = 45000, private readonly fetchImpl: FetchLike = fetch) {
    compatibleVisionEndpoint(provider, model);
  }
  async recognize(image: VisionImage): Promise<RecognitionResult> {
    const data = await postJson(compatibleVisionEndpoint(this.provider, this.model), {
      model: this.model, ...compatibleVisionOptions(this.provider), max_tokens: 8192,
      response_format: compatibleVisionResponseFormat(this.provider, this.model, recognitionJsonSchema),
      messages: [{ role: 'system', content: FOOD_PROMPT }, { role: 'user', content: [
        { type: 'text', text: FOOD_REQUEST }, { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data.toString('base64')}`, detail: 'high' } },
      ] }],
    }, { Authorization: `Bearer ${this.apiKey}` }, this.timeoutMs, this.fetchImpl);
    return parseRecognition(chatCompletionOutputText(data, true), { requireProfile: true });
  }
}
