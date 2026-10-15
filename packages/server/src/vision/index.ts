import type { ServerConfig } from '../config.js';
import { GeminiVisionService } from './gemini.js';
import { GlmVisionService } from './glm.js';
import { MockVisionService } from './mock.js';
import type { FetchLike, VisionService } from './types.js';
export type { VisionImage, VisionService } from './types.js';

export function createVisionService(config: ServerConfig, fetchImpl?: FetchLike): VisionService {
  if (config.aiMode === 'mock' || (config.aiMode === 'auto' && !config.apiKey)) return new MockVisionService();
  if (!config.apiKey) throw new Error('真实识别需要配置服务端 API Key。');
  return config.provider === 'gemini'
    ? new GeminiVisionService(config.apiKey, config.timeoutMs, fetchImpl)
    : new GlmVisionService(config.apiKey, config.timeoutMs, fetchImpl);
}
