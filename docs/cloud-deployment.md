# 独立手机版与阿里云 FC 部署教学

当前 0.7.0 默认停用自建云端连接，本文件保留为后续部署参考。手机自配模型和免费商品查询无需 FC。恢复旧功能需在网页构建环境显式设置 `VITE_ENABLE_SERVICE_CONNECTION=true`，默认不要设置。[当前手机使用方式](personal-models.md)

此方案为可选后端部署。安卓 0.3.0 的“手机自配 Key”模式无需 FC、OSS 或自己的域名，操作见 [手机多模型教学](personal-models.md)。

核验日期：2026-10-15。已完成独立 APK 和部署材料，**尚未创建云资源，没有可用公网地址**；部署模板完成不等于云端已经上线。

## 1. 安装独立版并迁移记录

先在旧局域网 APK 中导出 JSON 备份，保存到手机文件，再安装 `artifacts/android/shike.apk`，版本 `0.2.0-test`。不要先卸载或清数据。包名仍为 `cn.anxiu29.shike`，沿用项目缓存的调试签名；换电脑丢失签名后不能保证覆盖安装。

新版固定从 App 内置的 `https://localhost` 来源启动。旧版电脑 IP 和新版本地来源的 IndexedDB 相互隔离，记录不会自动迁移，请在新版恢复备份。安装后可断网查看、搜索食物库、手动记录饮食体重和设置目标；拍照识别需要后续连接云端。

下载 APK 的一次操作可通过局域网链接或 USB 传文件；**安装后的本地功能不依赖电脑或同一 Wi-Fi**。这是调试签名内测包，尚未做商店发行签名、公开分发或安卓真机验收。

## 2. 云端需要哪些资源

