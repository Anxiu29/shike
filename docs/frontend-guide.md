# 前端教学：对照代码追踪一次编辑与保存

项目全景先看 [开发指南](development-guide.md)。这里聚焦Vue状态、条目转换、本地事务与原生桥。当前IndexedDB结构版本6，JSON备份格式版本11。

## 1. 从App.vue理解状态和事件

[main.ts](../packages/web/src/main.ts)创建Vue应用，[App.vue](../packages/web/src/App.vue)持有页面数据和顶层状态：

```ts
const tab = ref<'diary' | 'weight' | 'goals' | 'settings'>('diary')
const meals = ref<MealRecord[]>([])
```

ref变化会让依赖它的界面更新，脚本写meals.value，模板通常直接写meals。这是当前内存状态；保存的数据来自lib/db.ts。refresh读取本地后更新ref，checkHealth另行异步执行，断网不阻塞打开记录。

views是页面，components是可组合界面，lib放网络/存储/业务转换。当前用tab和v-if切页面，没有Vue Router或Pinia。KeepAlive只缓存目标页实例，不能当成全应用永久草稿存储。

跟随模板的`:属性`与`@事件`阅读：FoodEditor收到record等props，发出save后由App.persist保存，成功再刷新/关闭，失败调用saveFailed保留草稿。子组件发事件表示意图，父层决定如何提交。

## 2. 编辑中的数据为什么先复制

[FoodEditor.vue](../packages/web/src/components/FoodEditor.vue)从历史记录复制items，防止取消编辑时已经改变原记录。识别候选、原模型名称/估重、弹窗筛选等临时数据单独留在内存。

- ref用于items、phase、saveBusy等可变化状态。
- computed用于总营养、忙碌状态、当前弹窗条目，避免另存第二套推导结果。
- watch用于跟随父层数据更新表单，或在日期改变时清理失效草稿。

先读processFile、runRecognition、selectFood、submit，再读它们调用的lib函数。模板中的事件可帮助反查按钮究竟调用哪个入口。

## 3. 图片压缩与网络调用

[compressImage()](../packages/web/src/lib/image.ts)检查格式、空文件、20MB原图和解码像素上限，用Canvas将最长边缩到1280px、重编码JPEG，再调质量/尺寸达到1MB目标。ImageBitmap与预览Object URL需要释放；保存餐次时照片进入独立 mealPhotos 表，与餐次同事务提交；v11 备份包含这些压缩照片。取消未保存草稿仍会释放内存图片。

[recognizeImage()](../packages/web/src/lib/api.ts)是统一入口：网页FormData请求/api/recognitions；安卓直连模式交 [personal-vision.ts](../packages/web/src/lib/personal-vision.ts) 的Java插件。两条路返回同一RecognitionResponse，组件不用理解供应商协议。

multipart不能手设Content-Type，否则可能丢失boundary。AbortController限制客户端等待70秒；网络失败、超时和非法JSON分别报错，响应再次通过共享Zod校验。真实失败不伪装成模拟成功。开发时Vite代理/api到3001，生产由Node同源提供网页和API。

