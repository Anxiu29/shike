import { describe, expect, it } from 'vitest';
import { compatibleVisionEndpoint, compatibleVisionOptions, compatibleVisionResponseFormat, personalModelUsageNotice, supportsStructuredVisionOutput, openRouterVisionModels, recognitionJsonSchema, assistantBody, assistantJsonSchema, personalModelInfo, personalProfileSchema, personalProfileModels, personalModelSelection, createPackageEntry, emptyPackageLabel, packageFromEntry, backupSchema } from '../src/index.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('新增免费视觉模型的边界', () => {
  it.each(['nvidia/nemotron-3.5-super-vl:free', 'dots-studio/dots-3-note-preview:free'])('新型号%s复用一把Key，视觉和文字使用结构化输出并保留本地校验', model => {
    const group = personalProfileSchema.parse({ id, label: '免费视觉', provider: 'openrouter', model, models: [...openRouterVisionModels] });
    expect(personalProfileModels(group)).toHaveLength(2);
    expect(compatibleVisionEndpoint('openrouter', model)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(supportsStructuredVisionOutput('openrouter', model)).toBe(true);
    expect(compatibleVisionResponseFormat('openrouter', model, recognitionJsonSchema)).toEqual({ type: 'json_schema', json_schema: { name: 'shike_result', strict: true, schema: recognitionJsonSchema } });
    const body = assistantBody('openrouter', model, { text: '午餐一碗米饭', date: '2026-10-24', mealType: 'lunch' });
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'shike_result', strict: true, schema: assistantJsonSchema } });
    expect(JSON.stringify(body)).toContain('max_price');
  });
  it('跳过线路异常、参数未匹配和内容审核型号；不接受付费同名变体', () => {
    for (const model of ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'nvidia/nemotron-3.5-content-safety:free', 'thinkingmachines/inkling:free', 'nvidia/nemotron-3.5-super-vl', 'dots-studio/dots-3-note-preview']) {
      expect(personalProfileSchema.safeParse({ id, label: '不适配', provider: 'openrouter', model }).success).toBe(false);
      expect(() => compatibleVisionEndpoint('openrouter', model)).toThrow();
    }
    for (const model of ['google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free']) { expect(() => compatibleVisionEndpoint('openrouter', model)).toThrow(); expect(personalProfileSchema.safeParse({ id, label: '已移除', provider: 'openrouter', model }).success).toBe(false); }
    expect(personalModelUsageNotice('openrouter', openRouterVisionModels[0])).toContain('记录请求');
    expect(personalModelInfo('openrouter', openRouterVisionModels[1]).note).toContain('2026-12-31');
  });
  it('一把Key的模型分组保留旧单模型兼容，拒绝跨平台、重复和未入组的当前模型', () => {
    const old = personalProfileSchema.parse({ id, label: '百炼Key', provider: 'qwen', model: 'qwen3.7-flash' });
    expect(personalProfileModels(old)).toEqual(['qwen3.7-flash']); expect(personalModelSelection(old)).toBe(id);
    const group = personalProfileSchema.parse({ ...old, models: ['qwen3.7-flash', 'qwen3-vl-plus'] });
    expect(personalProfileModels(group)).toHaveLength(2); expect(personalModelSelection(group, 'qwen3-vl-plus')).toBe(id + '::qwen3-vl-plus');
    for (const models of [[], ['qwen3-vl-plus'], ['qwen3.7-flash', 'gemini-3.5-flash-lite'], ['qwen3.7-flash', 'qwen3.7-flash']]) expect(personalProfileSchema.safeParse({ ...old, models }).success).toBe(false);
  });
  it('拒绝付费同名变体、随机路由器及跨平台模型；精确保留白名单', () => {
    for (const model of ['google/gemma-4-31b-it', 'openrouter/free', 'https://evil.test/model']) expect(personalProfileSchema.safeParse({ id, label: '测试', provider: 'openrouter', model }).success).toBe(false);
    expect(() => compatibleVisionEndpoint('siliconflow', 'google/gemma-4-31b-it:free')).toThrow();
    expect(compatibleVisionEndpoint('siliconflow', 'Qwen/Qwen3.5-4B')).toBe('https://api.siliconflow.cn/v1/chat/completions');
    expect(personalProfileSchema.safeParse({ id, label: '视觉专用', provider: 'qwen', model: 'qwen3-vl-plus' }).success).toBe(true);
  });
  it('只允许零价格路由，免费与赠送额度文案有区别', () => {
    expect(compatibleVisionOptions('openrouter')).toMatchObject({ provider: { allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } } });
    expect(personalModelInfo('qwen', 'qwen3-vl-plus').note).toContain('用完即停');
    expect(personalModelInfo('openrouter', openRouterVisionModels[0]).note).toContain('转交上游');
  });
  it('DeepSeek仅接当前视觉Flash，明确计费并使用独立参数与固定地址', () => {
    expect(personalProfileSchema.safeParse({ id, label: 'DeepSeek', provider: 'deepseek', model: 'deepseek-flash' }).success).toBe(true);
    for (const model of ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash-vision-exp', 'https://evil.test']) {
      expect(personalProfileSchema.safeParse({ id, label: 'DeepSeek', provider: 'deepseek', model }).success).toBe(false);
      expect(() => compatibleVisionEndpoint('deepseek', model)).toThrow();
    }
    expect(compatibleVisionEndpoint('deepseek', 'deepseek-flash')).toBe('https://api.deepseek.com/chat/completions');
    expect(compatibleVisionOptions('deepseek')).toEqual({ thinking: { type: 'disabled' } });
    expect(personalModelInfo('deepseek', 'deepseek-flash').badge).toBe('按量计费');
  });
  it.each(['siliconflow', 'openrouter', 'deepseek'] as const)('新来源%s的包装营养能存库与备份，不伪装旧提供商', provider => {
    const entry = createPackageEntry('测试牛奶', { ...emptyPackageLabel(), basis: '100ml', energy: { value: 60, unit: 'kcal' } }, provider, 'test-model');
    const packaged = packageFromEntry(entry, '测试品牌', null);
    const backup = backupSchema.parse({ schemaVersion: 10, exportedAt: '2026-10-20T04:00:00.000Z', meals: [], weights: [], water: [], exercises: [], dailyPlans: [], estimatedFoods: [], libraryFoods: [], packagedFoods: [packaged], settings: { targetWeightKg: null } });
    expect(backup.packagedFoods[0]!.provider).toBe(provider);
  });
});