一个 FC Web 函数、一个放镜像的同地域 ACR 仓库、一个私有标准 OSS Bucket。手机通过 HTTPS 请求食刻后端，后端临时处理图片再调用百炼。饮食、体重和照片不写入云端数据库，OSS **仅保存每日限额计数**。[FC Web 函数](https://help.aliyun.com/zh/functioncompute/web-function-quick-start)

FC、OSS 请求及存储、ACR、出流量、域名、百炼分别计费、分别核对试用额度。等待 AI 的时间可能占用函数资源，费用预警也不是实时硬停机。先查看当前账户价格，不为此项目创建 GPU、NAS、NAT 网关。[FC 计费](https://help.aliyun.com/zh/functioncompute/billing-overview-of-fc) · [OSS 计费](https://help.aliyun.com/zh/oss/billing/)

## 3. 准备云端凭证与持久化限额

1. 运行 `node scripts/create-access-secrets.mjs`，生成 `.data-cache/deploy/access.env`。文件已被 Git 忽略，脚本不打印凭证、不覆盖原值。用 VS Code 查看，将访问码和签名密钥分别复制到云环境变量；只将访问码提供给内测朋友。
2. 创建与 FC 同地域的私有、标准存储 OSS Bucket。若设置过期清理，只清理 `shike-quota/`，至少保留 7 天，不能清理当天计数。
3. 替换 `deploy/fc/oss-quota-policy.example.json` 中的 Bucket 名，授权云端身份仅对该前缀执行 `oss:GetObject` 和 `oss:PutObject`。不使用主账号 AccessKey，不授予删除或全 Bucket 管理权限。
4. 服务端使用官方 `@alicloud/credentials` 凭证链。首次可在 FC 加密环境变量填写专用最小权限 RAM 用户的 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`；它们与百炼 Key 不同。也支持凭证链提供的临时凭证及 CredentialsURI；临时凭证必须有刷新机制，过期后会停止识别。[官方凭证配置](https://help.aliyun.com/zh/oss/node-js-configure-access-credentials)

## 4. 构建 Linux 容器

本工作区没有 Docker，**尚未实际验证 Linux 镜像构建**，不能用 Windows 构建通过代替。可在云端或具备 Docker 的电脑执行：

```bash
docker build --platform linux/amd64 -t shike-api:0.2.0 .
# 创建 .data-cache/deploy 后复制模板，仅在本机填真实配置。
cp deploy/fc/runtime.env.example .data-cache/deploy/runtime.env
docker run --rm --env-file .data-cache/deploy/runtime.env -p 9000:9000 shike-api:0.2.0
```

Dockerfile 使用 Node.js 24、多阶段构建和非 root 用户，只复制必要文件；`.dockerignore` 排除密钥、私人照片、APK 和缓存。sharp 在 Linux 重新安装，不能复制 Windows node_modules。

确认容器启动后，按 ACR 控制台的认证命令登录，给镜像打上你自己的私有仓库地址和固定版本标签再推送，不公开镜像，不依赖自动更新的 latest 标签。FC 的镜像拉取授权按控制台设置。

## 5. 创建 FC Web 函数

`deploy/fc/console-settings.json` 是**控制台填写清单，不是阿里云 API 请求体**。选择 Web 函数 / 自定义容器镜像，填写 ACR 镜像，端口 9000，启动命令使用镜像默认值。初始建议内存 512 MB、超时 90 秒、单实例并发度 1；CPU/内存以控制台允许组合为准。最小实例数 0，另在函数配额/伸缩处确认**最大实例数 1**，单实例并发度不等于全局实例上限。[实例伸缩](https://help.aliyun.com/zh/functioncompute/instance-scaling-restrictions-and-rules)

按 `deploy/fc/runtime.env.example` 配置：

- `APP_PUBLIC_MODE=true`、`QUOTA_STORE=oss`：缺少鉴权或 OSS 配置拒绝启动。
- `APP_ACCESS_CODE`、`APP_TOKEN_SECRET`：使用生成文件中的值，分别至少 16、32 位。签名密钥只留服务器。
- `APP_ALLOWED_ORIGINS=https://localhost`：独立安卓 App 的精确来源。网页版通过 `PUBLIC_ORIGIN=https://你的域名` 添加来源，不使用星号。Origin 只是浏览器限制，Bearer 令牌才提供鉴权。
- `OSS_QUOTA_REGION=oss-cn-beijing`、`OSS_QUOTA_BUCKET` 和上述 OSS 身份。
- 初测先 `AI_MODE=mock`，验证访问码、上传与 OSS，不消耗模型 tokens，界面保留模拟标识。再配置 `DASHSCOPE_API_KEY`、`AI_PROVIDER=qwen`、`QWEN_MODEL=qwen3.7-flash`、`AI_MODE=live`。
- 默认每日 100 次、每分钟 5 次、单并发 1。代理后的分钟限频可能合并整个入口，更保守；代码不盲信客户端代理头。每日额度由 OSS 在实例间共享。

HTTP 入口需要 GET、POST、OPTIONS，使用平台公网 HTTP 入口并保留应用层鉴权。出站应能访问百炼和 OSS。上游超时 45 秒、额度服务最多等待 8 秒、App 最多等待 70 秒，FC 留 90 秒。健康检查使用 `GET /api/health`，不消耗模型额度。

## 6. 手机连接与验收

1. HTTPS 访问 `/api/health`，应返回 `authRequired:true` 及正确模式、型号。这只证明服务启动，不证明 OSS 权限或模型可用。
2. App 设置「连接云端 AI」填写 **HTTPS 来源**，不要带 `/api` 路径、访问码、查询参数或供应商 Key。
3. 输入内测访问码并连接。`POST /api/session` 验证后返回 7 天令牌；访问码不保存，令牌仅留本机连接配置，不进入饮食备份。轮换访问码或签名密钥都会让旧令牌失效。
4. 先用 Mock 上传非隐私图，确认上传、保存及计数；切 live 做一次真实识别，核对百炼和 OSS 账单。
5. 手机改移动数据、电脑关机后重新打开验证识别；再开飞行模式验证本地记录。失败应保留草稿，不回退成假的模拟成功。
6. 默认 FC 公网域名只允许测试；长期生产使用自己的 HTTPS 域名，大陆地域按平台要求办理备案。[默认域名限制](https://help.aliyun.com/zh/functioncompute/the-default-public-network-domain-name-of-function-compute-is-not-allowed-in-the-production-environment) · [HTTPS 与域名](https://help.aliyun.com/zh/functioncompute/configure-custom-domain-names)

## 7. 日限额的代码原理

OSS 每天一个 `shike-quota/YYYY-MM-DD.count`，日期按北京时间；每个字节代表一次预留。HeadObject 获取长度，再用 AppendObject 指定当前位置追加一个字节。并发时仅一个追加成功，其余位置冲突后重新检查上限。不能用普通 JSON 读改写模拟原子计数。[官方 AppendObject 语义](https://help.aliyun.com/zh/oss/developer-reference/appendobject)

超时、校验失败等仍计次数，因为可能已经消耗模型 tokens。存储故障或等待超过 8 秒会阻止 AI，不退回内存计数。在途追加可能保守消耗一个名额，但不会继续调用模型。此限额控制食刻请求次数，不是整个百炼账号的人民币账单硬上限，其他应用用同一个 Key 也不会被它统计。
