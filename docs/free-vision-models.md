# 免费视觉模型：配置与调用教学

## 当前版本0.11.12-test（2026-10-24核实）

新增5.3-Flash与5.3-FlashX，用于匹配账号已领取的有效资源包；两者本身仍是按量模型，不列为永久免费。当前六个平台共十四款型号。[资源包教程](glm-resource-packs.md)。

## 0.11.11-test调整（当时核实）

本版新增的`glm-4.6v-flashx`是付费视觉型号，详见[充值与设置教程](glm-flashx.md)。它与两款免费GLM共用标准Key，已有免费组不会自动启用付费型号。当前共六个平台、十二个型号。以下保留0.11.10-test的免费型号调整说明。

## 0.11.10-test调整（当时核实）

当前共六个平台、十一个型号。OpenRouter的两个Google／Gemma型号按用户要求移除，列表仅保留Nemotron与Dots。旧APK加密组迁移时保留Key和其他型号；若原当前型号被移除则取消选用，要求用户手动选择，不在启动时发起模型请求。仅含旧Google型号的组会保留Key并列出两个现有免费选项供重新选用。服务端若显式使用旧OPENROUTER_MODEL，需改为下述两款之一。

新增免费智谱glm-4.1v-thinking-flash，默认内置思考，不能复用4.6V的关闭思考参数。实测包含完整think/answer外围标签，应用只取完整最终答案并继续严格JSON及字段校验；不会从思考文本中提取任意片段。复杂照片可能超时，同一标准API Key可管理4.1V和4.6V。[官方4.1V说明](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.1v-thinking-flash)。

## 历史版本0.11.8-test（当时核实）

本版新增两款OpenRouter免费视觉型号，当前共六个平台、十二个型号。公开`/api/v1/models`及各型号`/endpoints`目录均列有零价格、图片输入、文本输出和可用上游，并声明支持`response_format`与`structured_outputs`。这只能确认公开能力，不证明用户账号、所在地区、隐私配置及实时额度均可调用。

