import { describe, expect, it } from 'vitest';
import { offlineAssistantInput, parseOfflineAssistantDraft, type AssistantDraft, type AssistantRequest } from '../src/index.js';
const input: AssistantRequest = { text: '午餐吃了两个鸡蛋、一碗米饭和一杯牛奶。', date: '2026-10-27', mealType: 'breakfast' };
const draft: AssistantDraft = { intent: 'update', date: input.date, mealType: 'lunch', foods: [{ name: '鸡蛋', amount: 2, unit: '个' }, { name: '米饭', amount: 1, unit: '碗' }, { name: '牛奶', amount: 1, unit: '杯' }], message: '已保存。' };
describe('离线记餐契约', () => {
  it('固定日期餐次，数量字段可用于草稿，保存文案由程序决定', () => {
    const value = offlineAssistantInput(input);
    expect(value.schema.properties.date.const).toBe(input.date);
    expect(value.schema.properties.mealType.const).toBe('lunch');
    const result = parseOfflineAssistantDraft(JSON.stringify(draft), input);
    expect(result.foods).toEqual(draft.foods); expect(result.message).toContain('待核对'); expect(result.message).not.toContain('已保存');
  });
  it('用户回传的自然语言复述不能当成结构化记餐成功', () => {
    expect(() => parseOfflineAssistantDraft('午餐吃了两个鸡蛋，一碗米饭，一杯牛奶。', input)).toThrow('无效JSON');
  });
  it('已有草稿保留日期餐次，明确修改餐次可覆盖', () => {
    expect(offlineAssistantInput({ ...input, text: '鸡蛋改成一个', previous: { ...draft, date: '2026-10-25', mealType: 'dinner' } })).toMatchObject({ date: '2026-10-25', mealType: 'dinner' });
    expect(offlineAssistantInput({ ...input, text: '把午餐改成晚餐', previous: draft }).mealType).toBe('dinner');
  });
  it.each([['昨天午餐吃了鸡蛋', '2026-03-01', '2026-02-28', 'lunch'], ['前天吃了鸡蛋', '2024-03-01', '2024-02-28', 'breakfast'], ['昨晚吃了鸡蛋', '2026-01-01', '2025-12-31', 'dinner'], ['今天吃了鸡蛋', '2026-10-27', '2026-10-27', 'breakfast']])('相对日期按选定日计算：%s', (text, date, expected, mealType) => {
    expect(offlineAssistantInput({ ...input, text, date })).toMatchObject({ date: expected, mealType });
  });
  it('拒绝多餐、日期歧义及过大上下文，不静默截断本次输入', () => {
    for (const text of ['早餐吃鸡蛋，午餐吃米饭', '昨天和今天午餐吃鸡蛋', '2026-10-26及2026-10-27吃鸡蛋', '字'.repeat(601)]) expect(() => offlineAssistantInput({ ...input, text })).toThrow();
    const previous = { ...draft, foods: Array.from({ length: 10 }, (_, i) => ({ name: `${i}${'菜'.repeat(98)}`, amount: 1, unit: '份' as const })) };
    expect(() => offlineAssistantInput({ ...input, text: '字'.repeat(600), previous, history: [{ role: 'user', text: '字'.repeat(1000) }, { role: 'assistant', text: '字'.repeat(1000) }] })).toThrow('上下文');
  });
  it('拒绝当前或历史图片，不能悄悄丢图或切在线服务', () => {
    for (const request of [{ ...input, imageBase64: '/9j/AA==' }, { ...input, history: [{ role: 'user' as const, text: '这张', imageBase64: '/9j/AA==' }] }]) expect(() => offlineAssistantInput(request)).toThrow('只支持文字');
  });
  it('拒绝截断、围栏、额外热量、数量字符串/负数和非法单位', () => {
    for (const text of [JSON.stringify(draft).slice(0, -1), `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``, JSON.stringify({ ...draft, energyKcal: 500 }), ...[{ amount: -1 }, { amount: '2' }, { amount: 20001 }, { unit: '瓶' }, { energyKcal: 100 }].map(change => JSON.stringify({ ...draft, foods: [{ ...draft.foods[0], ...change }] }))]) expect(() => parseOfflineAssistantDraft(text, input)).toThrow();
  });
  it('错误日期、空更新、缺少intent和食物超过10项均拒绝', () => {
    const { intent, ...withoutIntent } = draft;
    for (const value of [{ ...draft, date: '2026-10-26' }, { ...draft, mealType: 'dinner' }, { ...draft, foods: [] }, withoutIntent, { ...draft, foods: Array(11).fill(draft.foods[0]) }]) expect(() => parseOfflineAssistantDraft(JSON.stringify(value), input)).toThrow();
  });
  it('问答不夹带新增食物，计划与疑问不能误当update', () => {
    const question = { ...draft, intent: 'question', foods: [], message: '请说明具体做法。' };
    expect(parseOfflineAssistantDraft(JSON.stringify(question), { ...input, text: '午餐怎么搭配？', previous: draft }).intent).toBe('question');
    expect(() => parseOfflineAssistantDraft(JSON.stringify({ ...draft, intent: 'question' }), input)).toThrow();
    for (const text of ['午餐怎么搭配？', '午餐打算吃鸡蛋']) expect(() => parseOfflineAssistantDraft(JSON.stringify(draft), { ...input, text })).toThrow('区分问答');
    expect(() => parseOfflineAssistantDraft(JSON.stringify(draft), { ...input, text: '记录明天午餐的鸡蛋' })).toThrow('未来计划');
  });
  it('修改仅返回完整新草稿，原对象不被解析器改动', () => {
    const before = JSON.stringify(draft), changed = { ...draft, foods: [{ ...draft.foods[0]!, amount: 1 }, draft.foods[1]!] };
    const result = parseOfflineAssistantDraft(JSON.stringify(changed), { ...input, text: '鸡蛋改成一个，去掉牛奶', previous: draft });
    expect(result.foods).toHaveLength(2); expect(result.foods[0]!.amount).toBe(1); expect(JSON.stringify(draft)).toBe(before);
  });
  it('清空整餐必须有明确指令，删单项不能误清空', () => {
    const clear = JSON.stringify({ ...draft, intent: 'clear', foods: [] });
    expect(parseOfflineAssistantDraft(clear, { ...input, text: '取消这餐', previous: draft }).message).toContain('历史记录不变');
    expect(() => parseOfflineAssistantDraft(clear, { ...input, text: '去掉牛奶', previous: draft })).toThrow('清空整餐');
  });
  it('真机回报的2g/1g/1g应由原文恢复为2个/1碗/1杯，不用估重反推', () => {
    const wrong = { ...draft, foods: draft.foods.map(food => ({ ...food, unit: 'g' })) };
    expect(parseOfflineAssistantDraft(JSON.stringify(wrong), input).foods).toEqual(draft.foods);
  });
  it('即使模型把数量也换算了，仍以用户明确的数量和单位为准', () => {
    const wrong = { ...draft, foods: draft.foods.map(food => ({ ...food, amount: 100, unit: 'g' })) };
    expect(parseOfflineAssistantDraft(JSON.stringify(wrong), input).foods).toEqual(draft.foods);
  });
  it.each([
    ['鸡蛋2个', '鸡蛋', 2, '个'], ['半碗米饭', '米饭', 0.5, '碗'], ['米饭一碗半', '米饭', 1.5, '碗'],
    ['两个的鸡蛋', '鸡蛋', 2, '个'], ['鸡蛋十二个', '鸡蛋', 12, '个'], ['鸡蛋一百零二个', '鸡蛋', 102, '个'],
    ['米饭123.45克', '米饭', 123.45, 'g'], ['米饭0.5千克', '米饭', 500, 'g'], ['米饭1公斤', '米饭', 1000, 'g'],
    ['牛奶250毫升', '牛奶', 250, 'ml'], ['牛奶0.25升', '牛奶', 250, 'ml'], ['牛奶250mL', '牛奶', 250, 'ml'],
    ['香蕉两根', '香蕉', 2, '根'], ['吐司三片', '吐司', 3, '片'], ['豆腐一块', '豆腐', 1, '块'],
  ])('明确计量优先且只做标准换算：%s', (text, name, amount, unit) => {
    const result = parseOfflineAssistantDraft(JSON.stringify({ ...draft, foods: [{ name, amount: 1, unit: 'g' }] }), { ...input, text, mealType: 'lunch' });
    expect(result.foods).toEqual([{ name, amount, unit }]);
  });
  it('改数量时纠正错误单位，未改动的米饭沿用原碗数，原草稿不变', () => {
    const wrong = { ...draft, foods: [{ name: '鸡蛋', amount: 1, unit: 'g' }, { name: '米饭', amount: 1, unit: 'g' }] };
    const before = JSON.stringify(draft);
    expect(parseOfflineAssistantDraft(JSON.stringify(wrong), { ...input, text: '鸡蛋改成一个，去掉牛奶', previous: draft }).foods).toEqual([{ name: '鸡蛋', amount: 1, unit: '个' }, draft.foods[1]]);
    expect(JSON.stringify(draft)).toBe(before);
  });
  it.each(['把两个鸡蛋改成一个', '鸡蛋2个改成1个'])('明确更正采用改后数量：%s', text => {
    const result = parseOfflineAssistantDraft(JSON.stringify({ ...draft, foods: [{ name: '鸡蛋', amount: 2, unit: 'g' }] }), { ...input, text, previous: draft });
    expect(result.foods).toEqual([{ name: '鸡蛋', amount: 1, unit: '个' }]);
  });
  it('没说数量保持未知，不接收模型猜出的克数；别项的杯数不套到鸡蛋', () => {
    const wrong = { ...draft, foods: [{ name: '鸡蛋', amount: 50, unit: 'g' }, { name: '牛奶', amount: 1, unit: 'g' }] };
    expect(parseOfflineAssistantDraft(JSON.stringify(wrong), { ...input, text: '午餐吃了鸡蛋和一杯牛奶' }).foods).toEqual([{ name: '鸡蛋', amount: null, unit: '份' }, { name: '牛奶', amount: 1, unit: '杯' }]);
  });
  it('新餐没给数量不沿用上一餐数量；只改餐次仍保留原份量', () => {
    const foods = [{ name: '鸡蛋', amount: 50, unit: 'g' }];
    expect(parseOfflineAssistantDraft(JSON.stringify({ ...draft, foods }), { ...input, text: '新的一餐吃了鸡蛋', previous: draft }).foods).toEqual([{ name: '鸡蛋', amount: null, unit: '份' }]);
    expect(parseOfflineAssistantDraft(JSON.stringify({ ...draft, mealType: 'dinner', foods }), { ...input, text: '晚餐吃了鸡蛋', previous: draft }).foods).toEqual([{ name: '鸡蛋', amount: null, unit: '份' }]);
    expect(parseOfflineAssistantDraft(JSON.stringify({ ...draft, mealType: 'dinner' }), { ...input, text: '把午餐改成晚餐', previous: draft }).foods).toEqual(draft.foods);
  });
  it.each(['牛奶1杯250ml', '一杯牛奶250ml', '牛奶一杯，牛奶两杯', '一瓶牛奶', '牛奶一盒', '牛奶一百二杯', '牛奶30000ml', '再来两杯', '牛奶-1杯', '牛奶一到两杯', '牛奶减少一杯', '牛奶减半', '牛奶一二杯'])('单位或数量存在歧义时拒绝并保留旧草稿：%s', text => {
    expect(() => parseOfflineAssistantDraft(JSON.stringify({ ...draft, foods: [{ name: '牛奶', amount: 1, unit: 'g' }] }), { ...input, text, previous: draft })).toThrow('数量和单位');
  });
});
