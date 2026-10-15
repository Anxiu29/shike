import type { CapacitorConfig } from '@capacitor/cli'

// 当前只制作联调 APK：页面与 API 使用电脑上的同源服务，密钥永远不打包进 App。
// 正式版应使用本地 Web 资源与 HTTPS 后端，不使用 server.url 的开发模式。
const preview = process.env.SHIKE_APP_PREVIEW_URL
if (preview) {
  const url = new URL(preview)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('App 测试地址必须是无凭据、无路径的 HTTP(S) 来源。')
}
const config: CapacitorConfig = {
  appId: 'cn.anxiu29.shike',
  appName: '食刻',
  webDir: 'dist',
  server: {
    ...(preview ? { url: preview, cleartext: preview.startsWith('http:') } : {}),
    errorPath: 'app-connection-error.html',
  },
  android: { backgroundColor: '#f5f8f0', allowMixedContent: false },
}
export default config
