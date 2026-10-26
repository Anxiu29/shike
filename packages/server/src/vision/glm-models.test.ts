import { describe, expect, it, vi } from 'vitest';
import { GlmVisionService } from './glm.js';
import { loadConfig } from '../config.js';
import { createVisionService } from './index.js';

const model = 'glm-4.1v-thinking-flash';
const image = { mimeType: 'image/jpeg' as const, data: Buffer.from('synthetic-test-image') };
describe('GLM4.1V与精确错误提示', () => {
  it.each(['glm-5.3-flash', 'glm-5.3-flashx'])('资源包视觉%s不沿用关闭思考，只解析完整最终答案且不自动改型号', async model => {
    const answer = { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] };
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { reasoning_content: '{"isFood":false}', content: JSON.stringify(answer) } }] })));
    const config = loadConfig({ AI_PROVIDER: 'glm', AI_MODE: 'live', ZHIPU_API_KEY: 'fake-test-key', GLM_MODEL: model });
    const service = createVisionService(config, network); expect(network).not.toHaveBeenCalled();
    expect((await service.recognize(image)).foods[0]!.name).toBe('米饭');
    const [url, init] = network.mock.calls[0]!; expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    expect(JSON.parse(init!.body as string)).toMatchObject({ model, thinking: { type: 'enabled' }, reasoning_effort: 'low', temperature: 1, top_p: 0.95, response_format: { type: 'json_object' }, max_tokens: 8192 });
    network.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(answer) } }] })));
    await expect(service.recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' }); expect(network).toHaveBeenCalledTimes(2);
    network.mockResolvedValue(new Response(JSON.stringify({ error: { code: '1308' } }), { status: 429 }));
    await expect(service.recognize(image)).rejects.toMatchObject({ message: expect.stringContaining('使用上限') }); expect(network).toHaveBeenCalledTimes(3);
  });
  it('默认保留免费4.6V，显式选择4.1V并注册同Key的五个选项', async () => {
    const env = { AI_PROVIDER: 'glm', AI_MODE: 'live', ZHIPU_API_KEY: 'fake-test-key' };
    expect(loadConfig(env).model).toBe('glm-4.6v-flash');
    const config = loadConfig({ ...env, GLM_MODEL: model });
    expect(config.modelProfiles?.map(p => p.model)).toEqual([model, 'glm-4.6v-flash', 'glm-4.6v-flashx', 'glm-5.3-flash', 'glm-5.3-flashx']);
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { reasoning_content: 'ignored', content: '<think>分析</think><answer>' + JSON.stringify({ isFood: false, foods: [], uncertainties: ['测试图不是食物'] }) + '</answer>' } }] })));
    const service = createVisionService(config, network);
    expect(service.model).toBe(model); expect((await service.recognize(image)).isFood).toBe(false);
    const [url, init] = network.mock.calls[0]!; const body = JSON.parse(init!.body as string);
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions'); expect(init!.redirect).toBe('error');
    expect(body).toMatchObject({ model, temperature: 0.2, max_tokens: 8192 });
    expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('response_format');
    expect(body.messages[0].content).toContain('输出格式复核'); expect(network).toHaveBeenCalledTimes(1);
    expect(() => loadConfig({ ...env, GLM_MODEL: 'glm-5.3-flashx-legal' })).toThrow('GLM_MODEL');
    expect(() => loadConfig({ OPENROUTER_MODEL: 'google/gemma-4-31b-it:free' })).toThrow('OPENROUTER_MODEL');
  });
  it('只有选用FlashX才发单次付费请求，固定端点与关闭思考，余额失败不自动回退', async () => {
    const paid = 'glm-4.6v-flashx';
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] }) } }] })));
    const config = loadConfig({ AI_PROVIDER: 'glm', AI_MODE: 'live', ZHIPU_API_KEY: 'fake-test-key', GLM_MODEL: paid });
    expect(network).not.toHaveBeenCalled();
    const service = createVisionService(config, network); expect(network).not.toHaveBeenCalled();
    expect((await service.recognize(image)).foods[0]!.name).toBe('米饭');
    const [url, init] = network.mock.calls[0]!; const body = JSON.parse(init!.body as string);
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions'); expect(init!.redirect).toBe('error');
    expect(body).toMatchObject({ model: paid, thinking: { type: 'disabled' }, temperature: 0.2, max_tokens: 8192 });
    expect(body).not.toHaveProperty('response_format'); expect(body).not.toHaveProperty('models'); expect(network).toHaveBeenCalledTimes(1);
    network.mockResolvedValue(new Response(JSON.stringify({ error: { code: '1113', message: 'private-account-data' } }), { status: 429 }));
    await expect(service.recognize(image)).rejects.toMatchObject({ message: expect.stringContaining('欠费（1113）') });
    expect(network).toHaveBeenCalledTimes(2);
    network.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })));
    await expect(service.recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' }); expect(network).toHaveBeenCalledTimes(3);
  });
  it.each([[429, '1305', '访问量过大'], [429, 1302, '请求过于频繁'], [429, '1113', '欠费'], [400, '1211', '不存在'], [400, '1221', '下线']])('只读取固定智谱端点的错误码：%s/%s', async (status, code, expected) => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code, message: 'private-response-secret-key' } }), { status: Number(status) }));
    try { await new GlmVisionService('fake', 1000, network, model).recognize(image); throw new Error('应失败'); }
    catch (error) { expect((error as Error).message).toContain(expected); expect((error as Error).message).not.toContain('private-response'); }
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each(['not-json-private', ' '.repeat(16385), JSON.stringify({ error: { code: 'unknown-private', message: 'private' } })])('无效、过大或未知错误体只显示安全HTTP提示', async body => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429 }));
    await expect(new GlmVisionService('fake', 1000, network, model).recognize(image)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', message: expect.stringContaining('请求受限（429）') });
  });
});
