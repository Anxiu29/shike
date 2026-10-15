import type { RecognitionResult } from '@shike/shared';

export interface VisionImage { data: Buffer; mimeType: 'image/jpeg'; }
/** 适配器屏蔽供应商接口差异。页面和营养计算只依赖这个契约。 */
export interface VisionService {
  readonly mode: 'live' | 'mock';
  readonly provider: 'gemini' | 'glm' | 'mock';
  readonly model: string;
  recognize(image: VisionImage): Promise<RecognitionResult>;
}
export type FetchLike = typeof fetch;
