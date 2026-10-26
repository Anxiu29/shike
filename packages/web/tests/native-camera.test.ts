import { describe, expect, it, vi } from 'vitest'
import type { CameraDevice, CameraPreviewPlugin } from '@capgo/camera-preview'
import { jpegFile, NativeCameraSession, preferredRearCamera } from '../src/lib/native-camera'

const area = { x: 0, y: 80, width: 390, height: 500 }
const devices = [
  { deviceId: 'front', position: 'front', isLogical: false, minZoom: 1, maxZoom: 4, lenses: [] },
  { deviceId: 'ultra', position: 'rear', isLogical: false, minZoom: .5, maxZoom: .5, lenses: [{ deviceType: 'ultraWide' }] },
  { deviceId: 'main', position: 'rear', isLogical: true, minZoom: .5, maxZoom: 20, lenses: [{ deviceType: 'wideAngle' }] },
] as CameraDevice[]
const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9))
function mockBridge() {
  return { requestPermissions: vi.fn().mockResolvedValue({ camera: 'granted' }), getAvailableDevices: vi.fn().mockResolvedValue({ devices }),
    start: vi.fn().mockResolvedValue(area), stop: vi.fn().mockResolvedValue(undefined), getDeviceId: vi.fn().mockResolvedValue({ deviceId: 'main' }),
    getZoom: vi.fn().mockResolvedValue({ current: 1 }), capture: vi.fn().mockResolvedValue({ value: jpeg }), setFocus: vi.fn().mockResolvedValue(undefined),
    getSupportedFlashModes: vi.fn().mockResolvedValue({ result: ['off', 'torch'] }), setFlashMode: vi.fn().mockResolvedValue(undefined), setPreviewSize: vi.fn().mockResolvedValue(area),
  }
}
describe('安卓原生静态相机会话', () => {
  it('优先逻辑后摄，原生拍照无录音、定位、相册或磁盘保存选项', async () => {
    expect(preferredRearCamera(devices)?.deviceId).toBe('main')
    const bridge = mockBridge(), session = new NativeCameraSession(bridge as unknown as CameraPreviewPlugin)
    const info = await session.start(area)
    expect(info.deviceId).toBe('main'); expect(bridge.start).toHaveBeenCalledWith(expect.objectContaining({ ...area, deviceId: 'main', toBack: true, aspectMode: 'cover', includeSafeAreaInsets: false, disableAudio: true, storeToFile: false, enableVideoMode: false, enablePhysicalDeviceSelection: false, captureResolution: { width: 3264, height: 2448 } }))
    const file = await session.capture(); expect(file.type).toBe('image/jpeg'); expect(file.size).toBe(4)
    expect(bridge.capture).toHaveBeenCalledWith(expect.objectContaining({ saveToGallery: false, withExifLocation: false, embedLocation: false }))
    await session.focus(.2, .7); expect(bridge.setFocus).toHaveBeenCalledWith({ x: .2, y: .7 })
    await session.stop(); expect(await session.focus(.5, .5)).toBe(false); expect(bridge.stop).toHaveBeenCalledTimes(1)
  })
  it('等待权限期间关闭，随后授权也不再打开摄像头', async () => {
    const bridge = mockBridge(); let grant!: (value: { camera: string }) => void
    bridge.requestPermissions.mockImplementation(() => new Promise(resolve => { grant = resolve }))
    const session = new NativeCameraSession(bridge as unknown as CameraPreviewPlugin), opening = session.start(area)
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(grant).toBeTypeOf('function')); const closing = session.stop(); grant({ camera: 'granted' })
    await rejected; await closing; expect(bridge.start).not.toHaveBeenCalled()
  })
  it('原生start已经执行时关闭，排队释放，失败启动也清理原生视图', async () => {
    const bridge = mockBridge(); let finish!: (value: unknown) => void
    bridge.start.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const session = new NativeCameraSession(bridge as unknown as CameraPreviewPlugin), opening = session.start(area)
    await vi.waitFor(() => expect(bridge.start).toHaveBeenCalled()); const closing = session.stop()
    expect(bridge.stop).not.toHaveBeenCalled(); finish(area); await opening; await closing; expect(bridge.stop).toHaveBeenCalledTimes(1)
    bridge.start.mockRejectedValueOnce(new Error('native camera failed'))
    await expect(session.start(area)).rejects.toThrow('failed'); expect(bridge.stop).toHaveBeenCalledTimes(2)
  })
  it('拒绝权限或非JPEG响应，不伪造相片和成功状态', async () => {
    const bridge = mockBridge(); bridge.requestPermissions.mockResolvedValueOnce({ camera: 'denied' })
    await expect(new NativeCameraSession(bridge as unknown as CameraPreviewPlugin).start(area)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(bridge.start).not.toHaveBeenCalled(); expect(() => jpegFile('')).toThrow(); expect(() => jpegFile(btoa('invalid'))).toThrow('JPEG')
  })
  it('快速关闭重开时，新组件等待旧组件真正释放同一个原生插件', async () => {
    const oldBridge = mockBridge(), nextBridge = mockBridge()
    const old = new NativeCameraSession(oldBridge as unknown as CameraPreviewPlugin), next = new NativeCameraSession(nextBridge as unknown as CameraPreviewPlugin)
    await old.start(area); let release!: () => void
    oldBridge.stop.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const closing = old.stop(), opening = next.start(area)
    await vi.waitFor(() => expect(oldBridge.stop).toHaveBeenCalled())
    expect(nextBridge.requestPermissions).not.toHaveBeenCalled(); release(); await closing; await opening
    expect(nextBridge.start).toHaveBeenCalledTimes(1); await next.stop()
  })
})
