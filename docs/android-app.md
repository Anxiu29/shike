# 安卓测试 APK：构建、安装与真机检查

本轮目标是**可安装的局域网联调包**，应用名称「食刻」，包名 `cn.anxiu29.shike`，版本 `0.1.0-preview`。复用现有 Vue 页面、IndexedDB 与服务端，不重写一套业务。构建工具、APK 和调试签名都在忽略目录中，模型密钥不进入 App。

## 1. 测试包如何工作

使用 [Capacitor 8](https://capacitorjs.com/docs/android) 的开发服务器模式。APK 安装在手机上，WebView 加载电脑 `npm run dev:lan` 提供的页面，API 继续通过同源代理进入电脑后端。**电脑必须开机，手机与电脑在同一可互通 Wi-Fi，电脑能访问所选 AI 服务。** APK 并不意味着手机离开电脑后仍能联网识别。

`packages/web/capacitor.config.ts` 中只有联调时设置 `server.url` / `cleartext`。Capacitor 官方明确该配置面向开发，不能作为正式发行方案。[配置说明](https://capacitorjs.com/docs/config)

将来独立使用时，应打包本地 Web 资源、配置受保护的 HTTPS 后端并设计升级和数据迁移；仍不把模型密钥放入客户端。当前 APK 是 debug 签名测试包，不用于应用商店发布。

## 2. 本机前置条件

- Node.js 24、项目依赖 `npm install`。
- JDK 21，`JAVA_HOME` 指向该 JDK；构建流程固定已验证版本，避免更新的 JDK 与 Gradle 不兼容。
- Android SDK：`platforms;android-36`、`build-tools;36.0.0`；USB 安装还需要 `platform-tools`。`ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 指向 SDK 根目录。
- 可通过 [Android Studio / SDK Manager](https://developer.android.com/studio) 安装上述工具，并按官方要求接受相应 SDK 许可。

本工作区已将必要工具下载、按官方 SHA-256 校验，并放在 `.data-cache/android/`。构建脚本在没有显式环境变量时自动查找此缓存；全新克隆需要自行配置 SDK/JDK。Gradle Wrapper 使用官方 8.14.3 bin 分发和固定 SHA-256，首次构建需要联网下载 Gradle 与 Maven 依赖。

不会修改系统全局环境变量，Gradle 缓存、Java 用户目录和调试签名都放在项目缓存中。工作区有中文路径，因此 Gradle 显式允许非 ASCII 项目路径；当前使用 Java/Android 资源，不包含 NDK 编译。

## 3. 构建与手机安装

先保持服务运行：

```powershell
npm run dev:lan
```

在另一个终端构建：

```powershell
npm run android:apk
# 多网卡或需要明确指定地址时：
npm run android:apk -- --url http://电脑当前局域网IP:5180/
```

脚本先检查食刻 `/api/health`，再构建前端、同步 Capacitor 插件、执行 Gradle `assembleDebug` 并验证 APK 签名。输出在 `artifacts/android/shike-preview.apk`，相邻 JSON 包含测试地址、文件大小和 SHA-256。

手机系统浏览器打开终端打印的 `http://电脑IP:5180/downloads/shike-preview.apk`，下载并按系统提示安装自己构建的测试包。下载入口仅在显式局域网开发模式下提供这个固定 APK 文件，不开放任意本机路径。也可通过 USB：

```powershell
adb install -r artifacts/android/shike-preview.apk
```

USB 方式需要在手机启用开发者选项与 USB 调试，并在手机上确认这台电脑的调试授权。复用同一缓存调试签名才能覆盖安装；如果换签名，不要直接卸载，以免丢失记录，先导出备份。电脑 IP 或网络改变后，要重新构建联调包。

## 4. 数据与功能边界

- App 的 WebView 和手机浏览器、电脑浏览器各自保存 IndexedDB 数据；默认不云同步，也不自动读取已有浏览器记录。
- Android 系统自动备份关闭，明确由用户使用 JSON 导出与恢复；卸载 App 或清除 App 数据会删除本地记录。
- 网页仍使用系统拍照／选图入口。Capacitor Android 负责文件选择与相机 Intent，真实手机的相机、照片格式及返回流程需要逐项实测。
- 安卓导出备份通过 Filesystem 将 JSON 写入 App 缓存，再打开系统分享菜单，选择保存位置或分享给自己的工具；不依赖 WebView 的 blob 下载，也不申请整个手机的存储权限。缓存文件不是外部永久备份，要在系统菜单完成保存。导入仍通过系统文件选择器并预览确认后替换。
- 服务不可达时显示本地连接提示和重试按钮，不应停在白屏。局域网 HTTP 的安全随机 UUID 回退继续有效。
- 移除了“我已核对食物和重量”的强制复选框：识别后可编辑并直接点“保存记录”，保留估算、模拟来源与缺失值提示。

## 5. 真机检查清单

安装后验证启动与重试、相册选择、相机返回、图片压缩、多食物识别、逐项份量编辑和直接保存。随后关闭 App 重开，检查历史、体重、目标、备份导出与恢复；检查刘海屏、系统返回键和键盘是否遮挡保存按钮。真实 AI 仍可能限流或网络失败，要确认错误提示不会清掉草稿。

APK 构建、验签和浏览器手机视口通过，并不等于 Android 真机上的相机、分享、安装权限和 WebView 交互都已通过；未连接设备时需在收到 APK 的手机上完成上述项目。
