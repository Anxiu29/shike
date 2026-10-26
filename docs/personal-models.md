# 手机自配 Key 与多模型教学

0.11.14-test将「修改」和「管理可用模型」改为直接打开独立弹窗，标题下显示正在修改的Key组。配置名称、提供商、当前型号和已启用型号即时回填；打开本身不测试模型，也不读取或显示明文Key。提供商仍锁定，Key留空沿用。保存与取消固定在底部，测试时禁用重复保存和关闭，失败保留原配置并在弹窗显示错误。教程先返回编辑，再返回设置；取消不提交修改，关闭后恢复原按钮焦点。

0.11.8-test新增OpenRouter `nvidia/nemotron-3.5-super-vl:free`与`dots-studio/dots-3-note-preview:free`。已有OpenRouter组点「管理可用模型」勾选即可，Key可留空继续共用；原有模型和当前选择不会被升级改选。新建OpenRouter配置默认列出Nemotron，但仍需用户测试并保存。NVIDIA免费端点会记录请求用于安全与产品改进，不能上传人脸、声音或个人／敏感信息；Dots预览当前标注2026-12-31下线。公开目录可用不等于用户账号一定有权限。[核验来源与暂不加入的候选](free-vision-models.md)。

0.11.7-test改善GLM视觉输出兼容：补充字段类型提示，移除视觉接口未承诺的格式参数。仅可选营养估算错误时，保留通过校验的名称与重量并显示「已舍弃该项AI营养数值」，请从食物库选择或手动补充。错误重量、包装标签或截断结果仍拒绝；不会增加调用次数或自动改选模型。原始响应未提供，尚未确认用户此次错误的具体字段，也未用用户Key实测。

0.11.6-test：一组保存一把Key，并在组内勾选多个同平台模型；更换Key一次对整组生效。六个平台申请步骤已内置，入口为「API Key申请与多模型教程」。[统一申请教程与官方来源](model-api-keys.md)。

0.9.9-test新增官方DeepSeek `deepseek-flash`视觉识别，标为按量计费。[DeepSeek配置、价格与调用说明](deepseek.md)。

0.9.8-test新增硅基流动、OpenRouter及百炼视觉专用模型，页面区分平台免费、免费端点与赠送额度。[新增模型、Key获取与调用参数](free-vision-models.md)。

0.7.0：识别面板可直接选择保存过的配置；切换本身不测试模型、不发起收费请求，下一次识别使用所选项。自建服务入口默认关闭，旧云端偏好不会阻止安卓直连。AI 可以付费；免费包装食品查询与模型调用独立。[OFF 接入教学](open-food-facts.md)

从 0.3.0 测试 APK 开始，安卓可以直接调用模型，不需要电脑、FC、OSS 或自己的域名。需要网络访问模型厂商；这不是把大模型安装到手机。手动记录、食物库、历史和体重仍可离线使用。

## 在手机上操作

1. 如果正在使用旧局域网预览版，先在旧版“设置 → 导出备份”，通过系统菜单保存 JSON。再安装 `shike.apk` 并恢复备份。旧 LAN 网页与独立 APK 的数据来源不同；不要先卸载或清数据。已经使用 `https://localhost` 的独立版通常可以原位升级，仍建议备份。
2. 打开新版“设置 → 我的AI模型”。当前默认不显示自建服务连接选择。
3. 点击“添加Key配置”，填写名称并选择平台，在“这把Key可使用的模型”中勾选一个或多个型号，选择默认模型，Key只粘贴一次。没有Key可点申请教程。
4. 点击“测试并保存”。App 向所选提供商发送一张内置 64×64 测试图，检查鉴权、基础视觉调用及返回完成状态，可能消耗少量额度。成功才加密保存；失败保留已有配置。测试图通过并不证明餐食识别的 JSON 结构、重量或热量准确。
5. 第一组成功配置会标记“使用中”。其他Key组需点“选用”，同组模型可在识别面板下拉切换。最多12组Key；模型权限、地域和额度仍由平台决定。
6. 回到“饮食”拍照或选图，核对食物、重量和估算情景后保存。失败不会自动切换 Key、模型或提供商，也不会自动重试。

支持的模型：百炼北京区 `qwen3.7-flash`、`qwen3.8-flash`、`qwen3.7-plus`、`qwen3-vl-plus`；DeepSeek `deepseek-flash`；硅基流动 `Qwen/Qwen3.5-4B`；OpenRouter `nvidia/nemotron-3.5-super-vl:free`、`dots-studio/dots-3-note-preview:free`；Gemini `gemini-3.5-flash-lite`；GLM `glm-4.1v-thinking-flash`、`glm-4.6v-flash`、`glm-4.6v-flashx`、`glm-5.3-flash`、`glm-5.3-flashx`。这是可选适配列表，不是免费或稳定可用的保证。五款GLM可共用一组标准Key；先核对匹配的有效资源包，再按需充值，详见[资源包教程](glm-resource-packs.md)。已有免费组不会自动启用付费型号。Gemini和OpenRouter需要手机网络可访问对应服务；GLM可能持续429，不在后台自动尝试。

