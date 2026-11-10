import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { AppAccess } from './auth.js';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { OssDailyQuota, type AppendStore } from './quota.js';

const settings = { APP_ACCESS_CODE: 'example-access-code-for-tests', APP_TOKEN_SECRET: 'example-token-secret-longer-than-32-characters' };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function appWith(options: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock', ...settings }), ...options }); apps.push(app); return app;
}
async function photo() {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  return { headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' }, payload: Buffer.concat([Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'), image, Buffer.from('\r\n--test-boundary--\r\n')]) };
}

describe('公网内测访问保护', () => {
  it('令牌验签、过期与访问码轮换；不能通过修改 payload 延长有效期', () => {
    let now = Date.now(); const config = loadConfig(settings); const access = new AppAccess(config, () => now);
    const { token } = access.create(settings.APP_ACCESS_CODE);
    expect(() => access.verify(`Bearer ${token}`)).not.toThrow();
    expect(() => access.create('wrong')).toThrow('访问码不正确');
    expect(() => access.verify(`Bearer e30.${token.split('.')[1]}`)).toThrow('凭证可能已过期');
    expect(() => new AppAccess({ ...config, accessCode: 'rotated-code-long-enough' }).verify(`Bearer ${token}`)).toThrow();
    now += 8 * 86400000; expect(() => access.verify(`Bearer ${token}`)).toThrow();
  });
  it('公网配置不能缺少访问保护或使用易丢失的内存日限额', () => {
    expect(() => loadConfig({ APP_PUBLIC_MODE: 'true' })).toThrow('公网模式');
    expect(() => loadConfig({ ...settings, APP_PUBLIC_MODE: 'true' })).toThrow('公网模式');
    expect(() => loadConfig({ ...settings, APP_ACCESS_CODE: 'short' })).toThrow('16 位');
    expect(() => loadConfig({ APP_ALLOWED_ORIGINS: 'https://localhost/evil' })).toThrow('精确');
    expect(() => loadConfig({ ...settings, APP_PUBLIC_MODE: 'true', QUOTA_STORE: 'oss', OSS_QUOTA_BUCKET: 'test-quota-bucket', OSS_QUOTA_REGION: 'oss-cn-beijing' })).not.toThrow();
  });
  it('只有有令牌的请求能上传；缺少 Origin 也不能绕过鉴权', async () => {
    const app = await appWith(); const body = await photo();
    const health = (await app.inject('/api/health')).json(); expect(health.authRequired).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/recognitions', ...body })).statusCode).toBe(401);
    const session = await app.inject({ method: 'POST', url: '/api/session', payload: { accessCode: settings.APP_ACCESS_CODE } });
    expect(session.statusCode).toBe(200); expect(session.headers['cache-control']).toBe('no-store');
    const response = await app.inject({ method: 'POST', url: '/api/recognitions', ...body, headers: { ...body.headers, origin: 'https://localhost', authorization: `Bearer ${session.json().token}` } });
    expect(response.statusCode).toBe(200); expect(response.headers['access-control-allow-origin']).toBe('https://localhost');
    expect(JSON.stringify(response.json())).not.toContain(settings.APP_TOKEN_SECRET);
  });
  it('只为明确允许的 App 来源处理预检，拒绝非法来源和请求头', async () => {
    const app = await appWith();
    const headers = { origin: 'https://localhost', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' };
    const allowed = await app.inject({ method: 'OPTIONS', url: '/api/recognitions', headers });
    expect(allowed.statusCode).toBe(204); expect(allowed.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect((await app.inject({ method: 'OPTIONS', url: '/api/recognitions', headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'OPTIONS', url: '/api/recognitions', headers: { ...headers, 'access-control-request-headers': 'x-unsafe' } })).statusCode).toBe(403);
  });
  it('访问码错误尝试限频，持久化日限额故障时不调用模型', async () => {
    const app = await appWith();
    for (let n = 0; n < 5; n++) expect((await app.inject({ method: 'POST', url: '/api/session', payload: { accessCode: 'wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/session', payload: { accessCode: 'wrong' } })).statusCode).toBe(429);
    const recognize = vi.fn();
    const unavailable = new OssDailyQuota({ size: async () => { throw new Error('secret-storage-details'); }, append: vi.fn() });
    const protectedApp = await appWith({ config: loadConfig({ AI_MODE: 'mock' }), dailyQuota: unavailable, service: { mode: 'live', provider: 'qwen', model: 'test-model', recognize } });
    const response = await protectedApp.inject({ method: 'POST', url: '/api/recognitions', ...await photo() });
    expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe('QUOTA_UNAVAILABLE'); expect(recognize).not.toHaveBeenCalled();
  });
});

describe('OSS 持久化日限额', () => {
  it('额度读取超时后迟到的长度不会再发起扣额写入', async () => {
    vi.useFakeTimers();
    const size = Promise.withResolvers<number>();
    let reserved = 0;
    const quota = new OssDailyQuota({ size: () => size.promise, append: async () => { reserved++; } });
    const outcome = quota.consume(Date.now(), 10).then(() => 'unexpected-success', error => error.code);
    try {
      await vi.advanceTimersByTimeAsync(8000);
      expect(await outcome).toBe('QUOTA_UNAVAILABLE');
      size.resolve(0);
      await vi.runAllTimersAsync();
      expect(reserved).toBe(0);
    } finally { size.resolve(0); vi.useRealTimers(); }
  });
  it('两个服务实例竞争最后一个名额时只有一个成功；重建对象仍保留日限额', async () => {
    const values = new Map<string, number>();
    const store: AppendStore = {
      size: async key => values.get(key) ?? 0,
      append: async (key, position) => { if ((values.get(key) ?? 0) !== position) throw Object.assign(new Error(), { code: 'PositionNotEqualToLength' }); values.set(key, position + 1); },
    };
    const now = Date.parse('2026-10-15T15:59:00Z');
    const results = await Promise.allSettled([new OssDailyQuota(store).consume(now, 1), new OssDailyQuota(store).consume(now, 1)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    await expect(new OssDailyQuota(store).consume(now, 1)).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED', retryAfterSeconds: 60 });
    await expect(new OssDailyQuota(store).consume(now + 61000, 1)).resolves.toBeUndefined();
    expect([...values.keys()]).toEqual(['shike-quota/2026-10-15.count', 'shike-quota/2026-10-16.count']);
  });
  it('异常长度和持续竞争失败关闭，不回退内存计数', async () => {
    await expect(new OssDailyQuota({ size: async () => NaN, append: vi.fn() }).consume(Date.now(), 10)).rejects.toMatchObject({ code: 'QUOTA_UNAVAILABLE' });
    const append = vi.fn().mockRejectedValue({ code: 'PositionNotEqualToLength' });
    await expect(new OssDailyQuota({ size: async () => 0, append }).consume(Date.now(), 10)).rejects.toMatchObject({ code: 'QUOTA_UNAVAILABLE' });
    expect(append).toHaveBeenCalledTimes(4);
  });
});
