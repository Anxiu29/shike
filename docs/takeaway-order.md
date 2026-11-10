# 外卖订单识别：使用方法与代码教学

本次实现复用现有多模态记餐助手，新增独立的“外卖订单识别”用途。支持上传订单截图、拍摄小票或粘贴订单文字，整理成可编辑的一餐草稿。网页服务和安卓个人模型直连使用同一组订单规则；本机离线文字模型暂不支持订单模式，也不会自动把订单转交在线模型。

这里的“识别”由用户所选在线模型完成，没有接入美团、饿了么账号、订单 API 或独立 OCR 服务。能够提交截图不等于已经验证所有平台版式的识读准确率。

## 1. 怎么使用

1. 首页打开 **AI记餐**，在“本次用途”选择 **外卖订单识别**。已有对话先点击“新对话”。
2. 选择支持图片的在线模型，点击“选图”上传订单截图，或“拍照”拍小票；也可以直接粘贴商品清单文字。上传和粘贴后都需要点击“发送”。
3. 建议截图只保留商品区。长订单分张发送，每轮一张，最近最多三张参与上下文；不要将整页长截图压缩到文字无法辨认。支持 JPEG、PNG、WebP，原图最多20MB，压缩后JPEG最长边1280px、最多1MB。
4. 核对食物名称、数量、套餐组成和匹配的食品。比如订单是多人份，移除别人的菜；没吃完可继续说“只吃两个”“米饭只吃一半”。
5. 简单数量可在草稿里改，单位、克重、食品库和营养请进入“详细编辑”。数量不允许填0，未吃的条目直接移除。
6. 直接保存前勾选“已按实际食用量核对”，再点击“确认保存”。任何成功的草稿更新或手动数量修改、删除都会重置这项勾选。进入详细编辑不需要先勾选，仍由编辑器的保存按钮最终提交。

订单图片只留在当前会话内存，不自动存入餐次照片或备份；确认保存只写入核对后的食物记录。关闭助手后重开仍保留本次会话，新对话或退出应用后清除。成功保存或转详细编辑时清除发送给后续请求的订单上下文，防止新餐重新使用旧订单。服务商接收图片的处理方式取决于所选平台；应用不自动裁掉截图内的姓名、地址、电话，发送前应自行只截商品区域。

图片已发过但想换模型时，在上方选择另一在线模型，再点击“用当前模型重新分析上一张图片”。复用最近一张仍在上下文中的订单截图，重新分析成功后重置食用量核对；模型切换本身不会提交图片。若有待发送文字或新附件，请先处理当前输入。

没有在线Key时，Mock会明确回复不能识别订单，不会用固定“两个肉包”冒充订单结果。

## 2. 订单识读为什么不能直接等于热量计算

订单通常能提供菜名、规格、件数，却不能证明某个人吃了多少，也通常没有可靠的熟重、油量和每100g营养。

- `肉包（2个装）×3`：识读目标是6个肉包，再由用户核对实际吃了几个。若模型正确返回6个，程序按现有参考份量80g/个得到480g；480g是产品份量假设，不是订单实测克重。
- `可乐500ml×2`：目标先记2份，名称保留500ml规格。不能直接把商品容量当作实际喝了1000mL；实际容量和营养可在详细编辑核对。
- `双人套餐×1`：明确列出且能对应套餐层级时展开子项，不再重复记录套餐父项；组成不清时保留套餐名称并提示编辑。未知套餐匹配不到营养时显示待补充。
- 配送费、打包费、餐具、优惠、单价和付款金额不能算作食品或数量。明确取消、全额退款、未送达的商品排除，部分退款或状态不清时追问。

套餐展开、数量相乘、退款状态和多张截图去重属于模型的语义识读规则。程序会检查JSON结构、数量范围和可保存的数据，但无法仅凭JSON确认模型是否真的读对了截图，因此保留原图预览和人工核对步骤。

## 3. 从入口沿调用链阅读

建议按下面顺序打开源码：