百炼 Key 与地域不能混用：[官方创建入口说明](https://help.aliyun.com/zh/model-studio/get-api-key)。在百炼控制台选择北京区，创建可访问所选模型的 Key，再复制到手机。支持时可在控制台开启“免费额度用完即停”；免费额度、有效期、账户余额与实际费用以控制台为准，App 不会读取账单，也不能保证零费用。不要把百炼 Key 当作阿里云 RAM AccessKey 使用。

编辑配置时，Key 输入框保持为空，留空表示复用原 Key；填写则更换。可以修改同一提供商下的模型，保存时会重新测试。更换提供商请新增配置，避免混用 Key。删除“使用中”的配置后，不会自动改选另一组，必须手动选用。清空模型配置只删除本机模型凭据，不删除饮食与体重，也不会在厂商后台撤销 Key；需要撤销时去厂商控制台操作。

## 一次识别如何调用 AI

代码入口依次为：

1. `packages/web/src/lib/image.ts` 解码并重编码照片，去除元数据，最长边 1280 像素、压缩至 1 MB 以内 JPEG，只在内存处理。
2. `packages/web/src/lib/api.ts` 根据用户选定的连接方式，调用直连适配器或原有后端。
3. `packages/web/src/lib/personal-vision.ts` 读取不含 Key 的模型元数据，将图片 Base64、公开提示词和 Schema 交给 Capacitor 原生插件。先固定本次配置快照，避免切换模型导致旧响应标签混乱。
4. `PersonalVisionPlugin.java` 解密这组配置，仅向提供商的固定 HTTPS 地址请求。Key放请求头，不放URL。百炼、DeepSeek、GLM、硅基流动和OpenRouter使用chat completions；Gemini使用Interactions，`store:false`，不创建上传文件或可检索会话。OpenRouter固定`:free`及零价格路由，不允许回退到付费模型。
5. 原生层返回模型响应与提供商、模型名，不返回 Key。JS 执行完整 JSON 解析与共享 Zod 结构校验，拒绝截断、非法数值和没有假设的营养粗估。三档范围的默认中值由代码重新计算。
6. 食物库与参考配方优先匹配，缺库才使用标记的 AI 估算；用户编辑后，餐食及营养快照写入 IndexedDB。当前模式不经过食刻后端。

提示词、上游 JSON Schema 和解析规则位于 `packages/shared/src/vision-prompt.ts`、`vision-parse.ts`；网页后端也复用这些规则。增加模型时须同步修改共享模型列表和原生 `VisionPolicy.java` 的白名单，增加适配测试后再发布；不接受任意自定义 API 域名，以免将 Key 发错网站。

```ts
// 不读取 Key，也不直接在 WebView fetch 第三方服务。
const response = await native.recognize({
  id: selectedProfile.id,
  imageBase64: compressedJpegBase64,
  prompt: FOOD_PROMPT,
  schema: recognitionJsonSchema,
});
// 必须继续校验响应，不能只因为 HTTP 200 就保存为成功记录。
```

## 凭据与成本边界

本功能按用户要求调整了最初“模型 Key 只保存在服务端”的设计。每个人使用自己的 Key；开发者的 Key 不打包进 APK，也不分发给朋友。普通网页和 LAN 预览版继续通过后端调用，原生插件拒绝远程预览页面访问手机 Key。

配置库整体使用 AES-256-GCM 加密，随机 IV、认证附加数据；加密密钥由 Android Keystore 生成和管理，密文留在安卓应用私有 SharedPreferences。API Key 本身需要在请求时解密使用，不是永远无法提取的 Keystore 密钥。输入时 Key 短暂经过页面和桥接；保存后没有读取明文 Key 的接口。关闭 Capacitor 桥接日志与 WebView 调试；不把 Key 写入 localStorage、IndexedDB、环境构建变量、备份或照片日志。应用禁止系统自动备份，换设备需要重新配置。

这降低静态存储泄露风险，不能防止已被攻破的设备、运行时窃取或恶意 App 版本。调试 APK 供个人测试，不是安全审计通过的商店发行版。[Android Keystore 官方说明](https://developer.android.com/privacy-and-security/keystore)。百炼官方仍建议移动客户端避免使用长期 Key；公共服务统一使用开发者额度时，应选择后端与短期授权方案，而不是共享长期 Key。[百炼安全提示](https://help.aliyun.com/zh/model-studio/get-api-key)

本机一次只处理一个模型操作，每分钟最多 5 次、北京时间每天 100 次请求，含测试和失败；计数落盘，重启保留。它只是防误触保护，不是厂商账单限制，也不是跨手机全局额度；重装、改时间等可绕过。禁止重定向，连接超时 10 秒、读取超时 45 秒、整体约 55 秒截止，成功响应最大 512 KiB。处理 401、402、403、429、超时及网络错误，不显示厂商原始错误正文，不自动重试。

Key、照片和模型响应均不进入饮食备份。应用不永久保存识别照片，提供商仍按各自政策处理请求；Gemini 免费服务可能将内容用于产品改进。选择模型时也应考虑网络可达性和数据处理政策。

## 验证与仍需真机确认

`npm test` 覆盖直连路由、元数据过滤、多配置选择、不落盘 Key、JSON 和截断拒绝、无自动切换。Playwright 模拟原生桥验证多配置、编辑、失败保留、识别保存刷新与删除行为。APK 构建同时运行原生白名单与错误映射 JUnit 测试并验签。模拟桥不是 Keystore 或 Android 网络真机测试；实际手机还需验证输入保存、强退重开、相机/相册、至少一次真实餐食识别、备份分享和升级恢复。

“连接食刻服务”的代码及 [FC 部署文件](cloud-deployment.md) 保留供以后使用，默认入口停用。若开发者确需恢复，可在 `packages/web/.env.local` 设置非密钥开关 `VITE_ENABLE_SERVICE_CONNECTION=true` 后重新构建；普通测试不需要设置它。
