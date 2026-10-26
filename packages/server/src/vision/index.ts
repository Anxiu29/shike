/**
 * 适配器工厂：把不同供应商装成同一个VisionService，页面只消费共享RecognitionResponse。
 * Gemini/GLM/Qwen及兼容接口各自处理鉴权和协议，公共提示词/解析规则在shared。
 * Mock是明确配置的实现；只有配置阶段允许选Mock，真实请求出错不在这里偷偷切换。
 * 新增供应商时同时检查config白名单、共享provider schema、解析测试和安卓VisionPolicy。
 * 完整配置及请求格式继续维护在docs/ai-models.md、personal-models.md。
 */
import type { QwenModel, ServerConfig } from '../config.js';
import { GeminiVisionService } from './gemini.js';
import { GlmVisionService } from './glm.js';
import { MockVisionService } from './mock.js';
import { QwenVisionService } from './qwen.js';
import { CompatibleVisionService } from './compatible.js';
import type { GlmVisionModel } from '@shike/shared';
import type { FetchLike, VisionService } from './types.js';
export type { VisionImage, VisionService } from './types.js';

export function createVisionService(config: ServerConfig, fetchImpl?: FetchLike): VisionService {
  if (config.aiMode === 'mock' || (config.aiMode === 'auto' && !config.apiKey)) return new MockVisionService();
  if (!config.apiKey) throw new Error('真实识别需要配置服务端 API Key。');
  if (config.provider === 'siliconflow' || config.provider === 'openrouter' || config.provider === 'deepseek') return new CompatibleVisionService(config.provider, config.model, config.apiKey, config.timeoutMs, fetchImpl);
  if (config.provider === 'qwen') return new QwenVisionService(config.apiKey, config.timeoutMs, fetchImpl, config.model as QwenModel);
  return config.provider === 'gemini'
    ? new GeminiVisionService(config.apiKey, config.timeoutMs, fetchImpl)
    : new GlmVisionService(config.apiKey, config.timeoutMs, fetchImpl, config.model as GlmVisionModel);
}
