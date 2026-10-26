import { describe, expect, it } from 'vitest';
import { assistantBody, glmChatOptions, glmBusinessErrorMessage, glmVisionModels, personalProfileSchema, personalModelInfo, personalModelUsageNotice, compatibleVisionEndpoint, glmOutputText, glmFinalAnswer, parseRecognition } from '../src/index.js';

describe('智谱视觉型号', () => {
  it.each(['glm-5.3-flash', 'glm-5.3-flashx'])('资源包型号%s开启轻度思考，JSON格式与原4.6V参数分开', model => {
    expect(compatibleVisionEndpoint('glm', model)).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    expect(glmChatOptions(model)).toEqual({ temperature: 1, top_p: 0.95, thinking: { type: 'enabled' }, reasoning_effort: 'low' });
    const body = assistantBody('glm', model, { text: '午餐一碗米饭', date: '2026-10-24', mealType: 'lunch' });
    expect(body).toMatchObject({ model, max_tokens: 4096, thinking: { type: 'enabled' }, response_format: { type: 'json_object' } });
    expect(personalModelInfo('glm', model).badge).toBe('资源包／按量');
    expect(personalModelInfo('glm', model).note).toContain('不能保证只扣赠送额度');
    expect(personalModelUsageNotice('glm', model)).toContain('用尽或过期');
  });
  it('只取4.1V完整标签的最终答案，思考中的JSON不入库，截断和额外文字仍拒绝', () => {
    const answer = JSON.stringify({ isFood: false, foods: [], uncertainties: ['非食物'] });
    const wrapped = `<think>{"isFood":true}，这里只是思考</think>\n<answer>${answer}</answer>`;
    const data = (content: string, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content } }] });
    expect(glmOutputText(data(wrapped), 'glm-4.1v-thinking-flash')).toBe(answer);
    expect(parseRecognition(glmOutputText(data(wrapped), 'glm-4.1v-thinking-flash')).isFood).toBe(false);
    expect(glmFinalAnswer(wrapped, 'glm-4.6v-flash')).toBe(wrapped);
    expect(glmFinalAnswer(answer, 'glm-4.1v-thinking-flash')).toBe(answer);
    expect(glmFinalAnswer(`<think>分析</think><answer><|begin_of_box|>${answer}<|end_of_box|></answer>`, 'glm-4.1v-thinking-flash')).toBe(answer);
    for (const value of [`<|begin_of_box|>${answer}`, `<|begin_of_box|>${answer}<|end_of_box|>extra`, `<|begin_of_box|><|begin_of_box|>${answer}<|end_of_box|><|end_of_box|>`]) expect(() => glmFinalAnswer(value, 'glm-4.1v-thinking-flash')).toThrow();
    for (const text of [`<think>abc</think>${answer}`, `<answer>${answer}`, `<answer>${answer}</answer>extra`, `<think>abc<think>def</think><answer>${answer}</answer>`, `<answer>${answer}</answer><answer>{}</answer>`]) expect(() => glmFinalAnswer(text, 'glm-4.1v-thinking-flash')).toThrow();
    expect(() => glmOutputText(data(wrapped, 'length'), 'glm-4.1v-thinking-flash')).toThrow('截断');
  });
  it('一把Key支持五款型号，不把4.6V的思考开关强加给4.1V', () => {
    const profile = personalProfileSchema.parse({ id: '11111111-1111-4111-8111-111111111111', label: '智谱Key', provider: 'glm', model: glmVisionModels[0], models: [...glmVisionModels] });
    expect(profile.models).toHaveLength(5);
    expect(glmChatOptions(glmVisionModels[0])).toEqual({ temperature: 0.2 });
    expect(glmChatOptions(glmVisionModels[1])).toEqual({ temperature: 0.2, thinking: { type: 'disabled' } });
    const body = assistantBody('glm', glmVisionModels[0], { text: '午餐一碗米饭', date: '2026-10-24', mealType: 'lunch' });
    expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('response_format');
    for (const model of ['glm-4.6v', 'glm-4.6-flashx', 'glm-5.3-flashx-legal', 'glm-4.1v-thinking']) {
      expect(() => glmChatOptions(model)).toThrow(); expect(() => compatibleVisionEndpoint('glm', model)).toThrow();
    }
  });
  it('FlashX明确按量计费、关闭思考，图片及文字都只用已选型号', () => {
    const model = 'glm-4.6v-flashx';
    expect(compatibleVisionEndpoint('glm', model)).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    expect(glmChatOptions(model)).toEqual({ temperature: 0.2, thinking: { type: 'disabled' } });
    expect(personalModelInfo('glm', model)).toMatchObject({ badge: '按量计费', note: expect.stringContaining('0.15／1.5') });
    expect(personalModelUsageNotice('glm', model)).toContain('测试连接也可能扣费');
    expect(personalModelInfo('glm', 'glm-4.6v-flash').badge).toBe('平台免费');
    const body = assistantBody('glm', model, { text: '午餐一碗米饭', date: '2026-10-24', mealType: 'lunch' });
    expect(body).toMatchObject({ model, thinking: { type: 'disabled' } }); expect(body).not.toHaveProperty('response_format');
    const old = personalProfileSchema.parse({ id: '11111111-1111-4111-8111-111111111111', label: '旧免费组', provider: 'glm', model: 'glm-4.1v-thinking-flash', models: ['glm-4.1v-thinking-flash'] });
    expect(old.models).toEqual(['glm-4.1v-thinking-flash']); expect(old.model).toBe('glm-4.1v-thinking-flash');
  });
  it('按业务码区分繁忙、账户限制和下线；不输出上游正文', () => {
    for (const [code, message] of [['1305', '访问量过大'], ['1302', '请求过于频繁'], ['1113', '欠费'], ['1308', '使用上限'], ['1310', '周或月'], ['1311', '权限'], ['1315', '编程套餐']]) expect(glmBusinessErrorMessage(429, code!)).toContain(message);
    expect(glmBusinessErrorMessage(400, '1211')).toContain('不存在'); expect(glmBusinessErrorMessage(400, '1221')).toContain('下线');
    for (const code of ['unknown-secret-text', '__proto__', 'constructor']) expect(glmBusinessErrorMessage(429, code)).toBeNull();
    expect(glmBusinessErrorMessage(403, '1305')).toBeNull();
  });
});
