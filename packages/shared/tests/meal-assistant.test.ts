import { describe, expect, it } from 'vitest';
import { assistantRequestSchema, assistantDraftSchema, parseAssistantDraft, assistantBody, mockAssistant, typicalPortion, portionAmount } from '../src/index.js';
const input = { text: '早餐两个肉包', date: '2026-10-20', mealType: 'breakfast' as const };
describe('文字记餐的结构边界与参考份量', () => {
  it('未说餐次采用设备传入值，已有草稿优先，明确餐次可覆盖默认值', () => {
    const request = { ...input, text: '两个肉包', mealType: 'dinner' as const };
    expect(mockAssistant(request).mealType).toBe('dinner');
    const previous = mockAssistant({ ...request, mealType: 'lunch' });
    expect(mockAssistant({ ...request, previous }).mealType).toBe('lunch');
    expect(mockAssistant({ ...request, previous, text: '早餐两个肉包' }).mealType).toBe('breakfast');
    expect(mockAssistant({ ...request, previous, text: '夜宵两个肉包' }).mealType).toBe('snack');
  });
  it('拒绝非法日期、超长输入、额外提示词字段、负数量和过多食品', () => {
    for (const data of [{ ...input, date: '2026-02-30' }, { ...input, text: '字'.repeat(1001) }, { ...input, apiKey: 'no-secret' }]) expect(assistantRequestSchema.safeParse(data).success).toBe(false);
    const draft = { date: input.date, mealType: input.mealType, message: '草稿', foods: [{ name: '肉包', amount: -1, unit: '个' }] };
    expect(assistantDraftSchema.safeParse(draft).success).toBe(false);
    expect(() => parseAssistantDraft('```json\n{}\n```')).toThrow('无效JSON');
    expect(assistantDraftSchema.safeParse({ ...draft, foods: Array.from({ length: 11 }, () => ({ name: '肉包', amount: 1, unit: '个' })) }).success).toBe(false);
  });
  it('平台参数分别处理，不上传图片、不传工具、Gemini关闭会话存储', () => {
    const body = assistantBody('deepseek', 'deepseek-flash', input);
    expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 2048 });
    expect(JSON.stringify(body)).not.toContain('image_url'); expect(body).not.toHaveProperty('tools');
    expect(assistantBody('openrouter', 'nvidia/nemotron-3.5-super-vl:free', input)).toMatchObject({ provider: { max_price: { prompt: 0, completion: 0, request: 0 } } });
    expect(assistantBody('gemini', 'gemini-3.5-flash-lite', input)).toMatchObject({ store: false, response_format: { mime_type: 'application/json' } });
  });
  it.each([['肉包', 80], ['米饭', 150], ['鸡蛋', 50], ['牛奶', 250], ['鸡蛋炒饭', 250], ['花生油', 10]])('%s的参考份量为不同食物类型，保留估算说明', (name, amount) => {
    const portion = typicalPortion(name as string); expect(portionAmount(portion)).toBe(amount); expect(portion.assumption).toContain('未称重');
  });
});
