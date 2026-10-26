import { z } from 'zod';

export const openRouterVisionModels = ['nvidia/nemotron-3.5-super-vl:free', 'dots-studio/dots-3-note-preview:free'] as const;
export const glmVisionModels = ['glm-4.1v-thinking-flash', 'glm-4.6v-flash', 'glm-4.6v-flashx', 'glm-5.3-flash', 'glm-5.3-flashx'] as const;
export type GlmVisionModel = typeof glmVisionModels[number];
export function isGlm53VisionModel(model: string) { return model === 'glm-5.3-flash' || model === 'glm-5.3-flashx' }
/** 仅保存展示元数据；凭据由安卓插件加密管理，绝不进入备份模型。 */
export const personalProviders = [
  { id: 'qwen', name: '阿里云百炼 · 北京', models: ['qwen3.7-flash', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3-vl-plus'] },
  { id: 'deepseek', name: 'DeepSeek · 官方', models: ['deepseek-flash'] },
  { id: 'siliconflow', name: '硅基流动 · 国内', models: ['Qwen/Qwen3.5-4B'] },
  { id: 'openrouter', name: 'OpenRouter · 免费视觉', models: openRouterVisionModels },
  { id: 'gemini', name: 'Google Gemini', models: ['gemini-3.5-flash-lite'] },
  { id: 'glm', name: '智谱 GLM', models: glmVisionModels },
] as const;
export const personalProviderSchema = z.enum(['qwen', 'gemini', 'glm', 'siliconflow', 'openrouter', 'deepseek']);
export type PersonalProvider = z.infer<typeof personalProviderSchema>;
export const personalProfileSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(40),
  provider: personalProviderSchema, model: z.string().min(1).max(80),
  models: z.array(z.string().min(1).max(80)).min(1).max(10).optional(),
}).strict().refine(value => personalProviders.some(provider => provider.id === value.provider && (provider.models as readonly string[]).includes(value.model)
  && (!value.models || (value.models.includes(value.model) && new Set(value.models).size === value.models.length && value.models.every(model => (provider.models as readonly string[]).includes(model))))), { message: '不支持的模型或模型分组' });
export type PersonalProfile = z.infer<typeof personalProfileSchema>;
/** 兼容旧单模型配置；一组元数据对应原生层保存的一把 Key。 */
export function personalProfileModels(profile: PersonalProfile): string[] { return profile.models ?? [profile.model] }
export function personalModelSelection(profile: PersonalProfile, model = profile.model) { return personalProfileModels(profile).length === 1 ? profile.id : `${profile.id}::${model}` }
export const personalStateSchema = z.object({
  profiles: z.array(personalProfileSchema).max(12), activeId: z.string().uuid().nullable(),
}).strict().refine(value => new Set(value.profiles.map(p => p.id)).size === value.profiles.length && (value.activeId === null || value.profiles.some(profile => profile.id === value.activeId)));
export type PersonalState = z.infer<typeof personalStateSchema>;