服务端仍独立验证文件签名、MIME、2MB上传上限和像素，清洗后才交模型。详细路径见 [开发指南](development-guide.md#4-一张照片的完整调用链)。

## 4. 响应怎样变成编辑条目

[prepareRecognition()](../packages/web/src/lib/recognition.ts)每遍历一项模型食品，创建一条草稿，重量随同一条目传递，不平均盘子重量，也不将混合菜配料重复记账。

有包装标签先建立包装快照；普通条目交 [matchedEntry()](../packages/web/src/lib/entries.ts)，依次考虑配方、基础库、同名个人估算和本次AI粗估。旧个人单值没有有效热量三档时，本次有效三档可优先，最终保存才升级库条目，历史餐食不变。

recognitionMatchName可去“一小碗”等数量/容器词，但保留生熟、糖、油、酱料差异。规范名称用于条目，原视觉名称留context供核对。

当前入口再用 [applyTypicalPortion()](../packages/web/src/lib/typical-portions.ts) 为首次未知量补带标记的常见份量。已有量、明确0不覆盖，历史加载/备份恢复不补值。底层保留未知、上层可补假设，是两个阶段。

recognitionEstimate把模型营养封装为候选，可靠库已匹配时仍允许从“本次识别”主动选择它。候选不等于默认采用数据。改成另一种食品时rematchRenamedEntry清除旧依据；仅空白/括号差异保留，明确手填营养允许保留。

## 5. 食品库、搜索、收藏与手动填写

[buildFoodChoices()](../packages/web/src/lib/food-picker.ts)合并公共精简库、配方、个人估算、包装、个人食品、AI候选与当前历史快照。

searchFoodChoices允许别名、原文、配料和同义词检索，不放宽自动匹配规则。recommendFoodChoices按名称和可见配料本地排序，最多6项；没有线索可不推荐。它不请求模型、不自动替换食品，也不是识别概率。

Map/WeakMap缓存ID查询和搜索文本，避免每次输入重建全库索引；[FoodPicker.vue](../packages/web/src/components/FoodPicker.vue)按60项追加渲染。生肉、生蛋和待烹调干料默认隐藏，可主动开启；当前历史项仍能展示。

点食品才选择，星标只收藏。toggleFoodFavorite按稳定选择ID切换，公共库取消收藏删副本，个人食品只关收藏标记。公共库项将来移除，收藏时快照仍可用。

FoodEditor.storeFood调 [saveLibraryFood()](../packages/web/src/lib/db.ts) 显式存完整快照，与保存一餐独立。忽略ID后完整内容相同才去重，同名不同配方/档位/份量可并存，模拟来源不可存。entryForFoodChoice再添加时深拷贝并生新ID，不改库和旧餐食。

[ManualFoodSheet.vue](../packages/web/src/components/ManualFoodSheet.vue)当前先开食品库，再允许手填。确认后发add给父编辑器，取消不留空条目，最终保存一餐才进历史。手填营养时未填字段保持未知，不从其他来源补齐。

## 6. 份量、容量、三档和精度

[PortionAmountInput.vue](../packages/web/src/components/PortionAmountInput.vue)是受控组件：props接收amount/basis/portion，change事件交父层更新。[portions.ts](../packages/shared/src/portions.ts)计算数量×单份大小，例如2个×80g=160g；大小是假设而非标准实测。

已有重量切“个/碗”先保留总量，再核对数量和大小；g切mL清空旧数值，不能默认密度1。包装由 [PackageLabelEditor.vue](../packages/web/src/components/PackageLabelEditor.vue) 按标签g/mL/份/包换算，缺失量仍未知。

普通条目换重与配方缩放交entries.resizeEntry，避免一道菜和配料双计。三档用共享applyEstimateLevel，取选中档每100g范围中值；换重缩放整份范围，切档不请求模型。油档替换原油；手改确定营养或具体配料撤销不再适用的范围。

[calculateNutrients()](../packages/shared/src/nutrition.ts)算单条，aggregateNutrients汇总known/missing，entries.aggregateEnergyRanges另汇总区间。旧单值可在汇总中作相同上下限，但不为它伪造三档。dates.ts只控制显示最多两位，内部保留完整精度。

## 7. 事务保存与备份

[saveMeal()](../packages/web/src/lib/db.ts)校验后，将餐食、符合条件的个人AI估算及当日计划放同一事务，全部成功才提示已保存。未保存候选、Mock、手填营养、已用可靠库的条目不进入自动估算表。

JSON转换用于剥离Vue Proxy；只因这些领域数据仅含JSON值才适用，不能当成处理任意Date/Map/循环引用的通用复制。数据库结构6包含10张表，备份11可读1～11，两种版本独立演进。

恢复先校验结构、日期、重复主键/名称和跨字段算术，预览后确认整体替换；清空与回填在同一事务，失败回滚。恢复不重新执行saveMeal生成估算库，也不重算营养。照片、模型Key和访问凭证不进备份。

origin决定本地数据空间，协议、主机和端口变化都可能换库；手机/电脑、localhost/127.0.0.1不自动共享记录。

## 8. 日期、同步、弹窗与返回入口

- [DateField.vue](../packages/web/src/components/DateField.vue)：modelValue与临时selected分开，确定才提交，取消不清空；AppSheet恢复焦点；保存本地YYYY-MM-DD，不用UTC截断代替。
- [synced-draft.ts](../packages/web/src/lib/synced-draft.ts) 和 [GoalsView.vue](../packages/web/src/views/GoalsView.vue)：未改字段接收新值，已改字段留草稿，保存只交变化字段，事务合并最新设置。目标/体重/预算共用weightOnDate。
- [AppSheet.vue](../packages/web/src/components/AppSheet.vue)：Teleport、dialog、焦点循环、背景滚动锁、visualViewport与busy关闭保护；安全区和短视口样式在style.css。
- [back-navigation.ts](../packages/web/src/lib/back-navigation.ts)：最上层有效层优先，异步关闭防重复；KeepAlive失活暂停层。App处理页面历史及首页二次返回退后台。
- [DailyWellness.vue](../packages/web/src/components/DailyWellness.vue) 与 [PushupQuickEntry.vue](../packages/web/src/components/PushupQuickEntry.vue)：独立内存草稿、预览、事务保存与撤销；手环差额/运动公式委托shared，不在组件复制公式。

这些文件头和关键函数旁已保留局部文档中的理由、约束和回归入口。公式来源见 [wellness.md](wellness.md)，设备实测步骤见 [android-app.md](android-app.md)。

## 9. 用测试验证是否读懂

用Mock走一遍添加、取消、确认、保存、刷新，观察哪一步才写数据库，再读对应测试：

- 条目与估算：web/tests/entries.test.ts、recognition.test.ts、FoodEditor.test.ts。
- 食品库：food-picker.test.ts、food-library.test.ts、ManualFoodSheet.test.ts。
- 事务兼容：storage.test.ts、backup-file.test.ts、wellness-storage.test.ts。
- 日期同步返回：DateField.test.ts、profile-sync.test.ts、back-navigation.test.ts。
- 实际页面：tests/e2e/mobile-editor.spec.ts、food-library.spec.ts、interaction.spec.ts。

```powershell
npm run typecheck
npm test
npm run build
node scripts/test-e2e.mjs food-library.spec.ts profile-sync.spec.ts calendar.spec.ts
```

data-testid是稳定测试入口，例如save-meal、food-picker-search、confirm-restore，避免依赖排版。模拟DOM、手机视口、原生桥模拟和APK资源检查验证不同层次；真实对焦、软键盘、系统手势与分享仍需真机。
