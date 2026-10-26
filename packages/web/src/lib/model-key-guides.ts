import type { PersonalProvider } from '@shike/shared'

export const modelKeyGuideCheckedOn = '2026-10-24'
interface ModelKeyGuide { steps: readonly string[]; note: string; docsUrl: string; envKey: string; modelUrl?: string; modelLinks?: readonly { name: string; url: string }[]; payment?: { title: string; steps: readonly string[]; note: string; consoleUrl: string; pricingUrl: string } }

/** 按平台申请 Key；模型权限、地域和额度仍由提供商控制。内容不包含用户凭据。 */
export const modelKeyGuides: Record<PersonalProvider, ModelKeyGuide> = {
  qwen: {
    envKey: 'DASHSCOPE_API_KEY',
    steps: ['注册并登录阿里云百炼，按控制台提示开通模型服务。', '切换到华北2（北京），打开 API Key 管理，在默认业务空间创建通用 API Key。', '复制完整 Key。不要使用阿里云 AccessKey ID／Secret，也不要使用 Coding Plan／Token Plan 专属 Key。'],
    note: '北京区 Key 与其他地域不能混用。模型权限和赠送额度以控制台为准；可在平台开启“免费额度用完即停”。',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
  },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    steps: ['注册并登录 DeepSeek 开放平台。', '进入 API keys 页面，创建新的 API Key，并复制完整内容。', '在开放平台检查余额与模型调用权限；API 按量计费，不能把聊天账号或登录密码当作 Key。'],
    note: '这里使用 DeepSeek 官方 Key。若在其他平台调用 DeepSeek，需使用那个平台的 Key，不能混用。',
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  siliconflow: {
    envKey: 'SILICONFLOW_API_KEY',
    steps: ['注册并登录硅基流动国内平台，按平台要求完成账号设置。', '进入“API 密钥”，点击创建 API Key，复制新建的完整 Key。', '在模型广场确认所选模型可用，并检查当前价格、额度和限流。'],
    note: '同一硅基流动 Key 可用于其有权限的模型。平台免费模型也需要 Key，仍可能被限流。',
    docsUrl: 'https://docs.siliconflow.cn/docs/userguide/quickstart',
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    steps: ['注册并登录 OpenRouter，打开 Keys 页面。', '点击 Create Key，填写名称和合适的使用上限，再复制完整 Key。', '在食刻选择 Nemotron 3.5 Super VL 或 Dots3-Note Preview 免费视觉型号。同一组只填一把 OpenRouter Key，不能用 Google AI Studio Key。'],
    note: 'NVIDIA免费端点会记录请求用于安全与产品改进，请勿上传人脸、声音或个人／敏感信息。Dots3-Note Preview 当前标注2026-12-31下线。免费路由仍受账号权限、额度和上游状态限制；公开目录不保证个人账号可调用，失败不会自动改用付费型号。',
    docsUrl: 'https://openrouter.ai/docs/api/reference/authentication',
    modelLinks: [{ name: 'Nemotron 3.5 Super VL', url: 'https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free' }, { name: 'Dots3-Note Preview', url: 'https://openrouter.ai/dots-studio/dots-3-note-preview:free' }],
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    steps: ['使用 Google 账号登录 Google AI Studio，选择自己有权限的项目。', '打开 API Keys，点击 Create API key，在所选项目下创建并复制新 Key。', '如果看不到项目，先在 Projects 导入项目；如果无创建权限，联系项目管理员或使用有权限的项目。'],
    note: 'Google AI Studio 新建 Key 使用当前的 auth key 类型。旧 Key 被标为 Blocked 时需更换；额度和账单归属对应项目，调用设备的网络及地区需受支持。',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
  },
  glm: {
    envKey: 'ZHIPU_API_KEY',
    steps: ['注册并登录智谱开放平台，先在“我的资源包”查看适用型号、生效状态和到期时间。', '使用领取资源包同一账号的“模型标准 API”Key；同账号原Key可继续用，没有Key再创建并复制完整内容。', '有对应资源包时可先选glm-5.3-flash或glm-5.3-flashx；glm-4.6v-flashx也可使用适用的额度。两款平台免费型号为glm-4.1v-thinking-flash、glm-4.6v-flash。五款可共用标准Key，不要混用个人编程套餐或团队编程套餐 Key。'],
    note: '5.3-Flash和5.3-FlashX均支持图片，必须开启思考；食刻使用轻度思考。赠送资源包不等于模型永久免费，额度用尽或到期后可能扣余额。App不读取实时资源包，也不能强制只扣赠送额度。1315需检查标准API Key，1113检查账户欠费，1305为平台繁忙。',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/quick-start',
    modelUrl: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash',
    modelLinks: [{ name: 'GLM-4.6V系列', url: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v' }, { name: '免费GLM-4.1V', url: 'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.1v-thinking-flash' }, { name: '免费GLM-4.6V-Flash', url: 'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash' }],
    payment: {
      title: '先用适用资源包 · 需要时再充值',
      steps: ['打开官方控制台的“我的资源包”，逐项核对适用型号、生效状态、当前可用余额和到期时间。只用有效且匹配的包，不把不同模型额度相加。', 'glm-5.3-flash专属包对应Flash，glm-5.3-flashx专属包对应FlashX；搜索次数及图像生成次数不能直接当作食物识别Token。通用包是否覆盖某型号以其完整详情为准。', '使用领取资源包同一账号的模型标准API Key，在食刻选择与资源包匹配的型号。先测试一次，再到智谱查看该包和账单的实际变化，确认是否抵扣。', '有可用赠送额度时先试用；用完或到期后可能扣现金余额，App不能强制“只扣赠送额度”。需要充值时再从控制台余额入口操作，无需购买编程包月套餐。'],
      note: '资源包数量和有效期以各自账号为准。5.3两款本身仍是按量模型，思考也消耗输出Token；这里不承诺永久免费或自动停费。GLM-4.6V-FlashX可继续手动选择。最低充值金额、支付方式及按钮名称以登录后的官方收银台为准。',
      consoleUrl: 'https://bigmodel.cn/console/overview',
      pricingUrl: 'https://docs.bigmodel.cn/cn/guide/start/pricing',
    },
  },
}
