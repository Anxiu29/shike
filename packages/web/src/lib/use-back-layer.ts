import { nextTick, onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue'
import { BackLayers } from './back-navigation'

export const backLayers = new BackLayers(nextTick)

/** 在 setup 时登记父层，之后创建的子弹窗自然位于栈顶；关闭后移除。 */
export function useBackLayer(enabled: () => boolean, close: () => void | Promise<void>) {
  let layer: ReturnType<BackLayers['add']> | undefined
  let active = true
  const stop = watch(enabled, open => {
    if (open && !layer) { layer = backLayers.add(close); layer.setActive(active) }
    else if (!open) { layer?.remove(); layer = undefined }
  }, { immediate: true, flush: 'sync' })
  // KeepAlive 的目标表单离开页面后不得继续拦截返回；激活也不改变父子顺序。
  onDeactivated(() => { active = false; layer?.setActive(false) })
  onActivated(() => { active = true; layer?.setActive(true) })
  onBeforeUnmount(() => { stop(); layer?.remove() })
}
