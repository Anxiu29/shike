import { beforeEach, expect, it, vi } from 'vitest'
const { capture, native, available } = vi.hoisted(() => ({ capture: vi.fn(), native: vi.fn(() => true), available: vi.fn(() => true) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native, getPlatform: () => 'android', isPluginAvailable: available }, registerPlugin: (name: string) => name === 'SystemPhoto' ? { capture } : {} }))
import { systemPhotoAvailable, takeSystemPhoto } from '../src/lib/system-photo'
beforeEach(() => { vi.clearAllMocks(); native.mockReturnValue(true); available.mockReturnValue(true) })
it('系统相机取消不产生文件，照片通过JPEG边界后才交给调用方', async () => {
  capture.mockResolvedValueOnce({ cancelled: true })
  expect(await takeSystemPhoto()).toBeNull()
  capture.mockResolvedValueOnce({ cancelled: false, jpegBase64: '/9j/2Q==' })
  expect(await takeSystemPhoto()).toMatchObject({ type: 'image/jpeg', size: 4 })
})
it('桥接结果缺失或非JPEG时拒绝，网页不调用原生拍照', async () => {
  for (const result of [{}, { cancelled: false }, { cancelled: false, jpegBase64: btoa('invalid') }]) {
    capture.mockResolvedValueOnce(result); await expect(takeSystemPhoto()).rejects.toThrow()
  }
  native.mockReturnValue(false); expect(systemPhotoAvailable()).toBe(false)
  capture.mockClear(); await expect(takeSystemPhoto()).rejects.toThrow('新版安卓'); expect(capture).not.toHaveBeenCalled()
})
