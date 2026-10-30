# Android 原生代码学习路线

食刻的页面运行在 Capacitor WebView 中，Java 插件负责网页无法直接完成的系统操作。先把“命令被接受”“任务完成”“内容可信”区分开，后面的状态机就容易理解了。本文说明当前源码的行为，不代表已经在所有 Android 手机上验证。

## 从哪里开始读

1. [MainActivity.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/MainActivity.java)：在建立桥接前注册插件。
2. [SystemPhotoPlugin.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/SystemPhotoPlugin.java)：最短的完整系统调用链，包含外部 Activity、文件授权、结果回调与清理。
3. [OfflineModelPolicy.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/OfflineModelPolicy.java) 与对应测试：先理解纯 Java 的长度限制、续传、哈希和取消，再读大型插件。
4. [OfflineAiPlugin.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/OfflineAiPlugin.java)：下载/导入、引擎生命周期与异步推理。
5. [OfflineVisionPlugin.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/OfflineVisionPlugin.java)、[OfflineVisionTasks.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/OfflineVisionTasks.java)：继承通用状态机，增加图片边界和固定任务。
6. [AppUpdaterPlugin.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/AppUpdaterPlugin.java) 与 [UpdatePolicy.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/UpdatePolicy.java)：理解分层信任与临时文件提交。
7. [PersonalVisionPlugin.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/PersonalVisionPlugin.java)、[VisionPolicy.java](../packages/web/android/app/src/main/java/cn/anxiu29/shike/VisionPolicy.java)：理解配置投影、加密存储、请求快照和网络资源释放。

`*Plugin` 处理 Android/Capacitor 交互，`*Policy` 处理可独立验证的规则；`OfflineModelSpec` 保存固定权重身份，`OfflineVisionTasks` 保存任务约束。修改时优先找到负责该规则的层，避免把页面校验当成原生校验的替代品。

## 桥接方法如何返回

`PluginCall.resolve()` 结束一次 JavaScript 调用，但不同接口的契约不同：

- `downloadModel`、`loadModel`、`generate`、`generateImage` 先确认任务已接受。页面随后轮询 `getState`，读取 `stage`、`busy`、`error`、`text` 等状态。
- `prepareAssistant`、`describeMeal` 在模型任务完成后返回，页面可直接等待准备结果或文本结果。
- 更新的 `check`、`download` 返回任务结果；`install` 返回 `permission_required` 或 `installer_opened`。打开安装器不能证明用户已经完成安装。
- 系统拍照等待外部 Activity 返回，成功返回 JPEG 的 base64，取消返回 `cancelled: true`。

阅读页面调用时，要先查清方法属于哪种契约。误把“任务已接受”当成“任务完成”，会让界面提前显示成功。

## 线程与锁分别负责什么

主线程只负责必须与 Android UI 交互的操作，例如打开系统相机、设置和安装器。文件扫描、网络、SHA-256 和模型初始化放到单线程 `worker`，防止阻塞页面，也让同一个插件内的状态变更有确定顺序。

单线程执行器仍不意味着完全没有并发：桥接入口、生命周期回调、定时器和 LiteRT-LM 回调可能来自其他线程。因此 `OfflineAiPlugin` 使用几种不同的同步工具：

- `busy.compareAndSet(false, true)` 抢占任务槽，拒绝重入；它不是进度状态。
- `cancelled` 跨线程发出停止意图；耗时循环要主动检查，网络连接还需要断开。
- `volatile` 发布单个字段的新值；多字段相关快照不能仅依靠它保证整体一致。
- `lock` 保护输出文字与相关指标的组合读写。
- `conversationLock` 保护取消/关闭原生会话，避免 JNI 等待回调时持有回调也要获取的输出锁。
- 静态 `RUNTIME_LOCK` 管理文字/视觉两个插件之间的引擎所有权。两个插件有各自的 worker，仍不能同时抢占同一份运行时资源。

`CountDownLatch` 把 LiteRT-LM 异步回调转换成 worker 等待：`onDone`/`onError` 唤醒等待任务。这不阻塞 UI 线程，但原生取消是否及时唤醒、加载是否可中断，仍取决于引擎和设备，需要真机验证。

## 模型文件如何从“不可信”变成“可加载”

下载写入 `model.part`，导入写入 `model.import`。前者失败后保留便于续传，后者在导入任务结束时清理。二者都不能直接当成正式权重加载。

续传必须满足两个条件：本地已有字节数有效；远端返回精确匹配的 `206 Content-Range`。若服务器忽略 Range 返回完整文件，直接追加会把文件破坏，所以应拒绝此次续传。

文件完整接收后，顺序扫描计算 SHA-256，再与固定规格核对。此时只保留固定大小缓冲区，不把 GB 级模型整体读入 Java 堆。哈希通过且未取消后才移动到正式文件名。`ready()` 只执行存在和长度检查，以免每次页面轮询都重新扫描整个模型；它本身不是新的哈希认证。

模型放在 `noBackupFilesDir`，不随记录备份转移。文字和视觉模型使用不同目录，正式文件、片段和运行缓存互不覆盖。

本轮补充的两个回归展示了取消检查的位置为什么重要：