1. [MealAssistant.vue](../packages/web/src/components/MealAssistant.vue)：`inputKind`选择用途，`send()`发请求，`confirm()`保存。
2. [api.ts](../packages/web/src/lib/api.ts)：`describeMeal()`选择网页服务、安卓直连或本机路由。
3. [shared/meal-assistant.ts](../packages/shared/src/meal-assistant.ts)：请求契约、`assistantPrompt()`、`assistantBody()`和返回值校验。
4. [takeaway-order.ts](../packages/shared/src/takeaway-order.ts)：独立订单任务规则。
5. [server/meal-assistant.ts](../packages/server/src/meal-assistant.ts) 与 [personal-vision.ts](../packages/web/src/lib/personal-vision.ts)：两种在线请求入口。
6. [web/lib/meal-assistant.ts](../packages/web/src/lib/meal-assistant.ts)：`assistantEntry()`匹配食品、换算份量、增加订单来源提醒。

```text
用途=order + 截图/文字
  → 请求Schema校验
  → 网页服务 / 安卓直连
  → 通用提示词 + 订单专用提示词 + 真实图片内容块
  → 模型返回一餐JSON
  → 返回Schema校验
  → 本地食品库与份量规则
  → 草稿核对 / 详细编辑
  → 用户确认后存入IndexedDB
```

## 4. 第一步：增加任务类型，保持旧请求兼容

共享请求Schema新增可选字段：

```ts
inputKind: z.enum(['meal', 'order']).optional()
```

`meal`是普通餐食聊天，`order`是订单识别。旧请求没有这个字段仍走原来的通用提示词，不修改历史餐次结构、数据库版本或备份格式。

请求示例（日期和餐次来自当前页面和用户选择）：

```ts
const request = {
  inputKind: 'order',
  text: '饮料是别人的，我只吃两个肉包',
  date: '2026-10-28',
  mealType: 'lunch',
  imageBase64: compressedJpegBase64,
  // previous: 当前尚未保存的草稿,
  // history: 最近三轮对话，含此前的订单截图,
}
```

Zod的`.strict()`拒绝未定义字段，例如客户端擅自传`apiKey`或任意提示词。TypeScript只约束开发时写的代码，Zod还会在运行时检查真正收到的输入。

`inputKind`只在请求里控制任务，不由模型决定。界面在当前对话开始后锁定用途，避免同一对话里的订单截图混进普通餐食照片的自动保存逻辑。

## 5. 第二步：把任务规则放在共享层

`TAKEAWAY_ORDER_PROMPT`集中描述如何提取商品、排除费用、处理套餐、数量、规格、退款、截断和重复截图。通用助手仍负责日期、餐次、追问和继续修改：

```ts
export function assistantPrompt(request: AssistantRequest): string {
  return request.inputKind === 'order'
    ? `${ASSISTANT_PROMPT}\n${TAKEAWAY_ORDER_PROMPT}`
    : ASSISTANT_PROMPT
}
```

为什么把它写成函数：网页服务由`assistantBody()`组装上游请求，安卓由`describePersonalMeal()`把提示词交给原生插件。两处调用同一函数，订单规则才能保持一致。只改Node服务器会漏掉独立APK的直连模式。

现有安卓插件已经接受`prompt`、序列化`request`和JSON Schema，并会把图片转成上游视觉内容块。本次无需新增Java接口，也不增加平台端点或Key存储方式。

图片不能只写进普通文字JSON。`assistantContext()`将图片从文本里移出，使用`imageNumber`对应原消息；供应商适配器再发`image_url`或Gemini的image内容块。连续发送的截图和描述因此能一起参与识读。

## 6. 第三步：继续使用同一份草稿契约

以下是预期的模型返回示例，不是本次真实模型实测结果：

```json
{
  "intent": "update",
  "date": "2026-10-28",
  "mealType": "lunch",
  "foods": [{ "name": "肉包", "amount": 6, "unit": "个" }],
  "message": "已整理订单草稿，下单数量不等于实际摄入，请核对。"
}
```

