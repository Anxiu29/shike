import type { RecognitionResult } from '@shike/shared';
import { postJson } from './http.js';
import { glmOutputText, parseRecognition } from './parse.js';
import { FOOD_PROMPT } from './prompt.js';
import type { FetchLike, VisionImage, VisionService } from './types.js';

export class GlmVisionService implements VisionService {
  readonly mode = 'live' as const;
  readonly provider = 'glm' as const;
  readonly model = 'glm-4.6v-flash';
  constructor(private readonly apiKey: string, private readonly timeoutMs = 45000, private readonly fetchImpl: FetchLike = fetch) {}

  async recognize(image: VisionImage): Promise<RecognitionResult> {
    const data = await postJson('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      model: this.model,
      thinking: { type: 'disabled' },
      max_tokens: 8192,
      messages: [
        { role: 'system', content: FOOD_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: '识别照片中的食物，只输出JSON。可粗估的每项食物必须给nutritionEstimateProfile的low、medium、high三档每100g范围和假设，默认单值取medium中值。不要给单值而省略范围；无法合理估算时两者都为null，不编造食物名称。' },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data.toString('base64')}` } },
        ] },
      ],
    }, { Authorization: `Bearer ${this.apiKey}` }, this.timeoutMs, this.fetchImpl);
    return parseRecognition(glmOutputText(data), { requireProfile: true });
  }
}