- 模型流在 `read()` 等待期间收到停止，返回的这一块不得再写入续传文件；原实现会多写本块。
- 更新流已经收到停止，就不应开始下一次可能阻塞的 `read()`；原实现先读取才检查。

现在读取前和读取后都有相应取消检查。检查不是原子事务：若取消恰好发生在检查与写入之间，仍可能有已开始的写入；插件还有最终取消检查阻止把取消任务提交为正式文件。不能据此承诺按下停止后零毫秒返回。

## 引擎为什么需要生命周期管理

下载、导入和删除前关闭旧引擎，避免加载中的原生文件与文件替换并存。初始化新的引擎时，先用局部变量持有，成功且未取消后才赋给共享 `engine`。初始化完成时若已退后台，也要关闭刚创建的资源。

文字记餐要求用户手动准备模型，发送时复用同后端的已准备引擎；模型已释放时不暗中重新加载。任务结束后，后台释放，前台空闲五分钟后释放。视觉任务每轮重新建立并关闭引擎，避免独立照片之间继承运行状态。

文件选择器同样会使 Activity 停止，因此 `handleOnStop` 不无条件取消导入；生成/加载则发停止意图，并在串行队列中安排引擎清理。销毁时先取消和断连接，再排队释放引擎，最后关闭执行器。阅读这段代码时应沿正常、异常、取消、退后台、销毁五条路径核对资源归属。

## 系统相机的临时文件由谁清理

应用创建缓存文件，通过 FileProvider URI 将本次文件交给系统相机。`EXTRA_OUTPUT` 指定输出位置；应用不接受页面给出的文件路径，也不依赖相机返回任意 URI。临时 URI 的授权在清理时撤销。

相机回调读取待处理调用中的文件名，先检查命名格式，再比较规范化父目录，随后执行有界读取。JPEG 起始标记只是一项早期过滤，不能证明整个图片都能解码；图片后续仍经过页面解码与压缩流程。

正常成功、取消和读取失败都通过 `finally` 清理本次文件并释放 `busy`。如果进程死亡导致调用无法恢复，缺少可信文件名时不会猜测删除；下次插件加载会清理目录内超过一天、符合本插件命名规则的文件。这是延迟回收，不能保证进程死亡时即时删除。

## 更新为什么检查多次

更新分为不同证据层级：

1. 仓库和附件路径检查，限制发行来源及固定文件名。
2. 每一跳重新检查 HTTPS 和支持的主机，防止自动重定向绕过初始检查。
3. 清单字段、长度、整数、版本和说明的有界校验。
4. 下载长度与 SHA-256 校验，写入 `pending.apk`。
5. PackageManager 读取真实 APK，核对包名、版本、最低系统及当前安装签名集合。
6. 全部通过后改名并标记 `ready`；真正安装前再次读取并校验文件。

清单本身不能代替真实 APK 校验。Gitee 连接失败时可以改用 GitHub，但备用候选必须与已检查候选的版本号、版本名、长度和哈希完全一致。备用源未检查完成时使用 `partial`，避免把网络故障说成“已经确认没有新版”。

签名集合比较要求与当前安装应用匹配；本轮未改动签名接受规则、源白名单或网络目标。下载进度达到 99% 也不代表已经可安装，后面还有 APK 校验。

## 个人模型配置和响应的边界

配置在 worker 上串行读写，使用 Keystore 中的 AES 密钥加密。`publicState` 只投影可公开的配置元数据，不能把内部包含 Key 的 JSONObject 直接返回页面。请求开始时复制所选配置，避免把页面后续切换默认模型的动作套到已经开始的请求上。

网络地址由 `VisionPolicy` 的提供商/型号白名单计算；不跟随带 Key 请求的重定向。连接、读取和总时限分别限制不同阶段，正文也有体积上限。错误提示不能原样回显提供商响应。`finally` 负责取消定时任务、断开连接，并清除桥接输入中的 Key 字段。

图片先验证体积和尺寸，再解码重压缩，Bitmap 在 `finally` 释放。请求计数是本机保护机制，失败请求也会消耗次数，不能把它当成提供商账单或跨设备额度。

## 本轮检查与验证限制

本轮审查覆盖模型下载/续传/导入/加载/推理/取消/卸载/后台释放、相机临时文件恢复与清理、更新选源/下载/校验/安装，以及个人模型请求与加密配置的线程边界。只修改了两处经回归复现的取消行为，其余改动为学习注释。

新增回归先在原实现上观察到两个预期失败，再执行最小修复。使用工作区缓存的 JDK 21、JUnit 4.13.2、Hamcrest，直接编译七个纯 Java 策略类及其测试，完整策略套件为 40 项，通过。编译另报告四处既有 `URL(String)` 弃用警告；未为消除 JDK 警告改动 Android API 兼容路径。

本轮未运行 Gradle/完整 Android 插件编译，未生成 APK，未安装到手机，也未调用真实模型。纯 JVM 测试无法证明 Capacitor 恢复调用、FileProvider 授权、系统相机兼容性、Keystore、安装授权或 JNI 引擎行为。后续真机应关注：加载/生成期间快速停止和退后台；文件选择器往返；相机取消/旋转/进程恢复；安装来源授权后继续；长期空闲释放与同图重复推理。
