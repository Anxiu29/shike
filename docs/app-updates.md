# 应用内更新与Gitee / GitHub双源发布

## 版本更新的完成标准

用户要求“更新一个版本”或“更新一版”时，默认包括递增版本、打包验签、发布Gitee国内源和GitHub备用源，以及匿名读取更新清单和下载校验；仅当用户明确要求“只打本地包”时才停在本地构建。不能以APK已生成或Release已创建作为完成依据。缺少登录、上传失败或更新源尚未公开时，要明确说明阻塞，不能回复“已更新完成”。验收时必须确认两端公开列表能选到同一versionCode，APK和更新JSON字节数、SHA-256一致，再告知手机检查更新。

2026-10-29：已公开发布0.11.30-test（versionCode53），包含订单识别、离线文字手动准备和照片换模型重分析。[Gitee国内发行版](https://gitee.com/anxiu29/shike/releases/tag/v0.11.30-test)与[GitHub备用发行版](https://github.com/Anxiu29/shike/releases/tag/v0.11.30-test)均可匿名读取，应用相同的列表选择与更新契约校验已确认选中53。六个附件匿名下载成功，两端APK均为55,289,014字节，SHA-256为`cc02c975400236a3b5f992ee6fcf6272e261c3c0e0766906942427c6e25694c2`，与本地包一致；沿用0.11.29签名，可覆盖安装。GitHub发布标签对应完整源码提交`c9784b9029cd1708b1cb24e4c9fa37a5ce9a39a1`，位于独立发布分支，main未改动；Gitee提供同次构建的安装包与更新文件。验证报告位于`artifacts/android/release-0.11.30-test/published-verification.json`。本次排查确认此前双源都停在0.11.20，后续本地包未上传，导致手机检查不到新版；不是清除手机缓存可以解决的问题。最终包验证见[安卓说明](android-app.md)。

0.11.15-test（versionCode 38）修复Gitee列表顺序：官方接口默认会把旧发行版放在前面，现请求显式设置`direction=desc`以读取最新10版，再按实际发布时间与ID倒序选择，避免镜像已更新却仍跳过国内新版。2026-10-26已用同仓库实际发行版核验升序/降序响应差异，并确认旧版在前时仍选中0.11.15。[Gitee国内源](https://gitee.com/anxiu29/shike/releases/tag/v0.11.15-test)及[GitHub备用源](https://github.com/Anxiu29/shike/releases/tag/v0.11.15-test)均已公开，六个附件匿名下载和哈希校验通过。GitHub大附件曾在CLI上传中停滞，最终经网页上传完成发布。旧版也可直接从Gitee覆盖安装获得修复，不要先卸载。

本版验证：476项单元/接口、20项安卓规则、最终APK内24项页面回归通过。APK 10,689,043字节，SHA-256为`5eac8cf1ec75da3299cb6f03c61ad443f39a56e52654e593f88fba9dc7fc6f5c`，签名与旧版相同。具体报告为`artifacts/android/details-model-edit-01115-verification.json`及`details-model-edit-01115-published-downloads.json`。页面测试使用模拟原生桥，尚未做真机覆盖安装。

0.11.9-test（versionCode 32）开始提供「设置 → 版本与更新」。先手动覆盖安装一次本版本，以后可在应用内查看新版本、下载并打开系统安装窗口。旧版0.11.8及之前没有这个入口，不能在不安装新版的情况下凭空获得更新功能。

## 手机使用

1. 打开设置，点击「检查更新」。0.11.13-test起优先读取公开Gitee发布；连接失败、没有发行版或没有高于本机的版本时，再查GitHub。Gitee有新版时直接使用国内源，不额外等待GitHub。不上传饮食、照片或模型Key。
2. 有新版时显示版本、大小、日期和更新说明；确认后点击「下载更新」。进度中可取消，网络错误或校验失败可重试，不能继续安装失败的文件。
3. 下载后检查SHA-256、字节数、包名、版本与当前食刻签名。版本必须递增，不能通过此入口降级；Android版本不支持时不会下载。
4. 点击「安装更新」。Android 8及以上未授权时会打开「允许来自此来源的应用」，允许后返回，再点「安装更新」。最终安装由系统确认；页面显示「已打开系统安装界面」不表示已经安装成功。
5. 覆盖安装保留同一应用的数据与模型配置。不要先卸载、清数据或更换签名；仍可从设置主动导出记录备份。系统安装、厂商权限页面和真实更新后数据保留需要手机验收。

默认国内源为`https://gitee.com/anxiu29/shike`，GitHub备用源为`Anxiu29/shike`。可在「更新仓库与说明」分别填`用户名/仓库名`或对应平台HTTPS仓库地址，保存后再检查；Gitee留空可停用。旧版默认GitHub偏好自动补上官方Gitee；旧版自定义GitHub仓库不会擅自搭配官方镜像。仓库配置不进入饮食备份。

设置页显示实际选用来源。Gitee提供当前版本时仍检查GitHub，避免镜像滞后漏掉新版；备用源无法访问会明确提示未完成检查。损坏的更新JSON、跨仓库/跨版本链接会停止检查，不用备用源掩盖错误。安卓Gitee下载连接失败时可查询GitHub备用包，仅在versionCode、versionName、大小和SHA-256都一致时切换；下载中断、大小/哈希/签名失败不会静默换包。

旧版APK仍使用原GitHub更新源，先通过GitHub更新或手动覆盖安装0.11.13-test及以后版本，才能获得Gitee优先功能。

2026-10-24已发布[v0.11.13-test Gitee测试版](https://gitee.com/anxiu29/shike/releases/tag/v0.11.13-test)及[GitHub备用测试版](https://github.com/Anxiu29/shike/releases/tag/v0.11.13-test)。两端三个附件均匿名下载200，APK为10,685,695字节，SHA-256均为`9f04d153cfb8c79decba80a23cad825be958d4acf7e910a512b6aeb2b6470f26`，与本地构建一致。Gitee列表及固定JSON经实际后端代理读取成功；本机3001/5180接口均返回公开版本。验证报告见`artifacts/android/gitee-01113-verification.json`和`gitee-01113-published-downloads.json`。471项单元/接口测试、19项原生规则测试、15项网页及15项实际APK页面场景通过；页面测试使用模拟原生桥，未完成Android真机安装验收。

2026-10-24通过GitHub CLI核对，确认`Anxiu29/shike`为公开仓库。用户确认公开发布后，已上线[v0.11.9-test测试发行版](https://github.com/Anxiu29/shike/releases/tag/v0.11.9-test)，APK、更新JSON与校验文件均经匿名下载核验，线上APK哈希与本地一致。此前连接器返回404不能据此认定仓库未公开。本网络的匿名API请求也曾触发403，响应显示剩余配额为0；应用对此提示访问受限，不会当成「已经是最新版」。后续也可改用独立公开发布仓库。

## 准备和发布新版

1. 编辑根目录`config/app-release.json`，递增`versionCode`，填写`versionName`及`notes`。Android、网页版本显示和发布文件共用这份版本来源。
2. 执行`npm run android:apk`。独立APK验签成功后自动生成下列文件，位于`artifacts/android/`：
   - `shike.apk`：完整独立安装包。
   - `shike-update.json`：更新契约，包括版本、最低Android API、字节数、SHA-256和更新说明。
   - `shike.apk.sha256`：人工核对用的校验文件。
   同时保留带版本名称的APK、元数据和更新文件副本。已有同版本的APK内容不同时构建会报错，需递增版本，避免替换已经分发的版本。
3. 打开用于更新的公开Gitee仓库，进入发行版→创建发行版，填写Tag（例如`v0.11.13-test`）、标题和说明，测试版勾选「这是一个预览版本」。GitHub备用仓库也建立同版本Release。
4. 在附件处上传**同次构建**的`shike.apk`和`shike-update.json`，可附`shike.apk.sha256`。附件名称必须保持上述固定名称；Tag和标题可以自定，不通过Tag文本比较版本。
5. 两个平台上传同一次构建的三个文件，确认哈希相同后发布。只保存为Draft不会被应用发现。当前测试版通道也读取已公开的Pre-release；每个平台列表取最近10条，选择第一条同时含两个必需附件的发行版。Gitee附件不要填写GitHub外链，否则不构成国内源。
6. 用不登录的浏览器确认两个平台APK与JSON均可下载，再从手机点「检查更新」。后续APK必须沿用已安装版本的签名，否则应用会拒绝安装。

构建命令只准备本地文件，不创建仓库、修改仓库可见性或上传Release。发布步骤参考[Gitee官方发行版教程](https://help.gitee.com/repository/release/create)和[GitHub官方网页教程](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。按Gitee当前文档，普通项目单附件上限100MB、附件总量1GB，应按需清理旧安装包；食刻当前APK约11MB。匿名读取与草稿规则见[GitHub Releases API](https://docs.github.com/en/rest/releases/releases#list-releases)。

## 实现与边界

- `packages/shared/src/app-updates.ts`定义仓库、附件路径与更新JSON契约；不允许向契约注入任意APK地址。
- 安卓`AppUpdaterPlugin.java`从对应平台API获得同一发行版的两个固定附件。Gitee仅允许`gitee.com`、`foruda.gitee.com`的HTTPS跳转；GitHub仅允许其原有固定下载主机，不允许跨平台任意跳转。不读取模型Key。下载有超时、体积限制、取消与临时文件清理。
- Gitee公开接口没有返回附件size，按更新JSON和实际下载流核对大小；不能照搬GitHub的published_at/size字段。两个平台都验证仓库、标签与固定文件名。Gitee资源损坏会停止检查。
- 网页通过自己的`/api/app-updates/gitee`接口读取公开列表/固定更新JSON，解决Gitee跨域限制。接口只接受仓库与可选标签，校验HTTPS下载域名、重定向次数、响应大小并限制请求频率/并发，不代理APK、任意URL或私有凭据。安卓使用原生网络，不依赖本地网页后端。
- 安卓`UpdatePolicy.java`检查文件大小、哈希、相同包名、递增版本、最低系统与当前签名；安装前再次检查。更新APK放在应用私有缓存，通过独立FileProvider只临时授权更新文件。
- 只新增`REQUEST_INSTALL_PACKAGES`权限供用户主动更新，未增加广泛存储权限。Android 8及以上按[系统安装来源授权](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())处理。
- 检查不自动下载，下载不自动安装。取消或失败不写饮食数据库，不改现有模型配置。安装状态不伪装成已完成。
- 网页版可查看发布说明并打开APK下载链接，网页本身由部署者更新；保持同一网页来源才能继续访问原来的本地记录。
- 浏览器模拟桥和原生规则测试不等于手机完成了真实安装，公开仓库上线后仍需用同签名递增版本在真机验收。

## 0.11.13检查不到新版的处理

Gitee公开列表默认按旧版在前返回，0.11.13把首项当成最新版。0.11.15起请求明确指定direction=desc，并独立排序；测试/预览标记不会被过滤。旧客户端无法通过新包修改自身的已安装逻辑，需要先从公开Gitee发行版下载一次同签名新版覆盖安装，保留原有数据，勿先卸载。

2026-10-26实际匿名GitHub请求返回403、X-RateLimit-Remaining=0，响应为API rate limit exceeded；同机已登录gh调用仍成功。这是公开接口额度耗尽的证据，不是凭据失效。App检查公开更新不保存或使用GitHub Token；不要把个人Token填入模型Key或更新仓库。0.11.18起明确提示公开接口额度耗尽，备用源检查失败且Gitee没有更高版本时显示“部分更新源检查未完成”，不宣称已确认最新，并提供Gitee发行版直达链接。仍需真机验证不同网络下的安装流程。
