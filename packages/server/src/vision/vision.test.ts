import { describe, expect, it, vi } from 'vitest';
import { GeminiVisionService } from './gemini.js';
import { GlmVisionService } from './glm.js';
import { QwenVisionService } from './qwen.js';
import { parseRecognition, geminiOutputText } from './parse.js';
import { loadConfig } from '../config.js';
import { createVisionService } from './index.js';

const mediumAssumptions = ['按清水煮白米饭，未额外加油，含水量未知。'];
const result = { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 120, visibleIngredients: [], uncertainties: [],
  estimatedNutrientsPer100g: { energyKcal: 130, proteinG: 3, fatG: 0.3, carbsG: 28 },
  nutritionAssumptions: mediumAssumptions,
  nutritionEstimateProfile: { factor: 'general', options: [
    { level: 'low', label: '含水量较高', rangesPer100g: { energyKcal: { min: 100, max: 120 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['清水煮饭较湿的参考情景。'] },
    { level: 'medium', label: '普通米饭', rangesPer100g: { energyKcal: { min: 120, max: 140 }, proteinG: { min: 2, max: 4 }, fatG: { min: 0, max: 0.6 }, carbsG: { min: 26, max: 30 } }, assumptions: mediumAssumptions },
    { level: 'high', label: '含水量较低', rangesPer100g: { energyKcal: { min: 140, max: 160 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['清水煮饭较干的参考情景。'] },
  ] },
}], uncertainties: [] };
const image = { mimeType: 'image/jpeg' as const, data: Buffer.from('test-image') };

describe('供应商适配器和 JSON 校验', () => {
  it('包装标签走同一视觉接口，保留原始kJ，不要求三档粗估', async () => {
    const content = { isFood: true, foods: [{ name: '测试饼干', estimatedWeightG: null, visibleIngredients: [], uncertainties: [],
      packageLabel: { basis: '100g', energy: { value: 2092, unit: 'kJ' }, proteinG: 8, fatG: 20, carbsG: 65, servingSize: null, netContent: { amount: 100, unit: 'g' } } }], uncertainties: [] };
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] })));
    const result = await new QwenVisionService('test-not-a-real-key', 1000, fakeFetch).recognize(image);
    expect(result.foods[0]!.packageLabel!.energy).toEqual({ value: 2092, unit: 'kJ' });
    expect(result.foods[0]!.nutritionEstimateProfile).toBeNull();
    const payload = JSON.parse(fakeFetch.mock.calls[0]![1]!.body as string);
    expect(payload.messages[0].content).toContain('packageLabel'); expect(payload.messages[1].content[0].text).toContain('包装');
  });
  it('多食物响应按各自条目保留重量，无法估重为 null，不把可见配料增加为记录', () => {
    const foods = [
      { ...result.foods[0]!, name: '米饭', estimatedWeightG: 165.5 },
      { ...result.foods[0]!, name: '番茄炒蛋', estimatedWeightG: 240.25, visibleIngredients: ['番茄', '鸡蛋'] },
      { ...result.foods[0]!, name: '香蕉', estimatedWeightG: 90 },
      { ...result.foods[0]!, name: '冬瓜豆腐汤', estimatedWeightG: null },
    ];
    const parsed = parseRecognition(JSON.stringify({ ...result, foods }), { requireProfile: true });
    expect(parsed.foods.map(food => food.estimatedWeightG)).toEqual([165.5, 240.25, 90, null]);
    expect(parsed.foods).toHaveLength(4);
    expect(parsed.foods[1]!.visibleIngredients).toEqual(['番茄', '鸡蛋']);
  });
  it('Gemini 只发送图片、固定模型与 store:false，支持 REST steps', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', steps: [
      { type: 'thought', summary: [{ type: 'text', text: '不应被当作结果' }] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(result) }] },
    ] })));
    const service = new GeminiVisionService('example-not-a-real-key', 1000, fakeFetch);
    expect(await service.recognize(image)).toEqual(result);
    const [url, options] = fakeFetch.mock.calls[0]!;
    const payload = JSON.parse(options!.body as string);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(payload.model).toBe('gemini-3.5-flash-lite');
    expect(payload.store).toBe(false);
    expect(payload.input[1].data).toBe(image.data.toString('base64'));
    expect(payload.response_format.mime_type).toBe('application/json');
    expect(payload.generation_config.max_output_tokens).toBe(8192);
    // 可空重量采用实测支持的类型联合，避免完整 Schema 约束组合导致上游 400。
    expect(payload.response_format.schema.properties.foods.items.properties.estimatedWeightG.type).toEqual(['number', 'null']);
    const foodSchema = payload.response_format.schema.properties.foods.items;
    expect(foodSchema.required).toContain('estimatedNutrientsPer100g');
    expect(foodSchema.required).toContain('nutritionAssumptions');
    expect(foodSchema.required).toContain('nutritionEstimateProfile');
    expect(foodSchema.properties.estimatedNutrientsPer100g.type).toEqual(['object', 'null']);
    // 真实上游曾因完整约束组合 400，固定允许的 wire schema 子集防止未来不小心回归。
    const allowed = new Set(['type', 'properties', 'items', 'required', 'additionalProperties']);
    const assertBasicSchema = (schema: Record<string, unknown>) => {
      expect(Object.keys(schema).every((key) => allowed.has(key))).toBe(true);
      if (schema.items) assertBasicSchema(schema.items as Record<string, unknown>);
      if (schema.properties) for (const field of Object.values(schema.properties as Record<string, Record<string, unknown>>)) assertBasicSchema(field);
    };
    assertBasicSchema(payload.response_format.schema);
    expect(payload).not.toHaveProperty('previous_interaction_id');
  });

  it('GLM 返回每 100 g 粗估及假设，禁止营养字段放错层级', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] })));
    expect(await new GlmVisionService('fake', 1000, fakeFetch).recognize(image)).toEqual(result);
    const payload = JSON.parse(fakeFetch.mock.calls[0]![1]!.body as string);
    expect(payload.model).toBe('glm-4.6v-flash');
    expect(payload.thinking.type).toBe('disabled');
    expect(payload.temperature).toBe(0.2);
    expect(payload.messages[0].content).toContain('输出格式复核');
    expect(payload).not.toHaveProperty('response_format');
    expect(() => parseRecognition(JSON.stringify({ ...result, energyKcal: 100 }))).toThrow('结构');
  });

  it('百炼北京区发送内联图片，关闭思考、启用 JSON Object 并复用范围校验', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result), reasoning_content: '不能当作结果' } }] })));
    const config = loadConfig({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'fake-dashscope-key', QWEN_MODEL: 'qwen3.8-flash', AI_MODE: 'live' });
    const service = createVisionService(config, fakeFetch);
    expect(service.provider).toBe('qwen');
    expect(await service.recognize(image)).toEqual(result);
    const [url, options] = fakeFetch.mock.calls[0]!;
    const payload = JSON.parse(options!.body as string);
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(options!.headers).toMatchObject({ Authorization: 'Bearer fake-dashscope-key' });
    expect(payload.model).toBe('qwen3.8-flash');
    expect(payload.enable_thinking).toBe(false);
    expect(payload.max_tokens).toBe(8192);
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload.messages[1].content[1].image_url.url).toBe(`data:image/jpeg;base64,${image.data.toString('base64')}`);
    expect(payload).not.toHaveProperty('tools');
    expect(payload).not.toHaveProperty('api_key');
  });

  it.each(['length', 'tool_calls', 'content_filter', null, undefined])('百炼结束原因 %s 拒绝保存，即使 JSON 完整', async (finishReason) => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(result) } }] })));
    await expect(new QwenVisionService('fake', 1000, fakeFetch).recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' });
  });

  it('百炼有效 JSON 仍须符合食物及三档结构，不修复或偷偷重试', async () => {
    const legacy = { ...result, foods: [{ ...result.foods[0], nutritionEstimateProfile: null }] };
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(legacy) } }] })));
    await expect(new QwenVisionService('fake', 1000, fakeFetch).recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it.each([[401, 'AI_UNAUTHORIZED'], [403, 'AI_FORBIDDEN'], [429, 'AI_RATE_LIMITED'], [503, 'AI_UPSTREAM_ERROR']])('百炼 HTTP %s 返回安全错误 %s，不切换付费模型', async (status, code) => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-provider-message', { status: status as number }));
    const service = new QwenVisionService('fake', 1000, fakeFetch);
    await expect(service.recognize(image)).rejects.toMatchObject({ code });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('百炼下载超时和网络错误都复用安全错误处理', async () => {
    const stuck = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    await expect(new QwenVisionService('fake', 20, stuck).recognize(image)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    const badNetwork = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-network-error'));
    await expect(new QwenVisionService('fake', 1000, badNetwork).recognize(image)).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
  });

  it('百炼只读取自己的 Key，模型只接受服务端白名单', () => {
    const config = loadConfig({ AI_PROVIDER: 'qwen', GEMINI_API_KEY: 'other-provider-key' });
    expect(config.apiKey).toBeUndefined();
    expect(createVisionService(config).mode).toBe('mock');
    expect(() => loadConfig({ AI_PROVIDER: 'qwen', AI_MODE: 'live', ZHIPU_API_KEY: 'other-provider-key' })).toThrow('API Key');
    expect(() => loadConfig({ AI_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'fake', QWEN_MODEL: 'unapproved-model' })).toThrow('QWEN_MODEL');
    for (const model of ['qwen3.7-flash', 'qwen3.8-flash', 'qwen3.7-plus']) {
      expect(loadConfig({ AI_PROVIDER: 'qwen', QWEN_MODEL: model, DASHSCOPE_API_KEY: ' fake ' }).apiKey).toBe('fake');
    }
  });

  it('AI 营养粗估支持缺失字段，但必须有假设并遵守每 100 g 物理范围', () => {
    const withFood = (food: object) => JSON.stringify({ ...result, foods: [{ ...result.foods[0], nutritionEstimateProfile: null, ...food }] });
    expect(parseRecognition(withFood({ estimatedNutrientsPer100g: null, nutritionAssumptions: [] })).foods[0]!.estimatedNutrientsPer100g).toBeNull();
    expect(parseRecognition(withFood({ estimatedNutrientsPer100g: { energyKcal: 50, proteinG: null, fatG: null, carbsG: null } })).foods[0]!.estimatedNutrientsPer100g!.proteinG).toBeNull();
    expect(() => parseRecognition(withFood({ nutritionAssumptions: [] }))).toThrow('假设');
    expect(() => parseRecognition(withFood({ nutritionAssumptions: [' '] }))).toThrow('假设');
    expect(() => parseRecognition(withFood({ estimatedNutrientsPer100g: { energyKcal: 1001, proteinG: 2, fatG: 1, carbsG: 10 } }))).toThrow('结构');
    expect(() => parseRecognition(withFood({ estimatedNutrientsPer100g: { energyKcal: 400, proteinG: 101, fatG: 1, carbsG: 10 } }))).toThrow('结构');
  });

  it('三档情景按 medium 范围中值计算，忽略模型不一致单值并保留未知字段', () => {
    const profile = {
      factor: 'sweetness', options: [
        { level: 'low', label: '无糖稀粥', rangesPer100g: { energyKcal: { min: 40, max: 60 }, proteinG: null, fatG: null, carbsG: { min: 8, max: 12 } }, assumptions: ['无额外糖，谷物比例未知。'] },
        { level: 'medium', label: '普通甜度', rangesPer100g: { energyKcal: { min: 60, max: 90 }, proteinG: { min: 1, max: 2 }, fatG: null, carbsG: { min: 12, max: 20 } }, assumptions: ['普通甜度，糖量和含水量未经测量。'] },
        { level: 'high', label: '较甜浓粥', rangesPer100g: { energyKcal: { min: 90, max: 120 }, proteinG: { min: 2, max: 3 }, fatG: null, carbsG: { min: 20, max: 26 } }, assumptions: ['较甜、较浓稠的参考情景，不是标准营养值。'] },
      ],
    };
    const raw = { ...result, foods: [{ ...result.foods[0], nutritionEstimateProfile: profile,
      estimatedNutrientsPer100g: { energyKcal: 999, proteinG: 90, fatG: 90, carbsG: 90 }, nutritionAssumptions: [] }] };
    const food = parseRecognition(JSON.stringify(raw)).foods[0]!;
    expect(food.estimatedNutrientsPer100g).toEqual({ energyKcal: 75, proteinG: 1.5, fatG: null, carbsG: 16 });
    expect(food.nutritionAssumptions).toEqual(profile.options[1]!.assumptions);
    expect(food.nutritionEstimateProfile?.options).toHaveLength(3);

    const invalid = structuredClone(raw);
    invalid.foods[0]!.nutritionEstimateProfile.options[0]!.assumptions = [];
    expect(() => parseRecognition(JSON.stringify(invalid))).toThrow('各档');
    const duplicate = structuredClone(raw);
    duplicate.foods[0]!.nutritionEstimateProfile.options[2]!.level = 'medium';
    expect(() => parseRecognition(JSON.stringify(duplicate))).toThrow('结构');
    const reversed = structuredClone(raw);
    reversed.foods[0]!.nutritionEstimateProfile.options[1]!.rangesPer100g.energyKcal = { min: 90, max: 60 };
    expect(() => parseRecognition(JSON.stringify(reversed))).toThrow('结构');
    const oversized = structuredClone(raw);
    oversized.foods[0]!.nutritionEstimateProfile.options[1]!.rangesPer100g.energyKcal = { min: 900, max: 1001 };
    expect(() => parseRecognition(JSON.stringify(oversized))).toThrow('结构');
  });

  it('旧单值响应可兼容，但单次超过 10 项食物要分次识别', () => {
    const legacyFood = { ...result.foods[0] };
    delete (legacyFood as { nutritionEstimateProfile?: unknown }).nutritionEstimateProfile;
    const food = parseRecognition(JSON.stringify({ ...result, foods: [legacyFood] })).foods[0]!;
    expect(food.estimatedNutrientsPer100g).toEqual(result.foods[0]!.estimatedNutrientsPer100g);
    expect(food.nutritionEstimateProfile).toBeNull();
    expect(() => parseRecognition(JSON.stringify({ ...result, foods: Array.from({ length: 11 }, () => legacyFood) }))).toThrow('10 项');
  });

  it('三档允许相同退化范围，不给水或纯黑咖啡强造差异', () => {
    const profile = { factor: 'general', options: ['low', 'medium', 'high'].map(level => ({
      level, label: '无糖无奶', rangesPer100g: { energyKcal: { min: 2, max: 2 }, proteinG: null, fatG: null, carbsG: null },
      assumptions: ['纯黑咖啡、未加糖或奶，三种情景采用相同粗估；不是测量值。'],
    })) };
    const raw = { ...result, foods: [{ ...result.foods[0], nutritionEstimateProfile: profile }] };
    expect(parseRecognition(JSON.stringify(raw), { requireProfile: true }).foods[0]!.estimatedNutrientsPer100g)
      .toEqual({ energyKcal: 2, proteinG: null, fatG: null, carbsG: null });
  });

  it('缺三档不能保留热量单值，GLM保留基础识别并提示丢弃不完整估算', async () => {
    const legacy = { ...result, foods: [{ ...result.foods[0], nutritionEstimateProfile: null }] };
    const noRanges = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(legacy) })));
    await expect(new GeminiVisionService('fake', 1000, noRanges).recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' });
    const legacyGlm = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(legacy) } }] })));
    const partial = await new GlmVisionService('fake', 1000, legacyGlm).recognize(image);
    expect(partial.foods[0]).toMatchObject({ name: '米饭', estimatedWeightG: 120, estimatedNutrientsPer100g: null, nutritionEstimateProfile: null, nutritionAssumptions: [] });
    expect(partial.foods[0]!.uncertainties).toContainEqual(expect.stringContaining('已舍弃该项AI营养数值'));
    expect(legacyGlm).toHaveBeenCalledTimes(1);
    const unknown = { ...legacy, foods: [{ ...legacy.foods[0], estimatedNutrientsPer100g: null, nutritionAssumptions: [] }] };
    expect(parseRecognition(JSON.stringify(unknown), { requireProfile: true }).foods[0]!.nutritionEstimateProfile).toBeNull();
  });

  it.each(['in_progress', 'failed', 'cancelled', 'incomplete', null])('Gemini 状态 %s 即使带有效 JSON 也拒绝保存', async (status) => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status, output_text: JSON.stringify(result) })));
    await expect(new GeminiVisionService('fake', 1000, fakeFetch).recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' });
  });

  it.each(['length', 'tool_calls', 'content_filter', null])('GLM 结束原因 %s 即使带有效 JSON 也拒绝保存', async (finishReason) => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(result) } }] })));
    await expect(new GlmVisionService('fake', 1000, fakeFetch).recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' });
  });

  it('仅剥离完整外围 Markdown 围栏，拒绝猜测修复', () => {
    expect(parseRecognition(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``)).toEqual(result);
    expect(() => parseRecognition(`答案：${JSON.stringify(result)}`)).toThrow('JSON');
    expect(() => parseRecognition('invalid')).toThrow('JSON');
    expect(() => parseRecognition(JSON.stringify({ ...result, foods: [{ ...result.foods[0], estimatedWeightG: -1 }] }))).toThrow('结构');
    expect(() => parseRecognition(JSON.stringify({ ...result, isFood: false }))).toThrow('结构');
    expect(geminiOutputText({ output_text: JSON.stringify(result) })).toBe(JSON.stringify(result));
    expect(parseRecognition('{"isFood":false,"foods":[],"uncertainties":["不是食物"]}').foods).toEqual([]);
  });

  it.each([
    [401, 'AI_UNAUTHORIZED'], [403, 'AI_FORBIDDEN'], [429, 'AI_RATE_LIMITED'], [503, 'AI_UPSTREAM_ERROR'],
  ])('上游 HTTP %s 映射安全错误 %s，不暴露原始响应', async (status, code) => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('原始错误含机密', { status, headers: { 'retry-after': '12' } }));
    await expect(new GeminiVisionService('fake', 1000, fakeFetch).recognize(image)).rejects.toMatchObject({ code });
  });

  it('网络异常与无效上游 JSON 单独提示', async () => {
    const badNetwork = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-network-details'));
    await expect(new GeminiVisionService('fake', 1000, badNetwork).recognize(image)).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
    const badJson = vi.fn<typeof fetch>().mockResolvedValue(new Response('not json'));
    await expect(new GeminiVisionService('fake', 1000, badJson).recognize(image)).rejects.toMatchObject({ code: 'AI_INVALID_JSON' });
  });

  it('包含响应下载的超时仍然终止等待', async () => {
    const stuck = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    await expect(new GeminiVisionService('fake', 20, stuck).recognize(image)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('auto 无密钥使用 mock；live 缺密钥拒绝启动；真实模式失败不会替换为 mock', async () => {
    expect(createVisionService(loadConfig({})).mode).toBe('mock');
    expect(() => loadConfig({ AI_MODE: 'live' })).toThrow('API Key');
    const config = loadConfig({ GEMINI_API_KEY: 'fake', AI_MODE: 'auto' });
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error('failed'));
    const service = createVisionService(config, failed);
    expect(service.mode).toBe('live');
    await expect(service.recognize(image)).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
  });
});
