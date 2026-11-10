import { describe, expect, it } from 'vitest';
import { assistantRequestSchema, assistantDraftSchema, parseAssistantDraft, assistantBody, mockAssistant, typicalPortion, portionAmount } from '../src/index.js';
const input = { text: '早餐两个肉包', date: '2026-10-20', mealType: 'breakfast' as const };
describe('文字记餐的结构边界与参考份量', () => {
  it('保留盒包量词及用户说明或AI估计的每单位大小，不允许在g上再乘单份大小', () => {
    const draft = { intent: 'estimate', date: input.date, mealType: input.mealType, message: '单包大小为AI估计，请核对。', foods: [{ name: '好丽友派', amount: 2, unit: '包', portionEstimate: { amountPerUnit: 34, basis: 'g', source: 'ai', assumption: '按单独小包估计，规格未知' } }] };
    expect(assistantDraftSchema.safeParse(draft).success).toBe(true);
    expect(assistantDraftSchema.safeParse({ ...draft, foods: [{ ...draft.foods[0], unit: 'g' }] }).success).toBe(false);
  });
  it('热量查询允许estimate返回食物，普通问答和清空仍不能夹带食物', () => {
    const draft = { ...input, intent: 'estimate', message: '按本地食品库估算，不会记录。', foods: [{ name: '米饭', amount: 150, unit: 'g' }] };
    const { text, ...result } = draft;
    expect(assistantDraftSchema.safeParse(result).success).toBe(true);
    for (const intent of ['question', 'clear']) expect(assistantDraftSchema.safeParse({ ...result, intent }).success).toBe(false);
    expect(mockAssistant({ ...input, text: '两个包子多少热量' }).intent).toBe('estimate');
  });
  it('最新本地热量快照进入各平台上下文，未知热量不填0，拒绝非法或无界快照', () => {
    const snapshot = { scope: 'draft', date: input.date, mealType: input.mealType, mode: 'live', knownEnergyKcal: 195, missingEnergyItems: 1, items: [
      { name: '米饭', portion: '150 g', energyKcal: 195, source: '测试食品库', assumptions: [] },
      { name: '未知菜', portion: '1份 · 约200g', energyKcal: null, source: '待补充', assumptions: ['参考份量，未称重'] },
    ] };
    const request = { ...input, text: '这餐热量多少', nutrition: [snapshot] };
    expect(assistantRequestSchema.safeParse(request).success).toBe(true);
    const body = assistantBody('qwen', 'qwen3.7-flash', request as any) as any;
    expect(JSON.parse(body.messages[1].content).nutrition).toEqual([snapshot]);
    expect(JSON.parse((assistantBody('gemini', 'gemini-3.5-flash-lite', request as any) as any).input[0].text).nutrition).toEqual([snapshot]);
    for (const nutrition of [Array(3).fill(snapshot), [{ ...snapshot, items: Array(11).fill(snapshot.items[0]) }], [{ ...snapshot, items: [{ ...snapshot.items[0], energyKcal: -1 }] }], [{ ...snapshot, knownEnergyKcal: 0 }], [{ ...snapshot, missingEnergyItems: 0 }]]) {
      expect(assistantRequestSchema.safeParse({ ...input, nutrition }).success).toBe(false);
    }
  });
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
  it('图片和历史描述保持编号对应，图片走视觉内容块而非文本JSON', () => {
    const request = { ...input, text: '和上一张比较', imageBase64: '/9j/AA==', history: [{ role: 'user' as const, text: '昨天的午饭', imageBase64: '/9j/AQ==' }, { role: 'assistant' as const, text: '可以补充蔬菜' }] };
    for (const [provider, model] of [['deepseek', 'deepseek-flash'], ['glm', 'glm-5.3-flash'], ['qwen', 'qwen3.7-flash'], ['siliconflow', 'Qwen/Qwen3.5-4B'], ['openrouter', 'nvidia/nemotron-3.5-super-vl:free']] as const) {
      const body = assistantBody(provider, model, request) as any, content = body.messages[1].content;
      expect(content).toHaveLength(3); expect(content[1].image_url.url).toBe('data:image/jpeg;base64,/9j/AQ=='); expect(content[2].image_url.url).toBe('data:image/jpeg;base64,/9j/AA==');
      expect(JSON.parse(content[0].text)).toMatchObject({ imageNumber: 2, history: [{ role: 'user', text: '昨天的午饭', imageNumber: 1 }, { role: 'assistant', text: '可以补充蔬菜' }] });
      expect(content[0].text).not.toContain('/9j/'); expect(body).not.toHaveProperty('tools');
    }
    const gemini = assistantBody('gemini', 'gemini-3.5-flash-lite', request) as any;
    expect(gemini.input[1]).toEqual({ type: 'image', mime_type: 'image/jpeg', data: '/9j/AQ==' }); expect(gemini.store).toBe(false);
  });
  it('支持只发图片，拒绝空输入、系统角色、网址图片、超量图片与上下文；Mock不假装看图', () => {
    expect(assistantRequestSchema.safeParse({ ...input, text: '', imageBase64: '/9j/AA==' }).success).toBe(true);
    const turn = { role: 'user', text: '', imageBase64: '/9j/AA==' };
    for (const value of [{ text: '' }, { imageBase64: 'https://evil.test/photo.jpg' }, { history: [{ ...turn, role: 'system' }] }, { history: [{ ...turn, role: 'assistant' }] }, { history: Array(7).fill({ role: 'user', text: '你好' }) }, { history: Array(3).fill(turn), imageBase64: '/9j/AA==' }]) expect(assistantRequestSchema.safeParse({ ...input, ...value }).success).toBe(false);
    expect(mockAssistant({ ...input, imageBase64: '/9j/AA==' })).toMatchObject({ intent: 'question', foods: [], message: expect.stringContaining('不能分析照片') });
  });
  it.each([['肉包', 80], ['米饭', 150], ['鸡蛋', 50], ['牛奶', 250], ['鸡蛋炒饭', 250], ['花生油', 10]])('%s的参考份量为不同食物类型，保留估算说明', (name, amount) => {
    const portion = typicalPortion(name as string); expect(portionAmount(portion)).toBe(amount); expect(portion.assumption).toContain('未称重');
  });
});