`parseAssistantDraft()`先解析JSON，再检查共享Schema。负数量、非法单位、无效日期、超过10项或额外营养字段都会被拒绝；出错时前端保留待发送文字、图片和原草稿。

`intent`控制状态变化：

- `update`：用新返回的完整食物清单替换草稿。
- `question`：只展示回复，保留已有草稿。
- `clear`：用户明确清空时移除未保存草稿。

“肉包改成两个”应返回完整的新清单；“问一下怎么调整数量”应使用question。这样问答不会把之前整理好的订单清掉。

JSON Schema和Zod约束格式，不保证语义识读准确。套餐数量相乘和截图去重并没有另写一套可独立保证正确的OCR算法。

## 7. 第四步：由程序生成营养快照

前端复用已有转换器，额外传入用途：

```ts
const foods = next.foods.map(food =>
  assistantEntry(food, personalFoods, packagedFoods, inputKind)
)
```

`assistantEntry()`内部仍调用原来的食品库匹配和份量换算。克数不明时使用带说明的参考份量，匹配不到营养继续保留null，不能把null当0。订单来源附加到`provenance`，并把“下单数量不等于实际摄入”的说明加入`warnings`。

来源和警告是条目快照的一部分，因此转详细编辑、存入记录后仍可核对。原食品库的来源前缀保持不变，个人食品来源判断也继续工作。

这部分是确定性代码，能在单元测试里验证。例如输入6个肉包，当前80g/个的参考规则应得到480g；改成2个后应得到160g。这样的测试验证换算，不验证模型有没有把图片中的“×3”读对。

## 8. 第五步：保存约束要写进函数

Vue的`ref(false)`保存核对勾选状态。界面使用`:disabled`给出反馈，保存函数也独立检查：

```ts
if (inputKind.value === 'order' && !orderReviewed.value) {
  error.value = '请先按实际食用量核对订单，或进入详细编辑。'
  return
}
```

仅禁用按钮不足以约束函数被程序直接触发的情况，因此两层都保留。每次草稿内容更新都把`orderReviewed`重置，防止拿旧勾选确认新数量；普通问答不改变草稿，也不重置勾选。

订单与普通图片在保存时分开处理：订单模式的`draftPhotos`始终为空，`saveMeal()`因此只保存食物记录。截图仍能在聊天里点开检查，但不会自动出现在首页餐次照片中。

## 9. 如何运行和验证

在项目根目录运行：

```powershell
npm run build
npm run dev
```

构建会依次编译shared、server和web；开发模式启动服务与网页。要识读真实订单，需要配置现有在线模型，不要把Mock演示当真实识读。

定向单元与接口测试：

```powershell
npm test -- packages/shared/tests/meal-assistant.test.ts packages/server/src/meal-assistant.test.ts packages/web/tests/meal-assistant.test.ts packages/web/tests/personal-vision.test.ts packages/web/tests/offline-assistant.test.ts
```

浏览器验证（需先构建）：

```powershell
npm run test:e2e -- tests/e2e/takeaway-order.spec.ts tests/e2e/meal-assistant.spec.ts
```

新测试验证任务类型能传到网页和安卓桥接、非法结果被拒绝、离线不自动转在线、失败保留附件、数量修改重置核对、重复点击不重复写入，以及订单截图不随餐保存。浏览器使用模型替身和合成截图，不能证明真实OCR准确率、厂商网络或Android真机表现。

2026-10-28验证：全量68个测试文件、575项单元/接口测试通过；类型检查和生产构建通过；订单与原有助手流程在Chrome手机、Chrome桌面、Edge桌面共42项浏览器测试通过。构建仍有前端资源块体积提示，不影响本次构建完成。

订单功能没有新增真实订单的在线调用或Android真机安装验收。2026-10-29已纳入0.11.30-test APK并完成最终包页面回归，签名、资源与安装包说明见[安卓测试版](android-app.md)。