/** 价格描述是核实当日的平台政策，不代表已读到账户余额或承诺永久免费。 */
export function personalModelInfo(provider: string, model: string) {
  if (provider === 'deepseek') return { badge: '按量计费', note: '官方deepseek-flash支持图片，API按Token及时段计费，不保证免费。请使用DeepSeek开放平台Key并查看余额；旧名称和纯文本Pro型号不在拍照列表中。', keyUrl: 'https://platform.deepseek.com/api_keys' }
  if (provider === 'siliconflow') return { badge: '平台免费', note: '官方公布Qwen3.5-4B免费，仍有平台限流。小模型的食物和重量估算需核对；是否开放以控制台为准。', keyUrl: 'https://cloud.siliconflow.cn/account/ak' }
  if (provider === 'openrouter') return { badge: model === 'dots-studio/dots-3-note-preview:free' ? '免费预览' : '免费端点', note: `${personalModelUsageNotice(provider, model)}仅使用:free视觉模型，限制为零价格路由；免费额度和可用上游会变化。照片经OpenRouter转交上游，手机网络需能访问该服务。`, keyUrl: 'https://openrouter.ai/settings/keys' }
  if (provider === 'qwen') {
    const notes: Record<string, string> = {
      'qwen3.7-flash': '日常记餐优先，成本最低。输入不超过32K时，输入／输出每百万Token为0.2／0.8元；长输入另计。',
      'qwen3.8-flash': '较新的通用多模态Flash，可作日常对照。输入／输出每百万Token为0.8／2.7元。',
      'qwen3.7-plus': '通用Plus，可对照复杂照片。输入不超过256K时原价2／8元，当前限时8折约1.6／6.4元。',
      'qwen3-vl-plus': '视觉专用，可对照标签与复杂照片。输入不超过32K时，输入／输出每百万Token为1／10元；长输入另计。',
    };
    return { badge: '赠送额度／按量', note: `${notes[model] ?? ''}四款均支持图片，尚无本应用餐食准确率排名。价格核对于2026-10-24，未计缓存优惠。北京区符合条件的账户有100万Token赠送额度，通常有效90天；用完或到期后可能自动计费，请开启“免费额度用完即停”，使用通用Key。`, keyUrl: 'https://bailian.console.aliyun.com/' }
  }
  if (provider === 'gemini') return { badge: '免费层／按量', note: '免费使用取决于项目层级及额度；需要手机网络可访问Google服务，账单以AI Studio为准。', keyUrl: 'https://aistudio.google.com/api-keys' }
  if (provider === 'glm' && isGlm53VisionModel(model)) return { badge: '资源包／按量', note: `${model === 'glm-5.3-flash' ? '5.3-Flash' : '5.3-FlashX'}原生视觉型号，先在智谱“我的资源包”核对对应型号、生效状态和到期时间。模型本身按量计费，输入／输出每百万Token原价${model === 'glm-5.3-flash' ? '0.8／2.8' : '2／7'}元（2026-10-24核对）。使用轻度思考，无法完全关闭；结果与速度仍需实际核对。资源包用完或到期后可能扣余额，App不能保证只扣赠送额度。`, keyUrl: 'https://bigmodel.cn/console/overview' }
  if (provider === 'glm' && model === 'glm-4.6v-flashx') return { badge: '按量计费', note: '付费视觉轻量型号FlashX，食刻关闭额外思考。输入少于32K时，输入／输出每百万Token为0.15／1.5元；32K至128K档为0.3／3元。价格核对于2026-10-24，未计缓存优惠。先核对资源包是否适用，适用额度可抵扣；需要时再充值模型标准API余额，同一Key可共用本组型号。', keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys' }
  if (provider === 'glm') return { badge: '平台免费', note: `${model === 'glm-4.1v-thinking-flash' ? '免费视觉推理模型，可作备用；内置思考，复杂图片可能等待较久或超时。营养格式不合格时需从食物库补充。' : '免费视觉模型，可能遇到平台繁忙。'}仍受账号权限与限流影响；同一智谱标准API Key可在本组选择型号，失败后手动切换。`, keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys' }
  return { badge: '模拟', note: '仅用于本机演示，不分析照片。', keyUrl: '' }
}
export function personalProviderName(provider: string) { return personalProviders.find(item => item.id === provider)?.name ?? (provider === 'mock' ? '本地 Mock' : provider) }

/** 4.1V内置思考，不沿用4.6V的关闭思考参数；仍约束JSON并执行本地校验。 */
export function glmChatOptions(model: string) {
  if (!(glmVisionModels as readonly string[]).includes(model)) throw new Error('不支持的智谱模型');
  if (isGlm53VisionModel(model)) return { temperature: 1, top_p: 0.95, thinking: { type: 'enabled' }, reasoning_effort: 'low' };
  return model === 'glm-4.1v-thinking-flash' ? { temperature: 0.2 } : { temperature: 0.2, thinking: { type: 'disabled' } };
}
/** 只映射已知业务码，不回显供应商正文、账号标识或密钥。 */
export function glmBusinessErrorMessage(status: number, code: string): string | null {
  if (status === 429) {
    const messages: Record<string, string> = {
      '1113': '智谱账户欠费（1113），请到平台检查余额；不是模型下线。',
      '1302': '智谱账户请求过于频繁（1302），请降低频率后重试。',
      '1305': '智谱模型当前访问量过大（1305），请稍后重试或手动选择其他模型。',
      '1308': '已达到智谱使用上限（1308），请到平台查看重置时间。',
      '1310': '已达到智谱周或月使用上限（1310），请到平台查看重置时间。',
      '1311': '智谱套餐未开放当前模型权限（1311），请检查模型标准API权限。',
      '1315': '当前智谱Key仅限企业编程套餐（1315），请更换模型标准API Key。',
    };
    return Object.hasOwn(messages, code) ? messages[code]! : null;
  }
  if (status === 400 && code === '1211') return '智谱模型不存在（1211），请核对型号或选择其他已适配模型。';
  if (status === 400 && code === '1221') return '智谱API已下线（1221），请选择其他已适配模型。';
  return null;
}

export function personalModelUsageNotice(provider: string, model: string): string {
  if (provider === 'glm' && isGlm53VisionModel(model)) return '资源包／按量：请先确认本型号资源包生效且未到期；额度用尽或过期后可能扣余额。App不能读取实时额度，也不能强制只用赠送额度。';
  if (provider === 'glm' && model === 'glm-4.6v-flashx') return '按量计费：照片和提示词计入输入Token，输出另计；测试连接也可能扣费。请使用智谱模型标准API余额。';
  if (provider === 'openrouter' && model === 'nvidia/nemotron-3.5-super-vl:free') return 'NVIDIA免费端点会记录请求用于安全与产品改进，请勿上传人脸、声音或其他个人／敏感信息。';
  if (provider === 'openrouter' && model === 'dots-studio/dots-3-note-preview:free') return '免费预览型号，官方当前标注于2026-12-31下线；到期或受限时请手动选择其他已配置型号。';
  return '';
}

/** 仅给已核对支持 JSON Schema 的新增型号启用，不改变旧模型的请求契约。 */
export function supportsStructuredVisionOutput(provider: string, model: string): boolean {
  return provider === 'openrouter' && (model === 'nvidia/nemotron-3.5-super-vl:free' || model === 'dots-studio/dots-3-note-preview:free');
}
export function compatibleVisionResponseFormat(provider: string, model: string, schema: unknown) {
  return supportsStructuredVisionOutput(provider, model)
    ? { type: 'json_schema', json_schema: { name: 'shike_result', strict: true, schema } }
    : { type: 'json_object' };
}

/** 兼容接口只使用固定主机与白名单模型，禁止调用者提供自定义URL。 */
export function compatibleVisionEndpoint(provider: PersonalProvider, model: string) {
  if (!personalProviders.some(item => item.id === provider && (item.models as readonly string[]).includes(model))) throw new Error('不支持的提供商或模型')
  if (provider === 'siliconflow') return 'https://api.siliconflow.cn/v1/chat/completions'
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions'
  if (provider === 'deepseek') return 'https://api.deepseek.com/chat/completions'
  if (provider === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  if (provider === 'glm') return 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
  throw new Error('此模型使用独立协议')
}
export function compatibleVisionOptions(provider: 'siliconflow' | 'openrouter' | 'deepseek') {
  // DeepSeek默认思考模式；识别显式关闭，读取最终content并独立校验JSON。
  if (provider === 'deepseek') return { thinking: { type: 'disabled' } }
  return provider === 'siliconflow' ? { enable_thinking: false } : {
    reasoning: { enabled: false },
    // 固定免费模型，不传models数组／免费路由器，不允许自动落到付费提供方。
    provider: { allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } },
  }
}
