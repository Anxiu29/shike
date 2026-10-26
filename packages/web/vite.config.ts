import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { createReadStream, existsSync, statSync } from 'node:fs'

export default defineConfig({
  // 独立 APK 构建不能覆盖普通网页产物，否则 npm start 会误用 App 的离线配置。
  build: { outDir: process.env.VITE_APP_STANDALONE === 'true' ? 'dist-android' : 'dist' },
  plugins: [vue(), tailwindcss(), {
    name: 'shike-lan-apk-download',
    configureServer(server) {
      // 只在显式局域网联调时提供固定 APK 文件，不开放任意本机文件路径。
      if (process.env.SHIKE_DEV_LAN !== '1') return
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (!['/downloads/shike.apk', '/downloads/shike-preview.apk'].includes(pathname ?? '')) return next()
        const filename = pathname === '/downloads/shike.apk' ? 'shike.apk' : 'shike-preview.apk'
        const apk = fileURLToPath(new URL(`../../artifacts/android/${filename}`, import.meta.url))
        if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.statusCode = 405; res.end(); return }
        if (!existsSync(apk)) { res.statusCode = 404; res.end('APK not built yet'); return }
        res.setHeader('Content-Type', 'application/vnd.android.package-archive')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.setHeader('Content-Length', statSync(apk).size)
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'HEAD') { res.end(); return }
        const stream = createReadStream(apk)
        stream.on('error', () => { res.destroy() })
        res.on('close', () => stream.destroy())
        stream.pipe(res)
      })
    },
  }],
  // 前端只读取自己的环境目录，服务端密钥不会进入 Vite 的环境加载范围。
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5180,
    strictPort: true,
    // 使用系统默认浏览器；局域网模式打开同一 IP 来源，保持接口与本地记录来源一致。
    open: process.env.SHIKE_DEV_LAN === '1' ? process.env.PUBLIC_ORIGIN ?? false : 'http://127.0.0.1:5180/',
    // 局域网访问须显式运行 dev:lan；普通 dev 仍只监听本机。
    host: process.env.SHIKE_DEV_LAN === '1' ? '0.0.0.0' : '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