- **`nvidia/nemotron-3.5-super-vl:free`**：Nemotron 3.5 Super VL。官方免费端点会记录请求用于安全与产品改进，不得上传人脸、声音或个人／敏感信息。App在勾选与识别模型选择处显示提醒。[官方模型页与提供方政策](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free)。
- **`dots-studio/dots-3-note-preview:free`**：Dots3-Note Preview。免费预览，官方当前标注**2026-12-31下线**，页面会显示日期；到期或受限后需手动改选已配置型号。[官方模型页](https://openrouter.ai/dots-studio/dots-3-note-preview:free)。

已有OpenRouter组在「管理可用模型」勾选新型号并测试保存，Key留空继续共用；新建组只填一次Key即可。没有Key可从内置教程打开官方Keys页。仅新建且没有显式默认值的OpenRouter配置默认使用Nemotron，旧组的模型和Key不被升级改选。网页版若配置`OPENROUTER_API_KEY`，重启Node服务并刷新后即可看到新型号；`OPENROUTER_MODEL`仍可显式设置默认型号。

拍照与文字记餐为这两款发送`response_format.type=json_schema`、`json_schema.strict=true`及相应任务Schema，关闭推理以减少额外等待，结果仍通过本地完成状态和Zod检查。其余旧模型沿用原请求契约；上游结构化输出支持不保证食物和热量准确。免费路由继续要求零价格，禁止自动回退及自动重试，不自动调整用户的OpenRouter隐私设置。

本次暂不加入Nano Omni（公开上游状态异常，且未列出所需格式参数）、Inkling两款（未列出结构化输出参数），以及用于内容审核的Content Safety。Gemma公开目录仍有端点，因此保留已有配置兼容，不能据个别账号受限就判断所有账号被禁；用户账号提示禁止的型号无需勾选。未调用用户Key，也未实测新增模型的延迟或食物准确率。[公开模型目录](https://openrouter.ai/api/v1/models) · [免费路由参数](https://openrouter.ai/docs/guides/routing/provider-selection)。

以下为0.9.8-test历史教学，版本、型号数量与验证结果仅对应当时；当前新增模型规则以上文及内置教程为准。

## 历史版本0.9.8-test

0.9.9-test另加按量计费的DeepSeek `deepseek-flash`；它不属于这里的免费选项。[DeepSeek独立说明](deepseek.md)。下文数量和验证结果对应0.9.8-test。

核实日期：**2026-10-20**。0.9.8-test增加两个提供商、四个模型选项，总计五个平台、九个模型。这里的“免费”指模型API政策；聊天网站免费、模型权重开源，都不等于托管API免费。政策、限流和账户权限会变化，App不能读取你的余额。

## 这次增加了什么

- **硅基流动 `Qwen/Qwen3.5-4B`**：官方上线公告明确4B免费、支持原生多模态，同时说明属于预览版本，仍在优化。可优先用来测试国内网络下的免费调用；这不是食物识别准确率排名。较小模型可能漏认食物、估重不准或无法返回合格结构。[官方公告](https://www.siliconflow.cn/news/yg6n19y2g6frnp4koxu8ye48) · [视觉输入文档](https://docs.siliconflow.cn/docs/userguide/capabilities/vision)
- **OpenRouter `google/gemma-4-26b-a4b-it:free`、`google/gemma-4-31b-it:free`**：官方模型页列为免费，支持图片输入与结构化输出。它们共用OpenRouter Key，不能使用Gemini Key。免费上游可能限流或暂时没有可用端点，手机网络也必须能够访问OpenRouter。照片会由OpenRouter转交选中的上游。[26B模型页](https://openrouter.ai/google/gemma-4-26b-a4b-it:free) · [31B模型页](https://openrouter.ai/google/gemma-4-31b-it:free)
- **百炼 `qwen3-vl-plus`**：补充视觉专用模型，属于“赠送额度／按量”。北京区符合条件的新用户额度为100万Token，有效期通常90天，按开通、模型发布或申请通过的较晚时间计算。额度用完或过期后可能自动计费；在控制台开启该模型的“免费额度用完即停”。不重新赠送已用完的额度。[官方价格](https://help.aliyun.com/zh/model-studio/model-pricing) · [额度及用完即停](https://help.aliyun.com/zh/model-studio/new-free-quota)

旧的三个百炼型号、Gemini和GLM仍可选。Gemini免费取决于项目层级，GLM免费端点仍可能429。原来能用的配置不会因升级被改选；新增平台也不会在后台偷偷尝试。

## 手机如何操作

1. 先在设置导出JSON备份，再用同签名的0.9.8-test APK覆盖安装，保留现有记录；不要先卸载。
2. 在平台网站创建API Key：硅基流动打开[API密钥页](https://cloud.siliconflow.cn/account/ak)，OpenRouter打开[Keys页](https://openrouter.ai/settings/keys)，百炼在[控制台](https://bailian.console.aliyun.com/)选择北京区并使用通用API Key。不同平台的Key不能混用，Coding Plan Key不能替代百炼通用Key。
3. 食刻 → **设置 → 我的AI模型 → 添加模型配置**。输入配置名称，选择提供商和模型；页面会显示免费类型、限制和官方Key入口。
4. 在手机粘贴自己的Key，点击“测试并保存”。只发一张内置测试图，成功才保存；测试可能消耗请求额度，失败不覆盖已有配置。不要把Key发给别人。
5. 第一组默认使用；后面新增的组需点击“选用”。拍照界面的模型下拉框也能切换，下一次识别生效。切换本身不发AI请求。
6. 拍餐食或营养表后，核对名称、摄入量与估算档位。失败时可手动重试、切换配置或手动记录，不自动轮换Key。

一个平台Key可以建多组不同模型配置，最多12组。多建配置不会增加平台账户额度。同一平台内可编辑模型，留空Key表示保留原Key；换平台请新建配置。

## 代码怎样发送照片

安卓直连沿用原有流程：压缩成最长边1280px、最多1MB的JPEG → `personal-vision.ts`固定本次配置 → Capacitor原生插件解密本机Key → 固定HTTPS端点 → 完整JSON与Zod校验 → 食物库匹配与用户编辑 → IndexedDB保存快照。

硅基流动使用 `https://api.siliconflow.cn/v1/chat/completions`；OpenRouter使用 `https://openrouter.ai/api/v1/chat/completions`。两者都使用请求头 `Authorization: Bearer <用户自己的Key>`，不把Key放URL。图片以内联Base64发送，不创建上传文件或会话。

```ts
// 简化示意：实际请求分别由Node适配器或安卓原生插件发送。
const body = {
  model: selectedModel, // 必须属于所选提供商的白名单
  max_tokens: 8192,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: FOOD_PROMPT },
    { role: 'user', content: [
      { type: 'text', text: FOOD_REQUEST },
      { type: 'image_url', image_url: {
        url: `data:image/jpeg;base64,${compressedImageBase64}`, detail: 'high',
      } },
    ] },
  ],
};
```

硅基流动额外传 `enable_thinking:false`；OpenRouter传 `reasoning:{enabled:false}`，并加以下路由限制：

```json
{
  "provider": {
    "allow_fallbacks": false,
    "require_parameters": true,
    "max_price": { "prompt": 0, "completion": 0, "request": 0 }
  }
}
```

模型ID必须保留 `:free`。不使用随机免费路由器、不传备用模型数组；零价格筛选失败时直接报错，不跳到付费同名模型。这会降低免费端点繁忙时的成功率，但保留用户选择及成本限制。参数含义见[OpenRouter官方路由说明](https://openrouter.ai/docs/guides/routing/provider-selection)。请求参数见[硅基流动Chat Completions](https://docs.siliconflow.cn/docs/api/chat-completions-post)。

`json_object`只要求JSON格式，不能证明内容正确。代码还检查完整完成状态、字段、数值范围、食物与非食物的一致性、估算假设；缺少规定字段或截断时拒绝结果。可信食物库和配方优先，无匹配才使用明确标记的AI粗估。每100g范围按用户重量换算，默认取中档中值；包装则抄原标签，不猜营养表。

模型白名单及平台参数位于 `packages/shared/src/personal-vision.ts`；安卓还在 `VisionPolicy.java`独立校验。后端适配器是 `packages/server/src/vision/compatible.ts`。这几处同步维护，不能只向UI列表添加任意名字。

## 电脑网页如何配置

普通浏览器不能调用安卓Keystore，仍通过本机Node后端。根目录 `.env`可选择一种默认提供商，例如：

```dotenv
AI_PROVIDER=siliconflow
AI_MODE=auto
SILICONFLOW_API_KEY=在本机填写自己的Key
```

或：

```dotenv
AI_PROVIDER=openrouter
AI_MODE=auto
OPENROUTER_API_KEY=在本机填写自己的Key
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
```

百炼仍用 `DASHSCOPE_API_KEY`，选择视觉模型时设 `QWEN_MODEL=qwen3-vl-plus`。配置多个平台Key后，网页识别面板会列出已配置平台的白名单模型；默认提供商的Key缺失时auto模式明确使用Mock。真实调用失败不会用Mock冒充。

修改 `.env`后重启 `npm run dev`，或重新构建后执行 `npm start`。不要将Key写到 `VITE_`变量、源码、聊天或备份里。安卓手机自配Key不需要这些后端变量，也不需要电脑开机。

## 数据与验证边界

安卓Key沿用AES-GCM与Android Keystore加密管理，网页只读取不含Key的元数据。照片和原始模型响应不写入本地饮食备份；应用不永久保存照片。发送给提供商的副本如何处理，仍取决于提供商及OpenRouter上游政策，代码无法替其删除。

本轮核实了官方模型能力与免费政策，并用合成响应测试端点、参数、零价路由、来源保留、错误处理及保存恢复。**没有新平台Key，尚未实测它们的账户调用、延迟或食物准确率。**“测试并保存”通过只是基本连通；真正比较需使用同一张餐食照、称重和营养标签对照，不以参数大小或免费标签判定谁更准。

交付检查：345项单元／接口测试、3项Android策略测试、类型检查与生产构建通过；实际APK解包页面使用模拟桥且禁外部网络，通过Chrome手机视口、Chrome桌面、Edge桌面的9项配置与识别保存回归。安装包versionCode为18、版本0.9.8-test，沿用上一版签名，下载文件校验值与本地一致。详细机器结果在忽略目录`artifacts/android/free-models-verification.json`，不包含Key。
