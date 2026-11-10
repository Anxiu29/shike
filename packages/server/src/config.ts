/**
 * 配置边界：dotenv读根目录.env，Zod把字符串环境变量转成受约束的ServerConfig。
 * provider/model/API端点受项目白名单限制；启动时失败优于运行途中使用不完整配置。
 * auto缺少所选Key才用Mock，mock强制模拟，live缺Key拒绝启动；调用失败不自动换模型。
 * 网页端不使用VITE_密钥；Vite的envDir隔离服务端.env。部署保护见docs/cloud-deployment.md。
 */
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { personalProviders, personalProviderSchema, openRouterVisionModels, glmVisionModels, type PersonalProvider } from '@shike/shared';

export type Provider = PersonalProvider;
// 服务端决定已配置的白名单，网页只能选其中的ID，不能传上游地址或任意模型。
export const QWEN_MODELS = ['qwen3.7-flash', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3-vl-plus'] as const;
export type QwenModel = typeof QWEN_MODELS[number];
export interface ServerConfig {
  modelProfiles?: Array<{ id: string; provider: Provider; model: string; apiKey: string }>;
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
  publicMode: boolean;
  accessCode: string | undefined;
  tokenSecret: string | undefined;
  allowedOrigins: string[];
  quotaStore: 'memory' | 'oss';
  ossBucket: string | undefined;
  ossRegion: string | undefined;
}

// 环境变量均从字符串进入，数值必须显式coerce并限制范围；默认值也属于服务成本策略。
// 这里只定义字段级规则，公网模式的跨字段约束放在loadConfig中集中检查。
const envSchema = z.object({
  AI_PROVIDER: personalProviderSchema.default('gemini'),
  AI_MODE: z.enum(['auto', 'mock', 'live']).default('auto'),
  GEMINI_API_KEY: z.string().optional(),
  ZHIPU_API_KEY: z.string().optional(),
  GLM_MODEL: z.enum(glmVisionModels).default('glm-4.6v-flash'),
  DASHSCOPE_API_KEY: z.string().optional(),
  SILICONFLOW_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.enum(openRouterVisionModels).default(openRouterVisionModels[0]),
  QWEN_MODEL: z.enum(QWEN_MODELS).default('qwen3.7-flash'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.string().default('development'),
  PUBLIC_ORIGIN: z.string().url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(45000),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(5),
  AI_REQUESTS_PER_DAY: z.coerce.number().int().min(1).max(10000).default(100),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(1),
  APP_PUBLIC_MODE: z.enum(['true', 'false']).default('false'),
  APP_ACCESS_CODE: z.string().max(128).optional(),
  APP_TOKEN_SECRET: z.string().max(256).optional(),
  APP_ALLOWED_ORIGINS: z.string().default('https://localhost'),
  QUOTA_STORE: z.enum(['memory', 'oss']).default('memory'),
  OSS_QUOTA_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).optional(),
  OSS_QUOTA_REGION: z.string().regex(/^oss-[a-z0-9-]+$/).optional(),
});

/**
 * 只在后端加载根目录.env，返回通过字段及跨字段检查的完整ServerConfig。
 * 传入env时直接验证该对象，不读取磁盘；测试因此能用字面量隔离开发机真实凭证。
 * 不能用VITE_前缀保存密钥，不能记录整个ServerConfig；它包含apiKey和签名材料。
 */
export function loadConfig(env?: NodeJS.ProcessEnv): ServerConfig {
  if (!env) dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const parsed = envSchema.safeParse(env ?? process.env);
  // Zod 的原始错误可能含输入值；启动错误只透露字段名，不输出密钥。
  if (!parsed.success) throw new Error(`环境配置无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join('、')}`);
  const e = parsed.data;
  const keys = { gemini: e.GEMINI_API_KEY, glm: e.ZHIPU_API_KEY, qwen: e.DASHSCOPE_API_KEY, siliconflow: e.SILICONFLOW_API_KEY, openrouter: e.OPENROUTER_API_KEY, deepseek: e.DEEPSEEK_API_KEY };
  const models = { gemini: 'gemini-3.5-flash-lite', glm: e.GLM_MODEL, qwen: e.QWEN_MODEL, siliconflow: 'Qwen/Qwen3.5-4B', openrouter: e.OPENROUTER_MODEL, deepseek: 'deepseek-flash' };
  const apiKey = keys[e.AI_PROVIDER]?.trim() || undefined;
  if (e.AI_MODE === 'live' && !apiKey) throw new Error('AI_MODE=live 时必须配置所选模型的服务端 API Key。');
  // publicMode是部署者显式开启的策略，不能根据Host/Origin等客户端请求头推测。
  const publicMode = e.APP_PUBLIC_MODE === 'true';
  if (publicMode && e.PUBLIC_ORIGIN && new URL(e.PUBLIC_ORIGIN).protocol !== 'https:') throw new Error('公网 PUBLIC_ORIGIN 必须使用 HTTPS。');
  const accessCode = e.APP_ACCESS_CODE?.trim() || undefined;
  const tokenSecret = e.APP_TOKEN_SECRET?.trim() || undefined;
  const allowedOrigins = e.APP_ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.some(value => { try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value; } catch { return true; } })) throw new Error('APP_ALLOWED_ORIGINS 必须是逗号分隔的精确 HTTPS 来源。');
  if (accessCode && (accessCode.length < 16 || !tokenSecret || tokenSecret.length < 32)) throw new Error('访问保护需要至少 16 位 APP_ACCESS_CODE 与至少 32 位 APP_TOKEN_SECRET。');
  // 公网必须把身份保护和持久化配额一起配齐；否则重启/扩容会重置付费调用的日上限。
  if (publicMode && (!accessCode || !tokenSecret || e.QUOTA_STORE !== 'oss' || !e.OSS_QUOTA_BUCKET || !e.OSS_QUOTA_REGION)) throw new Error('公网模式必须配置访问保护与 OSS 持久化限额。');
  if (e.QUOTA_STORE === 'oss' && (!e.OSS_QUOTA_BUCKET || !e.OSS_QUOTA_REGION)) throw new Error('OSS 限额需要配置 OSS_QUOTA_BUCKET 和 OSS_QUOTA_REGION。');
  return {
    // 所有可选条目都由共享模型白名单×本机已配置Key生成；接口只向页面返回非秘密字段。
    modelProfiles: Object.entries(keys).flatMap(([provider, key]) => key?.trim() ? [...personalProviders.find(item => item.id === provider)!.models].map(model => ({ id: `${provider}:${model}`, provider: provider as Provider, model, apiKey: key.trim() })) : []),
    provider: e.AI_PROVIDER, aiMode: e.AI_MODE, apiKey,
    model: models[e.AI_PROVIDER],
    port: e.PORT, host: e.HOST, nodeEnv: e.NODE_ENV,
    publicOrigin: e.PUBLIC_ORIGIN ? new URL(e.PUBLIC_ORIGIN).origin : undefined,
    timeoutMs: e.AI_TIMEOUT_MS, requestsPerMinute: e.AI_REQUESTS_PER_MINUTE,
    requestsPerDay: e.AI_REQUESTS_PER_DAY, concurrency: e.AI_CONCURRENCY,
    publicMode, accessCode, tokenSecret, allowedOrigins, quotaStore: e.QUOTA_STORE,
    ossBucket: e.OSS_QUOTA_BUCKET, ossRegion: e.OSS_QUOTA_REGION,
  };
}
