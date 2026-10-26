import type { RecognitionResult } from '@shike/shared';
import { postJson } from './http.js';
import { geminiOutputText, parseRecognition } from './parse.js';
import { FOOD_PROMPT, FOOD_REQUEST, recognitionJsonSchema } from './prompt.js';
import type { FetchLike, VisionImage, VisionService } from './types.js';

export class GeminiVisionService implements VisionService {
  readonly mode = 'live' as const;
  readonly provider = 'gemini' as const;
  readonly model = 'gemini-3.5-flash-lite';
  constructor(private readonly apiKey: string, private readonly timeoutMs = 45000, private readonly fetchImpl: FetchLike = fetch) {}

  async recognize(image: VisionImage): Promise<RecognitionResult> {
    const data = await postJson('https://generativelanguage.googleapis.com/v1beta/interactions', {
      model: this.model,
      // 单轮请求，不上传文件到 Files API，不创建可检索的云端会话。
      store: false,
      system_instruction: FOOD_PROMPT,
      input: [
        { type: 'text', text: FOOD_REQUEST },
        { type: 'image', mime_type: image.mimeType, data: image.data.toString('base64') },
      ],
      generation_config: { thinking_level: 'minimal', max_output_tokens: 8192 },
      response_format: { type: 'text', mime_type: 'application/json', schema: recognitionJsonSchema },
    }, { 'x-goog-api-key': this.apiKey }, this.timeoutMs, this.fetchImpl);
    return parseRecognition(geminiOutputText(data), { requireProfile: true });
  }
}
