import type { Page } from '@playwright/test'

/** 走 Capacitor 的正式原生事件入口，不在产品中暴露测试按钮或调用返回函数。 */
export async function mockAndroidBack(page: Page) {
  await page.addInitScript(() => {
    const state = window as any
    const listeners = new Map<string, { event: string; callback: (data: unknown) => void }>()
    let sequence = 0
    state.__appCalls = []
    state.__appEmit = (event: string, data = {}) => { for (const listener of listeners.values()) if (listener.event === event) listener.callback(data) }
    state.androidBridge = {}
    state.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, ...['removeListener', 'minimizeApp', 'exitApp'].map(name => ({ name, rtype: 'promise' }))] },
        { name: 'PersonalVision', methods: [{ name: 'getState', rtype: 'promise' }] },
      ],
      nativeCallback: (_plugin: string, method: string, input: any, callback: (data: unknown) => void) => {
        if (method !== 'addListener') throw Error('Unexpected native callback')
        const id = String(++sequence); listeners.set(id, { event: input.eventName, callback }); return id
      },
      nativePromise: async (plugin: string, method: string, input: any) => {
        if (plugin === 'PersonalVision' && method === 'getState') return { profiles: [], activeId: null }
        state.__appCalls.push(method)
        if (method === 'removeListener') listeners.delete(input.callbackId)
        return {}
      },
    }
  })
}
export async function androidBack(page: Page) { await page.evaluate(() => (window as any).__appEmit('backButton', { canGoBack: false })) }
export async function androidTab(page: Page, name: 'diary' | 'weight' | 'goals' | 'settings') {
  const mobile = page.getByTestId(`tab-${name}`)
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click()
}
