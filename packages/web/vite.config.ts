import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { createReadStream, existsSync, statSync } from 'node:fs'

export default defineConfig({
  plugins: [vue(), tailwindcss(), {
    name: 'shike-lan-apk-download',
    configureServer(server) {
      // 只在显式局域网联调时提供固定 APK 文件，不开放任意本机文件路径。
      if (process.env.SHIKE_DEV_LAN !== '1') return
      const apk = fileURLToPath(new URL('../../artifacts/android/shike-preview.apk', import.meta.url))
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/downloads/shike-preview.apk') return next()
        if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.statusCode = 405; res.end(); return }
        if (!existsSync(apk)) { res.statusCode = 404; res.end('APK not built yet'); return }
        res.setHeader('Content-Type', 'application/vnd.android.package-archive')
        res.setHeader('Content-Disposition', 'attachment; filename="shike-preview.apk"')
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
    // 局域网访问须显式运行 dev:lan；普通 dev 仍只监听本机。
    host: process.env.SHIKE_DEV_LAN === '1' ? '0.0.0.0' : '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
