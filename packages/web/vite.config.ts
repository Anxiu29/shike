import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
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
