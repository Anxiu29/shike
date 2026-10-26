/**
 * HTTP边界：Fastify装配来源校验、鉴权、限频/并发、额度、图片清洗及统一错误响应。
 * 视觉POST /api/recognitions收multipart图片；文字POST /api/meal-assistant收JSON。
 * /api/health只说明配置/运行状态；/api/models只列已配置白名单，不返回Key。
 * 可选模型不能由客户端指定上游URL/Key/任意提示词。真实失败报错，不回退伪装Mock成功。
 * buildApp的service/fetchImpl/now/dailyQuota可注入测试替身；finally释放并发令牌。
 * 构建后也可同源提供web/dist；用户餐食仍存浏览器IndexedDB，不经这里同步到云数据库。
 * 部署/额度/密钥配置的操作步骤保留在docs/cloud-deployment.md及ai-models.md。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type RecognitionResponse, type HealthResponse, normalizeUpdateRepository } from '@shike/shared';
import { loadConfig, type ServerConfig } from './config.js';
import { ApiError } from './errors.js';
import { MAX_IMAGE_BYTES, sanitizeImage } from './image.js';
import { RecognitionLimiter } from './limiter.js';
import { createVisionService, type VisionService } from './vision/index.js';
import type { FetchLike } from './vision/types.js';
import { validateRecognition } from './vision/parse.js';
import { AppAccess } from './auth.js';
import { createDailyQuota, type DailyQuota } from './quota.js';
import { z } from 'zod';
import { lookupPackagedFood } from './food-catalog.js';
import { assistantRequestSchema } from '@shike/shared';
import { describeMeal } from './meal-assistant.js';
import { readGiteeUpdate } from './app-updates.js';

export interface AppOptions {
  config?: ServerConfig;
  service?: VisionService;
  fetchImpl?: FetchLike;
  now?: () => number;
  serveStatic?: boolean;
  dailyQuota?: DailyQuota;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const service = options.service ?? createVisionService(config, options.fetchImpl);
  // 只开放已在本机配置的固定白名单，客户端不能提交Key、提示词或上游URL。
  const selectable = new Map((!config.publicMode && config.aiMode !== 'mock' ? config.modelProfiles ?? [] : []).map(profile => [profile.id, createVisionService({ ...config, provider: profile.provider, model: profile.model, apiKey: profile.apiKey }, options.fetchImpl)]));
  const limiter = new RecognitionLimiter(config, options.now);
  const sessionLimiter = new RecognitionLimiter({ ...config, requestsPerMinute: 5 }, options.now);
  const catalogLimiter = new RecognitionLimiter({ ...config, requestsPerMinute: 10 }, options.now);
  const updateLimiter = new RecognitionLimiter({ ...config, requestsPerMinute: 10 }, options.now);
  let activeUpdateChecks = 0;
  const access = new AppAccess(config, options.now);
  const quota = options.dailyQuota ?? createDailyQuota(config);
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: MAX_IMAGE_BYTES + 64 * 1024, requestTimeout: 60000 });
  // 在任何await插件启动之前设置，使静态页面和API路由都使用统一安全错误格式。
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      if (error.retryAfterSeconds !== undefined) reply.header('Retry-After', error.retryAfterSeconds);
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } });
    }
    const code = (error as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: { code: 'IMAGE_TOO_LARGE', message: '压缩后的照片不能超过 2 MB。' } });
    if (code === 'FST_FILES_LIMIT' || code === 'FST_FIELDS_LIMIT' || code === 'FST_PARTS_LIMIT') return reply.code(400).send({ error: { code: 'IMAGE_REQUIRED', message: '一次只能上传一张照片，不接受额外字段。' } });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: '请求格式无效，请从食刻页面重新上传照片。' } });
    // 不输出原始异常，防止 SDK/fetch 的错误内容包含账户、请求或图片数据。
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时无法处理请求，请稍后重试。' } });
  });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'https:'], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      // HTTP 局域网预览不能把脚本／样式升级到并不存在的 HTTPS 端口。
      // 正式 HTTPS 来源仍保留升级指令；来源只信任服务端显式配置。
      upgradeInsecureRequests: config.publicOrigin?.startsWith('https://') ? [] : null,
    } },
  });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, parts: 2 } });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (!request.url.startsWith('/api/')) return;
    // 浏览器跨域请求不能借用本地密钥。生产 HTTPS 代理通过 PUBLIC_ORIGIN 显式配置可信来源。
    const origin = request.headers.origin;
    if (origin) {
      // 来源白名单必须由服务端配置形成，不能直接信任可被伪造的 Host 头。
      const configuredHost = config.host.includes(':') ? `[${config.host}]` : config.host;
      const allowed = new Set([
        ...config.allowedOrigins,
        ...(config.publicOrigin ? [config.publicOrigin] : []),
        ...(!config.publicMode ? [`http://${configuredHost}:${config.port}`, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`] : []),
      ]);
      if (config.nodeEnv !== 'production' && !config.publicMode) {
        allowed.add('http://localhost:5180'); allowed.add('http://127.0.0.1:5180');
      }
      if (!allowed.has(origin)) throw new ApiError('ORIGIN_FORBIDDEN', '请求来源不受允许，请从食刻页面发起识别。', 403);
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
      reply.header('Access-Control-Expose-Headers', 'Retry-After');
    }
    if (request.method === 'OPTIONS') {
      const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (!origin || !['GET', 'POST'].includes(String(request.headers['access-control-request-method'])) || headers.some(value => !['authorization', 'content-type'].includes(value))) throw new ApiError('CORS_FORBIDDEN', '跨域请求配置不受允许。', 403);
      return reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS').header('Access-Control-Allow-Headers', 'Authorization, Content-Type').header('Access-Control-Max-Age', '600').code(204).send();
    }
    if (request.method !== 'POST' || !['/api/recognitions', '/api/meal-assistant'].includes(request.url.split('?')[0]!)) return;
    access.verify(request.headers.authorization);
    limiter.checkIp(request.ip);
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok', mode: service.mode, provider: service.provider, model: service.model,
    ...(access.required ? { authRequired: true } : {}),
  }));
  app.get<{ Params: { barcode: string } }>('/api/packaged-foods/:barcode', async request => {
    catalogLimiter.checkIp(request.ip);
    return { product: await lookupPackagedFood(request.params.barcode, options.fetchImpl) };
  });
  app.get('/api/models', async () => ({ defaultId: 'default', models: [{ id: 'default', provider: service.provider, model: service.model, mode: service.mode }, ...[...selectable].map(([id, value]) => ({ id, provider: value.provider, model: value.model, mode: value.mode }))] }));
  app.get('/api/app-updates/gitee', async request => {
    updateLimiter.checkIp(request.ip);
    const query = z.object({ repository: z.string().min(3).max(230), tag: z.string().max(200).optional() }).strict().safeParse(request.query);
    if (!query.success) throw new ApiError('UPDATE_SOURCE_INVALID', '更新仓库或标签格式无效。');
    try { normalizeUpdateRepository(query.data.repository, 'gitee'); } catch { throw new ApiError('UPDATE_SOURCE_INVALID', '请填写公开Gitee仓库，格式为 用户名/仓库名。'); }
    if (activeUpdateChecks >= 2) throw new ApiError('UPDATE_BUSY', '更新检查繁忙，请稍后重试。', 429);
    activeUpdateChecks++;
    try { return await readGiteeUpdate(query.data.repository, query.data.tag, options.fetchImpl); } finally { activeUpdateChecks--; }
  });

  app.post('/api/session', { bodyLimit: 2048 }, async request => {
    sessionLimiter.checkIp(request.ip);
    const body = z.object({ accessCode: z.string().min(1).max(128) }).strict().safeParse(request.body);
    if (!body.success) throw new ApiError('ACCESS_CODE_REQUIRED', '请输入内测访问码。');
    return access.create(body.data.accessCode);
  });

  app.post('/api/recognitions', async (request): Promise<RecognitionResponse> => {
    if (!request.isMultipart()) throw new ApiError('IMAGE_REQUIRED', '请使用照片上传表单提交一张图片。', 415);
    let buffer: Buffer | undefined;
    let mime = '';
    let selected: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname !== 'modelId') throw new ApiError('IMAGE_REQUIRED', '不接受模型或图片以外的字段。');
        if (selected !== undefined || typeof part.value !== 'string' || (part.value !== 'default' && !selectable.has(part.value))) throw new ApiError('MODEL_UNAVAILABLE', '请选择本机已配置的模型。');
        selected = part.value; continue;
      }
      if (part.type !== 'file' || part.fieldname !== 'image' || buffer) throw new ApiError('IMAGE_REQUIRED', '一次只能上传一张图片，字段名必须为 image。');
      buffer = await part.toBuffer();
      mime = part.mimetype;
      if (part.file.truncated) throw new ApiError('IMAGE_TOO_LARGE', '压缩后的照片不能超过 2 MB。', 413);
    }
    if (!buffer) throw new ApiError('IMAGE_REQUIRED', '请选择一张照片。');
    const image = await sanitizeImage(buffer, mime);
    const currentService = selected && selected !== 'default' ? selectable.get(selected)! : service;
    const release = limiter.acquire();
    try {
      await quota?.consume((options.now ?? Date.now)(), config.requestsPerDay);
      // 对所有适配器再次校验，未来更换供应商也不能绕过统一数据边界。
      const result = validateRecognition(await currentService.recognize(image));
      return { result, mode: currentService.mode, provider: currentService.provider, model: currentService.model };
    } finally { release(); }
  });

  app.post('/api/meal-assistant', { bodyLimit: 3 * 1_398_104 + 32768 }, async request => {
    const parsed = assistantRequestSchema.safeExtend({ modelId: z.string().max(100).optional() }).safeParse(request.body);
    if (!parsed.success) throw new ApiError('ASSISTANT_INPUT_INVALID', '请填写1000字以内的描述或选择图片，上下文最多6条消息、3张压缩图片。');
    const { modelId, ...input } = parsed.data;
    const profile = modelId && modelId !== 'default' ? config.modelProfiles?.find(profile => profile.id === modelId && selectable.has(modelId)) : undefined;
    if (modelId && modelId !== 'default' && !profile) throw new ApiError('MODEL_UNAVAILABLE', '请选择本机已配置的模型。');
    const release = limiter.acquire();
    try { await quota?.consume((options.now ?? Date.now)(), config.requestsPerDay); return await describeMeal(profile ? { ...config, ...profile } : config, input, options.fetchImpl); }
    finally { release(); }
  });

  const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  // 本机3001也提供已构建页面；环境切换不能让原浏览器来源只剩API，误以为记录丢失。
  const serveStatic = options.serveStatic ?? config.nodeEnv !== 'test';
  if (serveStatic && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.split('?')[0]!.includes('.')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到这个页面或接口。' } });
    });
  } else app.setNotFoundHandler(async (_, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到这个接口。' } }));


  return app;
}
