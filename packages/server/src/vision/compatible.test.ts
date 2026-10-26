import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { createVisionService } from './index.js';
import { CompatibleVisionService } from './compatible.js';
import { recognitionJsonSchema, supportsStructuredVisionOutput } from '@shike/shared';

describe('硅基流动、OpenRouter及DeepSeek兼容接口', () => {
  it.each([
    ['siliconflow', 'Qwen/Qwen3.5-4B', 'https://api.siliconflow.cn/v1/chat/completions'],
    ['openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'https://openrouter.ai/api/v1/chat/completions'],
    ['openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'https://openrouter.ai/api/v1/chat/completions'],
    ['openrouter', 'dots-studio/dots-3-note-preview:free', 'https://openrouter.ai/api/v1/chat/completions'],
    ['deepseek', 'deepseek-flash', 'https://api.deepseek.com/chat/completions'],
  ] as const)('向%s固定端点传图片，JSON校验后输出且不自动转发', async (provider, model, endpoint) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ isFood: false, foods: [], uncertainties: ['非食物测试图'] }) } }] }), { status: 200 }));
    const service = new CompatibleVisionService(provider, model, 'test-secret-only', 1000, fetcher as typeof fetch);
    expect((await service.recognize({ mimeType: 'image/jpeg', data: Buffer.from('test-image') })).foods).toEqual([]);
    const args = fetcher.mock.calls[0] as unknown as [string, RequestInit], body = JSON.parse(args[1].body as string);
    expect(args[0]).toBe(endpoint); expect(body.model).toBe(model); expect(body.messages[1].content[1].image_url).toMatchObject({ url: `data:image/jpeg;base64,${Buffer.from('test-image').toString('base64')}` });
    expect(args[1].redirect).toBe('error'); expect(JSON.stringify(body)).not.toContain('test-secret-only');
    expect(args[1].headers).toMatchObject({ Authorization: 'Bearer test-secret-only' });
    if (supportsStructuredVisionOutput(provider, model)) expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'shike_result', strict: true, schema: recognitionJsonSchema } });
    else expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toMatch(/json/i);
    if (provider === 'openrouter') expect(body.provider).toMatchObject({ max_price: { prompt: 0, completion: 0, request: 0 }, allow_fallbacks: false });
    else if (provider === 'deepseek') { expect(body.thinking).toEqual({ type: 'disabled' }); expect(body).not.toHaveProperty('enable_thinking'); expect(body).not.toHaveProperty('provider'); }
    else expect(body.enable_thinking).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('新增服务端Key只注册对应模型，缺Key仍用明确Mock，不接受任意免费变体', () => {
    const config = loadConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key', AI_MODE: 'live' });
    expect(config.modelProfiles).toHaveLength(2); expect(createVisionService(config)).toMatchObject({ provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' });
    expect(createVisionService(loadConfig({ AI_PROVIDER: 'siliconflow' })).mode).toBe('mock');
    expect(() => loadConfig({ OPENROUTER_MODEL: 'google/gemma-4-31b-it' })).toThrow('OPENROUTER_MODEL');
  });
  it.each([403, 404])('新增免费型号遇到HTTP %s直接失败，不换付费端点或泄露原文', async status => {
    const fetcher = vi.fn(async () => new Response('private-upstream-detail', { status }));
    await expect(new CompatibleVisionService('openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'test-key', 1000, fetcher as typeof fetch).recognize({ mimeType: 'image/jpeg', data: Buffer.from('test') })).rejects.toMatchObject({ message: expect.not.stringContaining('private-upstream-detail') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('DeepSeek环境配置只暴露白名单模型，缺Key可Mock，live不伪装成功', () => {
    const config = loadConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'deepseek-test-key', AI_MODE: 'live' });
    expect(config.modelProfiles).toEqual([{ id: 'deepseek:deepseek-flash', provider: 'deepseek', model: 'deepseek-flash', apiKey: 'deepseek-test-key' }]);
    expect(createVisionService(config)).toMatchObject({ mode: 'live', provider: 'deepseek', model: 'deepseek-flash' });
    expect(createVisionService(loadConfig({ AI_PROVIDER: 'deepseek' })).mode).toBe('mock');
    expect(() => loadConfig({ AI_PROVIDER: 'deepseek', AI_MODE: 'live' })).toThrow('API Key');
  });
  it('DeepSeek拒绝空输出、余额不足与超时，不泄露上游正文或自动重试', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })));
    await expect(new CompatibleVisionService('deepseek', 'deepseek-flash', 'test-key', 1000, empty as typeof fetch).recognize({ data: Buffer.from('image'), mimeType: 'image/jpeg' })).rejects.toThrow();
    expect(empty).toHaveBeenCalledTimes(1);
    const denied = vi.fn(async () => new Response('secret-upstream-body', { status: 402 }));
    await expect(new CompatibleVisionService('deepseek', 'deepseek-flash', 'test-key', 1000, denied as typeof fetch).recognize({ data: Buffer.from('image'), mimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'AI_BALANCE_INSUFFICIENT', message: expect.stringContaining('余额') });
    expect(denied).toHaveBeenCalledTimes(1);
    const never = vi.fn(() => new Promise<Response>(() => {}));
    await expect(new CompatibleVisionService('deepseek', 'deepseek-flash', 'test-key', 10, never as typeof fetch).recognize({ data: Buffer.from('image'), mimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(never).toHaveBeenCalledTimes(1);
  });
  it('无效JSON、截断和429均失败，保留一次调用语义而非换模型重试', async () => {
    for (const data of [{ choices: [{ finish_reason: 'stop', message: { content: 'invalid' } }] }, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(data)));
      await expect(new CompatibleVisionService('siliconflow', 'Qwen/Qwen3.5-4B', 'test-key', 1000, fetcher as typeof fetch).recognize({ data: Buffer.from('test'), mimeType: 'image/jpeg' })).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const limited = vi.fn(async () => new Response('do-not-leak-upstream', { status: 429 }));
    await expect(new CompatibleVisionService('openrouter', 'nvidia/nemotron-3.5-super-vl:free', 'test-key', 1000, limited as typeof fetch).recognize({ data: Buffer.from('test'), mimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', statusCode: 429 });
    expect(limited).toHaveBeenCalledTimes(1);
  });
});
