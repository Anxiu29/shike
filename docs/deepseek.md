# DeepSeek拍照识别：配置与调用

核验日期：2026-10-20。0.9.9-test新增官方DeepSeek提供商，模型固定为`deepseek-flash`。现共有六个平台、十个可选模型，仍手动选择，不自动换Key或模型。

## 型号与费用

官方当前文档确认`deepseek-flash`支持图片和JSON输出，服务版本为DeepSeek-V4.1-Flash-1017。`deepseek-v4-pro`不支持图片，因此不加入拍照列表；也不使用已退休型号的旧别名。[官方型号与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) · [图片输入](https://api-docs.deepseek.com/zh-cn/guides/vision/)

这是按量计费API，不承诺免费。按每百万Token计：未命中缓存的输入为空闲1元／高峰2元，输出为空闲4元／高峰8元；命中缓存的输入另有低价。高峰为北京时间工作日9–12点、14–18点，法定节假日除外。实际费用与赠送余额以平台为准。[计费与时段规则](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

算术示例：假设含图片、提示词共3000输入Token、结果3000输出Token，未命中缓存，空闲约`(3000×1+3000×4)/1000000=0.015元`，高峰约0.03元。它不是每张照片的固定费用或实测均值；照片、食物数、返回长度都会改变用量。

## 手机操作

1. 先导出JSON备份，再用同签名的0.9.9-test APK覆盖安装；不要先卸载。
2. 登录[DeepSeek开放平台](https://platform.deepseek.com/api_keys)，创建自己的API Key，检查账户余额。聊天网站账户能聊天，不表示API有余额。
3. 食刻 → **设置 → 我的AI模型 → 添加模型配置**。提供商选“DeepSeek · 官方”，模型为`deepseek-flash`，输入名称和Key。
4. 点击“测试并保存”。应用发送一张内置测试图，成功后加密保存，可能消耗少量余额；第一组默认选用，其他组需要点击“选用”。已有配置不会被替换。
5. 拍照页面也可以切换到这组配置。识别后检查食物、重量、营养估算或包装标签再保存。测试图成功不证明餐食或称重准确。

Key只交给原生插件，在Android私有空间用Keystore配合AES-GCM加密，不放入饮食备份、localStorage或IndexedDB。输入时短暂经过页面内存，具体边界见[多模型教学](personal-models.md)。

## 电脑网页版

普通浏览器使用本机Node后端，在根目录`.env`配置：

```dotenv
AI_PROVIDER=deepseek
AI_MODE=auto
DEEPSEEK_API_KEY=在本机填写自己的Key
```

重启开发服务；生产模式需先`npm run build`再`npm start`。若继续用其他默认模型，只增加`DEEPSEEK_API_KEY`也可以，识别下拉框会列出DeepSeek。没有该平台Key时不列为额外可选配置；默认DeepSeek缺Key的auto模式明确显示Mock，live模式拒绝启动。不要把Key写到`VITE_`变量或发到聊天里。手机独立版不需要电脑配置这些变量。

## 实际请求与代码

固定请求`POST https://api.deepseek.com/chat/completions`，鉴权放请求头`Authorization: Bearer <自己的Key>`。餐食图使用压缩后的内联JPEG，不调用Files API创建上传文件，不创建会话。图片只放在user消息。[官方视觉协议](https://api-docs.deepseek.com/zh-cn/guides/vision/)

```ts
// 示意：实际发送在Node适配器或Android原生插件中，网页不拿保存后的Key。
const body = {
  model: 'deepseek-flash',
  thinking: { type: 'disabled' },
  response_format: { type: 'json_object' },
  max_tokens: 8192,
  messages: [
    { role: 'system', content: FOOD_PROMPT }, // 含JSON要求及结构示例
    { role: 'user', content: [
      { type: 'text', text: FOOD_REQUEST },
      { type: 'image_url', image_url: {
        url: `data:image/jpeg;base64,${compressedImageBase64}`, detail: 'high',
      } },
    ] },
  ],
};
```

DeepSeek默认开启思考，食刻显式用`thinking.type=disabled`；不沿用百炼的`enable_thinking`或OpenRouter路由参数。[思考参数](https://api-docs.deepseek.com/guides/thinking_mode/)

`json_object`不保证字段、数值和识别内容正确，且官方说明可能返回空content。应用拒绝空输出、截断、非法JSON与不合格结构，再用共享Zod规则校验。收到402会提示余额不足，429、网络失败及超时保留草稿，不自动重试或回退Mock。[JSON输出说明](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)

维护入口：`packages/shared/src/personal-vision.ts`定义提供商、模型、地址与参数；`packages/server/src/vision/compatible.ts`发送后端请求；Android的`VisionPolicy.java`独立白名单和`PersonalVisionPlugin.java`负责本机直连。共享来源枚举同步加入DeepSeek，餐食、包装、AI食物存库与v10备份可保存该来源，无需修改历史格式。

应用不永久保存照片或原始模型响应；发给DeepSeek的内容受其服务政策约束，客户端不能控制提供商内部处理。本轮使用模拟HTTP响应与原生桥测试接入，**尚未用真实DeepSeek Key调用，也没有餐食准确率或延迟对照**。

交付验证：351项单元／接口测试、类型检查和生产构建、4项Android策略测试及签名验证通过。实际0.9.9-test APK解包资源禁外部网络、使用模拟原生桥，通过Chrome手机、Chrome桌面和Edge的12项回归，包括余额错误后保留模型、手动重试、编辑保存与刷新恢复。versionCode为19，沿用上一版签名；下载文件与本地校验值一致。机器结果在忽略目录`artifacts/android/deepseek-verification.json`，不含Key。
