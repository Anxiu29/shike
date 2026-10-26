import { compatibleVisionEndpoint, glmChatOptions, isGlm53VisionModel, type GlmVisionModel, type RecognitionResult } from '@shike/shared';
import { postJson } from './http.js';
import { glmOutputText, parseRecognition } from './parse.js';
import { GLM_FOOD_PROMPT, FOOD_REQUEST } from './prompt.js';
import type { FetchLike, VisionImage, VisionService } from './types.js';

export class GlmVisionService implements VisionService {
  readonly mode = 'live' as const;
  readonly provider = 'glm' as const;
  constructor(private readonly apiKey: string, private readonly timeoutMs = 45000, private readonly fetchImpl: FetchLike = fetch, readonly model: GlmVisionModel = 'glm-4.6v-flash') { compatibleVisionEndpoint('glm', model); }

  async recognize(image: VisionImage): Promise<RecognitionResult> {
    const data = await postJson('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      model: this.model,
      ...glmChatOptions(this.model),
      ...(isGlm53VisionModel(this.model) ? { response_format: { type: 'json_object' } } : {}),
      max_tokens: 8192,
      messages: [
        { role: 'system', content: GLM_FOOD_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: FOOD_REQUEST },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data.toString('base64')}` } },
        ] },
      ],
    }, { Authorization: `Bearer ${this.apiKey}` }, this.timeoutMs, this.fetchImpl);
    return parseRecognition(glmOutputText(data, this.model), { requireProfile: true, discardInvalidNutrition: true });
  }
}
