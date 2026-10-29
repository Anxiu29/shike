import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
const input = { text: '早餐两个肉包', date: '2026-10-20', mealType: 'breakfast' };
describe('文字助手API', () => {
  it('订单截图复用受保护接口和结构校验，任务类型传给上游，非法结果拒绝', async () => {
    const imageBase64 = (await sharp({ create: { width: 300, height: 600, channels: 3, background: '#fff' } }).jpeg().toBuffer()).toString('base64');
    const draft = { intent: 'update', date: input.date, mealType: input.mealType, foods: [{ name: '肉包', amount: 6, unit: '个' }], message: '下单数量不等于实际摄入，请核对。' };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] })));
    const app = await buildApp({ config: loadConfig({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'test-only-key', AI_MODE: 'live' }), fetchImpl: fetcher as typeof fetch });
    try {
      const payload = { ...input, text: '', inputKind: 'order', imageBase64 };
      const response = await app.inject({ method: 'POST', url: '/api/meal-assistant', payload });
      expect(response.statusCode).toBe(200); expect(response.json().draft).toEqual(draft);
      const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      expect(body.messages[0].content).toContain('本次inputKind=order');
      expect(JSON.parse(body.messages[1].content[0].text).inputKind).toBe('order');
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...draft, foods: [{ name: '肉包', amount: -1, unit: '个' }] }) } }] })));
      expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload })).statusCode).toBe(502);
      expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: { ...payload, inputKind: 'other' } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('接收图片加描述和历史图片，解码去除EXIF后发送；伪造图片不调用模型', async () => {
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#66aa55' } }).withExif({ IFD0: { Artist: 'private-location'.repeat(1400) } }).jpeg().toBuffer();
    const draft = { intent: 'question', date: input.date, mealType: input.mealType, foods: [], message: '可适量搭配蔬菜。' };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] })));
    const app = await buildApp({ config: loadConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-only-key', AI_MODE: 'live' }), fetchImpl: fetcher as typeof fetch });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: { ...input, text: '和上一张相比呢？', imageBase64: photo.toString('base64'), history: [{ role: 'user', text: '上一餐', imageBase64: photo.toString('base64') }, { role: 'assistant', text: '这是一餐。' }] } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string), content = body.messages[1].content;
      expect(content).toHaveLength(3); expect(content[0].text).toContain('上一餐'); expect(content[0].text).not.toContain('base64');
      for (const item of content.slice(1)) { const data = Buffer.from(item.image_url.url.split(',')[1], 'base64'); expect((await sharp(data).metadata()).exif).toBeUndefined(); }
      fetcher.mockClear();
      for (const imageBase64 of [Buffer.from('not a jpeg').toString('base64'), (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64')]) {
        expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: { ...input, imageBase64 } })).statusCode).toBe(415);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.skipIf(!existsSync(new URL('../../web/dist/index.html', import.meta.url)))('开发环境同一地址可打开已构建页面，未知API仍返回JSON404', async () => {
    const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock', NODE_ENV: 'development' }) });
    try { const page = await app.inject('/'); expect(page.statusCode).toBe(200); expect(page.headers['content-type']).toContain('text/html'); expect(page.body).toContain('食刻'); expect((await app.inject('/api/not-found')).statusCode).toBe(404); }
    finally { await app.close(); }
  });
  it('Mock明确标识；拒绝任意模型、Key字段、过长文本及非法日期', async () => {
    const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock' }) });
    try {
      const result = await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: input }); expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ mode: 'mock', draft: { foods: [{ name: '肉包', amount: 2, unit: '个' }] } });
      for (const payload of [{ ...input, modelId: 'https://evil.test' }, { ...input, apiKey: 'do-not-accept' }, { ...input, date: '2026-02-30' }, { ...input, text: '字'.repeat(1001) }]) expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('助手与拍照共用分钟保护，缺Origin也不能绕过访问保护', async () => {
    const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock', AI_REQUESTS_PER_MINUTE: '1' }) });
    const protectedApp = await buildApp({ config: loadConfig({ AI_MODE: 'mock', APP_ACCESS_CODE: 'test-access-code-long', APP_TOKEN_SECRET: 't'.repeat(40) }) });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: input })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: input })).statusCode).toBe(429);
      expect((await protectedApp.inject({ method: 'POST', url: '/api/meal-assistant', payload: input })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: input, headers: { origin: 'https://evil.test' } })).statusCode).toBe(403);
    } finally { await app.close(); await protectedApp.close(); }
  });
  it('固定DeepSeek端点、JSON校验与原草稿上下文；不把密钥交给模型正文', async () => {
    const draft = { date: input.date, mealType: input.mealType, foods: [{ name: '肉包', amount: 3, unit: '个' }], message: '已改为三个，请确认保存。' };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] })));
    const app = await buildApp({ config: loadConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-only-key', AI_MODE: 'live' }), fetchImpl: fetcher as typeof fetch });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/meal-assistant', payload: { ...input, text: '包子改三个', previous: draft } });
      expect(response.statusCode).toBe(200); expect(response.json().draft.foods[0].amount).toBe(3);
      const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe('https://api.deepseek.com/chat/completions'); expect(init.redirect).toBe('error'); expect(init.body).not.toContain('test-only-key'); expect(JSON.parse(init.body as string).messages[1].content).toContain('previous');
    } finally { await app.close(); }
  });
});
