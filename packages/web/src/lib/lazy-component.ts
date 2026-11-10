import { defineAsyncComponent, type AsyncComponentLoader, type Component } from 'vue'
import AsyncPanelError from '../components/AsyncPanelError.vue'

/** 分包下载失败时显示可恢复的提示，不让切页后只留下空白。 */
export function lazyComponent<T extends Component>(loader: AsyncComponentLoader<T>): T {
  return defineAsyncComponent({ loader, errorComponent: AsyncPanelError, timeout: 20000 })
}
