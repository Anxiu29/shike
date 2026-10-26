import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { existsSync } from 'node:fs';
const input = { text: '早餐两个肉包', date: '2026-10-20', mealType: 'breakfast' };
describe('文字助手API', () => {
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
