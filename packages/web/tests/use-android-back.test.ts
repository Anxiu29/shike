// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useAndroidBack } from '../src/lib/use-android-back'

const bridge = vi.hoisted(() => ({ platform: 'android', addListener: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => bridge.platform, isPluginAvailable: () => true } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: bridge.addListener } }))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.resetAllMocks(); bridge.platform = 'android' })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function start(back = vi.fn().mockResolvedValue(undefined), reset = vi.fn(), failed = vi.fn()) {
  wrapper = mount(defineComponent({ setup() { useAndroidBack(back, reset, failed); return () => h('div') } }))
  return { back, reset, failed }
}

it('连接官方backButton和活动状态回调，卸载移除各自监听', async () => {
  const remove = vi.fn().mockResolvedValue(undefined)
  bridge.addListener.mockResolvedValue({ remove })
  const { back, reset } = start(); await tick()
  bridge.addListener.mock.calls.find(([event]) => event === 'backButton')![1]({ canGoBack: false })
  bridge.addListener.mock.calls.find(([event]) => event === 'appStateChange')![1]({ isActive: false })
  await tick(); expect(back).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledTimes(1)
  wrapper!.unmount(); wrapper = undefined; expect(remove).toHaveBeenCalledTimes(2)
})

it('监听安装晚于卸载时立即移除，避免残留回调', async () => {
  let ready!: (value: { remove: ReturnType<typeof vi.fn> }) => void
  const remove = vi.fn().mockResolvedValue(undefined)
  bridge.addListener.mockReturnValue(new Promise(resolve => { ready = resolve }))
  start(); wrapper!.unmount(); wrapper = undefined
  ready({ remove }); await tick(); expect(remove).toHaveBeenCalledTimes(2)
})

it('返回失败时显示错误，网页不安装Android监听', async () => {
  bridge.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) })
  const { failed } = start(vi.fn().mockRejectedValue(Error('failed'))); await tick()
  bridge.addListener.mock.calls[0]![1]({}); await tick(); expect(failed).toHaveBeenCalledTimes(1)
  wrapper!.unmount(); bridge.addListener.mockClear(); bridge.platform = 'web'; start(); expect(bridge.addListener).not.toHaveBeenCalled()
})
