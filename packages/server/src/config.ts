import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export type Provider = 'gemini' | 'glm';
export interface ServerConfig {
  provider: Provider;
  aiMode: 'auto' | 'mock' | 'live';
  apiKey: string | undefined;
  model: string;
  port: number;
  host: string;
  nodeEnv: string;
  publicOrigin: string | undefined;
  timeoutMs: number;
  requestsPerMinute: number;
  requestsPerDay: number;
  concurrency: number;
}

const envSchema = z.object({
  AI_PROVIDER: z.enum(['gemini', 'glm']).default('gemini'),
  AI_MODE: z.enum(['auto', 'mock', 'live']).default('auto'),
  GEMINI_API_KEY: z.string().optional(),
  ZHIPU_API_KEY: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.string().default('development'),
  PUBLIC_ORIGIN: z.string().url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(45000),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(5),
  AI_REQUESTS_PER_DAY: z.coerce.number().int().min(1).max(10000).default(100),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(1),
});

/** 只在后端加载根目录 .env。不能用 VITE_ 前缀保存密钥。 */
export function loadConfig(env?: NodeJS.ProcessEnv): ServerConfig {
  if (!env) dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const parsed = envSchema.safeParse(env ?? process.env);
  // Zod 的原始错误可能含输入值；启动错误只透露字段名，不输出密钥。
  if (!parsed.success) throw new Error(`环境配置无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join('、')}`);
  const e = parsed.data;
  const apiKey = (e.AI_PROVIDER === 'gemini' ? e.GEMINI_API_KEY : e.ZHIPU_API_KEY)?.trim() || undefined;
  if (e.AI_MODE === 'live' && !apiKey) throw new Error('AI_MODE=live 时必须配置所选模型的服务端 API Key。');
  return {
    provider: e.AI_PROVIDER, aiMode: e.AI_MODE, apiKey,
    model: e.AI_PROVIDER === 'gemini' ? 'gemini-3.5-flash-lite' : 'glm-4.6v-flash',
    port: e.PORT, host: e.HOST, nodeEnv: e.NODE_ENV,
    publicOrigin: e.PUBLIC_ORIGIN ? new URL(e.PUBLIC_ORIGIN).origin : undefined,
    timeoutMs: e.AI_TIMEOUT_MS, requestsPerMinute: e.AI_REQUESTS_PER_MINUTE,
    requestsPerDay: e.AI_REQUESTS_PER_DAY, concurrency: e.AI_CONCURRENCY,
  };
}
