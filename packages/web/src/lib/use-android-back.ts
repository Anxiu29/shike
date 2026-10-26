import { onBeforeUnmount, onMounted } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * @capacitor/app 的 backButton 同时接收安卓边缘手势和三键返回；普通网页不注册。
 * 监听器安装是异步的：组件可能先卸载，因此 keep 在 disposed 后立即移除迟到的句柄。
 * 前后台切换重置首页二次返回确认；卸载时清理所有已安装监听，避免重复处理。
 * 官方接口：https://capacitorjs.com/docs/apis/app （backButton / minimizeApp）。
 */
export function useAndroidBack(back: () => Promise<void>, reset: () => void, failed: () => void) {
  let disposed = false
  const handles: PluginListenerHandle[] = []
  async function keep(pending: Promise<PluginListenerHandle>) {
    const handle = await pending
    if (disposed) await handle.remove()
    else handles.push(handle)
  }
  onMounted(() => {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('App')) return
    void keep(App.addListener('backButton', () => { void back().catch(failed) })).catch(failed)
    // 从相册、系统相机或后台回来后，首页需要重新确认，避免旧的双返回窗口生效。
    void keep(App.addListener('appStateChange', reset)).catch(failed)
  })
  onBeforeUnmount(() => {
    disposed = true
    for (const handle of handles) void handle.remove().catch(() => {})
  })
}
