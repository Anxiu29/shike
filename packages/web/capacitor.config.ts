import type { CapacitorConfig } from '@capacitor/cli'

// 默认装入 APK 内置页面；只有显式选择 --preview 才使用电脑远程页面。
const preview = process.env.SHIKE_APP_PREVIEW_URL
if (preview) {
  const url = new URL(preview)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('App 测试地址必须是无凭据、无路径的 HTTP(S) 来源。')
}
const config: CapacitorConfig = {
  appId: 'cn.anxiu29.shike',
  appName: '食刻',
  // Capacitor 默认调试日志可能包含桥接参数；Key 输入与照片不得进入日志。
  loggingBehavior: 'none',
  webDir: process.env.VITE_APP_STANDALONE === 'true' ? 'dist-android' : 'dist',
  server: {
    hostname: 'localhost', androidScheme: 'https',
    ...(preview ? { url: preview, cleartext: preview.startsWith('http:') } : {}),
    errorPath: 'app-connection-error.html',
  },
  android: {
    backgroundColor: '#f5f8f0', allowMixedContent: false, webContentsDebuggingEnabled: false,
    // Android改用系统相机，不把CameraPreview/CameraX及其权限装入APK。
    includePlugins: ['@capacitor/app', '@capacitor/filesystem', '@capacitor/share'],
  },
}
export default config
