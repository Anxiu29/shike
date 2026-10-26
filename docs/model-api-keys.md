# API Key 申请与一 Key 多模型教程

核实日期：2026-10-24。安卓0.11.8-test入口为「设置 → 我的AI模型 → API Key申请与多模型教程」；网页版入口为「设置 → 本机AI服务 → API Key申请与网页版配置教程」。没有Key也能阅读，官方网页仍需联网登录。

## 网页版：申请后配置本机服务

1. 在设置中打开教程，选择平台，点「打开官方Key页面」或「官方申请说明」，按对应步骤创建Key。各平台链接也列在本文下方。
2. 在运行食刻服务的电脑上，把项目根目录的`.env.example`复制为`.env`（已有则直接修改）。以百炼为例：

   ```dotenv
   AI_PROVIDER=qwen
   AI_MODE=auto
   DASHSCOPE_API_KEY=替换为你申请的Key
   ```

   其他平台的Key变量分别为：DeepSeek用`DEEPSEEK_API_KEY`，硅基流动用`SILICONFLOW_API_KEY`，OpenRouter用`OPENROUTER_API_KEY`，Gemini用`GEMINI_API_KEY`，智谱用`ZHIPU_API_KEY`。相应的`AI_PROVIDER`值在内置教程示例中展示。
3. 保存后重启食刻的Node服务，再刷新网页。开发时重新运行`npm run dev`；使用构建版时重新运行`npm start`。不要同时启动两份服务。
4. 在拍照或文字记餐的模型列表中选择型号。同一平台的Key变量只填一次，服务自动列出食刻已适配的型号；多个平台的Key可同时配置，`AI_PROVIDER`控制默认平台。更换Key后需再次重启服务。

网页版不会让你在浏览器中保存模型Key；不要将Key写入`VITE_`变量。使用他人部署的网页时，请让部署者配置服务。如果仍显示模拟模式，检查`AI_MODE`是否为`mock`、所选平台是否配置Key，以及是否已重启服务并刷新页面。配置和阅读教程不会自动调用模型，实际识别可能消耗额度。

## 安卓 App：一把 Key 直接选择多个模型

1. 点击「添加Key配置」，选择平台，填写名称，在「这把Key可使用的模型」中勾选需要的型号，或点「全选本平台模型」。选择默认模型，Key只粘贴一次。
2. 点击「测试并保存」。只测试默认／当前模型并发送一张内置测试图，可能消耗额度；其他模型的权限在实际调用时检查。失败不覆盖原Key与模型列表。
3. 拍照或文字记餐时，下拉列表会分别显示「配置名称 · 模型」。切换同组模型使用同一把Key，不需要重新填写，也不会因为切换就发识别请求。
4. 已有配置可点「管理可用模型」直接扩展。编辑时Key留空表示保留原Key；输入新Key则一次替换整组所用的Key。至少保留一个模型，最多12组Key。
5. 删除整组会移除这把Key和本组全部模型选项；不会删除饮食记录。Key和分组不进入记录备份，换手机需重新配置。

同平台不代表无条件访问所有模型：仍受项目、地域、产品类型及模型权限限制。同组多个模型也可能价格不同，共享平台规定的额度与限流；勾选模型不会增加额度。列表只包含食刻已经适配的型号。

## 阿里云百炼 · 北京

