import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MAX_IMAGE_BYTES, sanitizeImage } from './image.js';
import { ApiError } from './errors.js';
import type { VisionService } from './vision/types.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function appWith(options: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock' }), ...options });
  apps.push(app);
  return app;
}
async function png() { return sharp({ create: { width: 100, height: 80, channels: 3, background: '#00aa55' } }).png().toBuffer(); }
function multipart(buffer: Buffer, mime = 'image/png', extra = '') {
  const boundary = 'shike-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="meal.png"\r\nContent-Type: ${mime}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n${extra}--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const validResult = { isFood: false, foods: [], uncertainties: ['看不出食物'] };

describe('本地识别 API', () => {
  it('health 和 mock 识别结果持续标识模拟', async () => {
    const app = await appWith();
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok', mode: 'mock', provider: 'mock', model: 'mock-demo-v1' });
    const response = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png()) });
    expect(response.statusCode).toBe(200);
    expect(response.json().mode).toBe('mock');
    expect(response.json().result.uncertainties[0]).toContain('模拟');
    expect(response.json().result.foods[1].name).toBe('杂粮粥');
    expect(response.json().result.foods[1].estimatedNutrientsPer100g.energyKcal).toBe(75);
    expect(response.json().result.foods[1].nutritionEstimateProfile.options.map((option: { level: string }) => option.level)).toEqual(['low', 'medium', 'high']);
    expect(response.json().result.foods[1].nutritionAssumptions[0]).toContain('模拟');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('限制真实图片格式、空文件、文件大小及额外字段', async () => {
    const app = await appWith({ config: loadConfig({ AI_MODE: 'mock', AI_REQUESTS_PER_MINUTE: '100' }) });
    const fakeImage = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(Buffer.from('<svg></svg>')) });
    expect(fakeImage.statusCode).toBe(415);
    const mismatch = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png(), 'image/jpeg') });
    expect(mismatch.statusCode).toBe(415);
    const empty = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(Buffer.alloc(0)) });
    expect(empty.statusCode).toBe(400);
    const large = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(Buffer.alloc(MAX_IMAGE_BYTES + 1)) });
    expect(large.statusCode).toBe(413);
    const extra = '--shike-test-boundary\r\nContent-Disposition: form-data; name="provider"\r\n\r\ngemini\r\n';
    const extraField = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png(), 'image/png', extra) });
    expect(extraField.statusCode).toBe(400);
  });

  it('按 IP 分钟限频并返回 Retry-After', async () => {
    let now = Date.parse('2026-10-14T00:00:00Z');
    const app = await appWith({ config: loadConfig({ AI_MODE: 'mock', AI_REQUESTS_PER_MINUTE: '1' }), now: () => now });
    const request = { method: 'POST' as const, url: '/api/recognitions', ...multipart(await png()) };
    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('REQUEST_RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('60');
    now += 60001;
    expect((await app.inject(request)).statusCode).toBe(200);
  });

  it('全局每日限额与日期重置', async () => {
    let now = Date.parse('2026-10-14T00:00:00Z');
    const app = await appWith({ config: loadConfig({ AI_MODE: 'mock', AI_REQUESTS_PER_DAY: '1' }), now: () => now });
    const request = { method: 'POST' as const, url: '/api/recognitions', ...multipart(await png()) };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).json().error.code).toBe('DAILY_LIMIT_REACHED');
    now += 86400000;
    expect((await app.inject(request)).statusCode).toBe(200);
  });

  it('每日额度在北京时间午夜重置，不受主机时区影响', async () => {
    let now = Date.parse('2026-10-14T15:59:50Z');
    const app = await appWith({ config: loadConfig({ AI_MODE: 'mock', AI_REQUESTS_PER_DAY: '1' }), now: () => now });
    const request = { method: 'POST' as const, url: '/api/recognitions', ...multipart(await png()) };
    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);
    expect(limited.json().error.code).toBe('DAILY_LIMIT_REACHED');
    expect(limited.headers['retry-after']).toBe('10');
    now += 10001;
    expect((await app.inject(request)).statusCode).toBe(200);
  });

  it('单并发与失败后释放槽位；不回退 mock', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const recognize = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; })).mockResolvedValue(validResult);
    const service: VisionService = { mode: 'live', provider: 'gemini', model: 'gemini-3.5-flash-lite', recognize };
    const app = await appWith({ service });
    const request = { method: 'POST' as const, url: '/api/recognitions', ...multipart(await png()) };
    const first = app.inject(request);
    // inject 是惰性 Promise；调用 then 后请求才进入服务。
    const firstPromise = first.then((response) => response);
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));
    const second = await app.inject(request);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('AI_BUSY');
    rejectFirst!(new ApiError('AI_TIMEOUT', '模拟上游超时', 504));
    expect((await firstPromise).statusCode).toBe(504);
    const third = await app.inject(request);
    expect(third.statusCode).toBe(200);
    expect(third.json().mode).toBe('live');
  });

  it('拒绝未授权来源，未知 API 返回 JSON 404', async () => {
    const app = await appWith();
    const blocked = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png()), headers: { ...multipart(await png()).headers, origin: 'https://evil.example' } });
    expect(blocked.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/missing' })).statusCode).toBe(404);
    const forged = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png()), headers: { ...multipart(await png()).headers, host: 'evil.example:3001', origin: 'http://evil.example:3001' } });
    expect(forged.statusCode).toBe(403);
  });

  it('开发来源限定为新端口 5180，不再接受其他项目使用的 5173', async () => {
    const app = await appWith();
    const body = multipart(await png());
    for (const origin of ['http://localhost:5180', 'http://127.0.0.1:5180']) {
      const response = await app.inject({ method: 'POST', url: '/api/recognitions', ...body, headers: { ...body.headers, origin } });
      expect(response.statusCode).toBe(200);
    }
    const previous = await app.inject({ method: 'POST', url: '/api/recognitions', ...body, headers: { ...body.headers, origin: 'http://127.0.0.1:5173' } });
    expect(previous.statusCode).toBe(403);
  });

  it('适配器返回非法结构也不能通过 API', async () => {
    const service: VisionService = { mode: 'live', provider: 'glm', model: 'glm-4.6v-flash', recognize: vi.fn().mockResolvedValue({ ...validResult, foods: [{ name: '错误' }] }) };
    const app = await appWith({ service });
    const response = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png()) });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_INVALID_RESULT');
  });

  it('未来适配器不能绕过 API 的营养假设校验', async () => {
    const service: VisionService = { mode: 'live', provider: 'gemini', model: 'gemini-3.5-flash-lite', recognize: vi.fn().mockResolvedValue({
      isFood: true, uncertainties: [], foods: [{ name: '粥', estimatedWeightG: 200, visibleIngredients: [], uncertainties: [],
        estimatedNutrientsPer100g: { energyKcal: 50, proteinG: 1, fatG: 0.5, carbsG: 10 }, nutritionAssumptions: [] }],
    }) };
    const app = await appWith({ service });
    const response = await app.inject({ method: 'POST', url: '/api/recognitions', ...multipart(await png()) });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_INVALID_RESULT');
    expect(response.json().error.message).toContain('假设');
  });
});

describe('图片安全重编码', () => {
  it('去除元数据，并限制输出最长边', async () => {
    const original = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#aaeecc' } }).withMetadata().jpeg().toBuffer();
    const cleaned = await sanitizeImage(original, 'image/jpeg');
    const meta = await sharp(cleaned.data).metadata();
    expect(cleaned.mimeType).toBe('image/jpeg');
    expect(meta.width).toBe(1280);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it('拒绝损坏以及解码后超过 1000 万像素的图片', async () => {
    await expect(sanitizeImage(Buffer.from([0xff, 0xd8, 0xff, 1, 2]), 'image/jpeg')).rejects.toMatchObject({ code: 'IMAGE_DECODE_FAILED' });
    const giant = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(sanitizeImage(giant, 'image/png')).rejects.toMatchObject({ code: 'IMAGE_DECODE_FAILED' });
  });
});
