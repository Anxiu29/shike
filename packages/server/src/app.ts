import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type RecognitionResponse, type HealthResponse } from '@shike/shared';
import { loadConfig, type ServerConfig } from './config.js';
import { ApiError } from './errors.js';
import { MAX_IMAGE_BYTES, sanitizeImage } from './image.js';
import { RecognitionLimiter } from './limiter.js';
import { createVisionService, type VisionService } from './vision/index.js';
import type { FetchLike } from './vision/types.js';
import { validateRecognition } from './vision/parse.js';

export interface AppOptions {
  config?: ServerConfig;
  service?: VisionService;
  fetchImpl?: FetchLike;
  now?: () => number;
  serveStatic?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const service = options.service ?? createVisionService(config, options.fetchImpl);
  const limiter = new RecognitionLimiter(config, options.now);
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: MAX_IMAGE_BYTES + 64 * 1024, requestTimeout: 60000 });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      // HTTP 局域网预览不能把脚本／样式升级到并不存在的 HTTPS 端口。
      // 正式 HTTPS 来源仍保留升级指令；来源只信任服务端显式配置。
      upgradeInsecureRequests: config.publicOrigin?.startsWith('https://') ? [] : null,
    } },
  });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 } });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (request.method !== 'POST' || request.url.split('?')[0] !== '/api/recognitions') return;
    // 浏览器跨域请求不能借用本地密钥。生产 HTTPS 代理通过 PUBLIC_ORIGIN 显式配置可信来源。
    const origin = request.headers.origin;
    if (origin) {
      // 来源白名单必须由服务端配置形成，不能直接信任可被伪造的 Host 头。
      const configuredHost = config.host.includes(':') ? `[${config.host}]` : config.host;
      const allowed = new Set([
        config.publicOrigin ?? `http://${configuredHost}:${config.port}`,
        `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`,
      ]);
      if (config.nodeEnv !== 'production') {
        allowed.add('http://localhost:5180'); allowed.add('http://127.0.0.1:5180');
      }
      if (!allowed.has(origin)) throw new ApiError('ORIGIN_FORBIDDEN', '请求来源不受允许，请从食刻页面发起识别。', 403);
    }
    limiter.checkIp(request.ip);
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok', mode: service.mode, provider: service.provider, model: service.model,
  }));

  app.post('/api/recognitions', async (request): Promise<RecognitionResponse> => {
    if (!request.isMultipart()) throw new ApiError('IMAGE_REQUIRED', '请使用照片上传表单提交一张图片。', 415);
    let buffer: Buffer | undefined;
    let mime = '';
    for await (const part of request.parts()) {
      if (part.type !== 'file' || part.fieldname !== 'image' || buffer) throw new ApiError('IMAGE_REQUIRED', '一次只能上传一张图片，字段名必须为 image。');
      buffer = await part.toBuffer();
      mime = part.mimetype;
      if (part.file.truncated) throw new ApiError('IMAGE_TOO_LARGE', '压缩后的照片不能超过 2 MB。', 413);
    }
    if (!buffer) throw new ApiError('IMAGE_REQUIRED', '请选择一张照片。');
    const image = await sanitizeImage(buffer, mime);
    const release = limiter.acquire();
    try {
      // 对所有适配器再次校验，未来更换供应商也不能绕过统一数据边界。
      const result = validateRecognition(await service.recognize(image));
      return { result, mode: service.mode, provider: service.provider, model: service.model };
    } finally { release(); }
  });

  const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const serveStatic = options.serveStatic ?? config.nodeEnv === 'production';
  if (serveStatic && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.split('?')[0]!.includes('.')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到这个页面或接口。' } });
    });
  } else app.setNotFoundHandler(async (_, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '找不到这个接口。' } }));

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
  return app;
}