打开[百炼控制台](https://bailian.console.aliyun.com/)，按提示开通服务，切到华北2（北京），在API Key管理中创建通用Key。不要填写阿里云AccessKey ID／Secret，也不要混用Coding Plan／Token Plan专属Key。

食刻支持的四个百炼型号可在一组勾选。地域、业务空间和模型授权必须匹配；赠送额度与「免费额度用完即停」在平台查看。[官方Key申请说明](https://help.aliyun.com/zh/model-studio/get-api-key) · [免费额度说明](https://help.aliyun.com/zh/model-studio/new-free-quota)。

## DeepSeek · 官方

注册登录[开放平台API keys页](https://platform.deepseek.com/api_keys)，创建并复制完整Key，在平台核对余额与调用权限；API按量计费。当前食刻适配`deepseek-flash`，无需把登录密码填入Key输入框。[官方接入说明](https://api-docs.deepseek.com/) · [官方计费](https://api-docs.deepseek.com/quick_start/pricing/)。

## 硅基流动 · 国内

登录[API密钥页](https://cloud.siliconflow.cn/account/ak)，点击创建并复制Key。当前适配`Qwen/Qwen3.5-4B`，在平台模型页确认可用状态、价格与限流；免费模型也需要Key。[官方快速开始](https://docs.siliconflow.cn/docs/userguide/quickstart)。

## OpenRouter · 免费视觉

在[Keys页](https://openrouter.ai/settings/keys)登录并创建Key，设置合适的使用上限。0.11.8-test可在同组勾选`nvidia/nemotron-3.5-super-vl:free`和`dots-studio/dots-3-note-preview:free`，它们共用一把OpenRouter Key，与Google AI Studio Key不通用。原有两款Gemma为兼容已保存配置继续保留；账号提示禁止或无权限的型号不用勾选。额度与上游可用状态按平台当前页面为准。[官方Key说明](https://openrouter.ai/docs/api/reference/authentication)。

[Nemotron官方页](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free)说明免费端点会记录请求用于安全与产品改进，不得发送人脸、声音或其他个人／敏感信息；拍照前只保留餐食。[Dots官方页](https://openrouter.ai/dots-studio/dots-3-note-preview:free)当前标注2026-12-31下线。两款的图片输入、零价格及结构化输出已按公开目录核实，尚未实测用户账号。食刻不放宽隐私选项或绕过地区／权限限制，失败后请手动选择其他有权限的模型。

## Google Gemini

打开[Google AI Studio API Keys](https://aistudio.google.com/api-keys)，选择有权限的项目并创建Key；看不到已有项目时先在Projects导入。AI Studio当前新建Key为auth key，旧Key被标Blocked时应更换。账单和额度归属对应项目，地区和网络也需受支持。[官方项目、权限与Key教程](https://ai.google.dev/gemini-api/docs/api-key)。

## 智谱 GLM

0.11.12-test支持`glm-5.3-flash`与`glm-5.3-flashx`，同一标准Key可选择五款GLM。有对应赠送资源包时先核对适用型号与到期时间，按需使用；扣减由平台结算，App不能保证只扣赠送额度。[资源包使用教程](glm-resource-packs.md)

0.11.11-test新增付费视觉型号`glm-4.6v-flashx`，与免费GLM共用标准API Key。需要充值的是智谱模型标准API余额，无需购买编程包月套餐。打开[当前官方控制台](https://bigmodel.cn/console/overview)登录后查看余额与充值；金额及支付方式以收银台为准。[完整充值与设置教程](glm-flashx.md)

登录[API Keys页](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)，创建「模型标准API」类型的Key，回食刻可先选`glm-4.1v-thinking-flash`，与`glm-4.6v-flash`共用一组标准Key。个人编程套餐、团队编程套餐和模型标准API的Key分开管理，不要混用。[官方快速开始](https://docs.bigmodel.cn/cn/guide/start/quick-start) · [Key分类说明](https://docs.bigmodel.cn/cn/coding-plan/notice/api-key-management)。

查看[免费GLM-4.1V-Thinking-Flash说明](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.1v-thinking-flash)。2026-10-24授权诊断中，4.1V连接探针通过、公开餐食样图一次24.9秒通过基础食物校验（不合格营养已舍弃），4.6V返回HTTP429／1305访问量过大；这不能证明4.6V永久下线。4.1V有内置思考，复杂图片可能超时。应用现按完整think/answer标签及box特殊标记取最终答案，继续校验JSON与字段。429须区分1305繁忙、1302限流和1113欠费，不能一概解释为免费额度耗尽。

若提示「模型结果结构不符合要求」，表示软件已经取得可解析的模型内容，但字段格式或约束不合格，与Key无效、余额不足、模型不存在的错误不同。0.11.7-test补充GLM格式提示，并在仅营养估算错误时保留通过校验的基础食物、舍弃无效营养并显示警告；从食物库选择或手动补充即可继续。错误重量、包装标签或截断结果仍会拒绝，不自动重试，也不增加模型调用次数。原始响应未提供，未确认用户此次错误的具体字段。

## 常见失败

- 401：检查Key完整性、平台是否选错，以及Key是否被撤销。
- 402：核对平台余额或可用额度。
- 403：核对项目、地域、服务开通与模型权限。
- 429：检查限流或额度，稍后重试；多建Key或配置不保证增加额度。
- 超时：检查手机到对应平台的网络。免费端点也可能排队或暂时无可用上游。

不要把Key发到聊天、截图或仓库。教程只展示申请步骤和官方链接，不读取已保存Key，不会自动测试模型。读取配置和切换模型也不会把明文Key返回网页。
