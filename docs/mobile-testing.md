# 手机查看与本地联调

## 同一 Wi-Fi 下查看

1. 电脑和手机连接同一 Wi-Fi；电脑保持开机，项目服务保持运行。
2. 在项目终端用 `Ctrl+C` 停止原来的 `npm run dev`，再执行：

   ```powershell
   npm run dev:lan
   ```

3. 等待前后端启动，手机在系统浏览器打开终端打印的地址，例如 `http://192.168.1.10:5180/`。手机里的 `localhost` / `127.0.0.1` 指向手机自身，不能访问电脑。

Windows 如果弹出 Node.js 防火墙提示，只在可信的专用网络允许访问。无需开放路由器端口，也不需要将后端 3001 端口暴露到局域网。

如果电脑有多个有效网卡，终端会列出候选。也可明确指定本机当前地址：

```powershell
npm run dev:lan -- 192.168.1.10
```

地址随 Wi-Fi 或 DHCP 分配可能变化，重新启动命令会重新检测。指定非本机局域网地址会被拒绝。

## 命令做了什么

`scripts/dev-lan.mjs` 读取本机网卡，优先选择 Wi-Fi，把 `SHIKE_DEV_LAN=1` 和精确的 `PUBLIC_ORIGIN=http://所选地址:5180` 传给本次开发进程。Vite 显式监听 `0.0.0.0:5180`，后端仍监听电脑的 `127.0.0.1:3001`，前端通过同源 `/api` 代理调用它；后端只额外接受这个精确的手机页面来源，不把来源检查改成通配。

此命令不修改 `.env`，密钥不会进入前端。普通 `npm run dev` 保持仅本机访问。局域网预览没有登录保护，只用于可信局域网测试；公网分享请采用 README 的 HTTPS 与访问保护部署方案。

## 拍照、数据与排错

- “拍照”和“选照片”通过系统文件选择器工作，能否直接进入相机取决于手机和浏览器；也可以先用相机拍照，再选照片上传。电脑仍负责调用 AI，手机无需填写密钥。
- 手机、电脑、不同浏览器以及不同 IP 地址属于不同本地存储环境，不会自动同步饮食与体重。迁移时先在原浏览器导出 JSON，再在新浏览器预览并确认恢复；恢复会替换新浏览器已有记录。
- 无法打开页面时，先在电脑浏览器打开同一个局域网 URL。电脑能打开而手机不行，检查手机是否在相同网络、是否使用访客 Wi-Fi、路由器是否启用设备隔离，以及防火墙的专用网络规则。
- 如果提示端口被占用，先停止旧的本项目开发进程；不要同时运行普通模式与局域网模式。后端来源校验失败时，确认手机使用终端打印的那个 IP 和 5180 端口，换网后重新运行命令。
- 本地 HTTP 预览适合联调；正式对外使用需要 HTTPS。手机真机的相机入口仍需要在相应设备上实际验证。

## HTTP 能连接但页面空白，怎么排查

HTTP 200 只说明 HTML 可访问，不能说明 Vue 初始化成功。一次实际问题是：食物列表初始化会创建配方快照，直接调用 `crypto.randomUUID()`；它在 localhost 可以使用，在局域网 HTTP 页面却不存在，导致整个页面白屏。电脑打开同一个 IP 地址也会遇到，不能仅凭“电脑可以访问 localhost”排除问题。

现在所有食物、餐食及个人估算 ID 都通过 `packages/shared/src/id.ts` 的 `createId()` 创建。优先使用原生 `randomUUID()`；不可用时读取 `getRandomValues()` 的 16 个安全随机字节，按 UUID v4 规则设置版本位及变体位。原有 ID 和历史数据不改变，不用 `Math.random()` 凑标识。[W3C Crypto 接口及 UUID 规则](https://w3c.github.io/webcrypto/#crypto-interface) · [浏览器 getRandomValues 说明](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)

构建后的静态服务还有一个独立限制：Helmet 默认的 CSP `upgrade-insecure-requests` 会把 HTTP 页面里的脚本与样式请求升级为 HTTPS，而本地测试端口没有 TLS。现在 HTTP 运行时不启用这个升级指令；明确配置 HTTPS `PUBLIC_ORIGIN` 的正式部署仍启用它，其他同源脚本、图片与来源限制保持有效。不要为了预览而关闭整个 CSP 或禁用浏览器安全检查。

除单元测试外，还应构建后执行真正的局域网 HTTP 浏览器回归：

```powershell
npm run build
npm run test:e2e:lan
```

该命令自动读取本机局域网 IPv4，在临时 3101 端口启动独立 Mock 服务，用 Chrome 手机视口、Chrome 桌面和 Edge 跑相同的功能场景。每个场景先断言 `isSecureContext === false` 且 `crypto.randomUUID` 不存在，再检查页面渲染和交互；运行结束自动退出测试服务，不改动 5180 上的开发服务，不消耗真实 AI 额度。没有局域网地址时会明确报错；普通 `npm run test:e2e` 继续覆盖 localhost 模式。
