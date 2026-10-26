import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { lookupPackagedFood } from './food-catalog.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
const code = '3274080005003';
const product = { status: 1, product: { code, product_name: 'Test', quantity: '100 g', nutriments: { 'energy-kcal_100g': 100 } } };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('OFF只读适配器与本机模型白名单', () => {
  it('只访问固定URL、发送应用标识；无Authorization或模型Key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(product)));
    expect((await lookupPackagedFood(code, fetchImpl))!.label.basis).toBe('100g');
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain(`https://world.openfoodfacts.org/api/v3.6/product/${code}.json`);
    expect(options).toMatchObject({ redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': expect.stringContaining('Shike/') } });
    expect(options.headers).not.toHaveProperty('Authorization'); expect(options.signal).toBeInstanceOf(AbortSignal);
    await expect(lookupPackagedFood('invalid', fetchImpl)).rejects.toMatchObject({ code: 'BARCODE_INVALID' }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('404不是零热量商品，429不重试，异常响应不透出原文', async () => {
    expect(await lookupPackagedFood(code, vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'failure', errors: [{ message: { id: 'product_not_found' } }] }), { status: 404 })))).toBeNull();
    const limited = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    await expect(lookupPackagedFood(code, limited)).rejects.toMatchObject({ code: 'CATALOG_RATE_LIMIT', statusCode: 429 }); expect(limited).toHaveBeenCalledTimes(1);
    for (const response of [new Response(null, { status: 404 }), new Response('{}', { status: 404 }), new Response('<html>404</html>', { status: 404 }), new Response('invalid-private-body'), new Response('x'.repeat(262145)), new Response('unavailable', { status: 503 })])
      await expect(lookupPackagedFood(code, vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    await expect(lookupPackagedFood(code, vi.fn().mockRejectedValue(new DOMException('private detail', 'TimeoutError')))).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
  });
  it('条码接口10次限流与AI额度独立；mock仍能使用免费的商品查询', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify(product)));
    const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock' }), fetchImpl }); apps.push(app);
    for (let i = 0; i < 10; i++) expect((await app.inject(`/api/packaged-foods/${code}`)).statusCode).toBe(200);
    expect((await app.inject(`/api/packaged-foods/${code}`)).statusCode).toBe(429); expect(fetchImpl).toHaveBeenCalledTimes(10);
    const models = (await app.inject('/api/models')).json(); expect(models.models).toHaveLength(1); expect(models.models[0].mode).toBe('mock');
  });
  it('已配置模型可手动选用，元数据没有密钥，拒绝任意模型且不自动回退', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"isFood":false,"foods":[],"uncertainties":[]}' } }] })));
    const app = await buildApp({ config: loadConfig({ AI_MODE: 'live', GEMINI_API_KEY: 'test-gemini-secret', DASHSCOPE_API_KEY: 'test-qwen-secret' }), fetchImpl }); apps.push(app);
    const models = await app.inject('/api/models'); expect(models.body).not.toContain('secret');
    expect(models.json().models.some((p: { id: string }) => p.id === 'qwen:qwen3.7-flash')).toBe(true);
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer();
    const upload = (id: string) => ({ method: 'POST' as const, url: '/api/recognitions', headers: { 'content-type': 'multipart/form-data; boundary=catalog-test' }, payload: Buffer.concat([
      Buffer.from(`--catalog-test\r\nContent-Disposition: form-data; name="modelId"\r\n\r\n${id}\r\n--catalog-test\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`), image, Buffer.from('\r\n--catalog-test--\r\n'),
    ]) });
    expect((await app.inject(upload('evil-model'))).statusCode).toBe(400); expect(fetchImpl).not.toHaveBeenCalled();
    const result = await app.inject(upload('qwen:qwen3.7-flash')); expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ provider: 'qwen', model: 'qwen3.7-flash' });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).model).toBe('qwen3.7-flash'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
