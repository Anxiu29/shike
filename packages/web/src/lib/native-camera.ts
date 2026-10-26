/**
 * 安卓通过camera-preview的CameraX预览/静态拍摄；网页另走camera.ts浏览器相机。
 * nativeWork跨组件串行：快速关开也先释放旧会话；generation使迟到权限/结果失效。
 * 优先标准逻辑后摄，保留系统相机后备入口；不录音、不自动存相册。
 * 预览清晰度与最终静态照片是不同问题，不能用浏览器桥模拟宣称已改善特定手机对焦。
 * 设备差异、点击对焦与真机复测保留在docs/native-camera.md及camera-guide.md。
 */
import { Capacitor } from '@capacitor/core'
import { CameraPreview, type CameraDevice, type CameraPreviewPlugin } from '@capgo/camera-preview'

// 原生插件是进程内单例：快速关闭再打开会创建新组件，队列必须跨组件共享。
let nativeWork: Promise<unknown> = Promise.resolve()

export interface PreviewBounds { x: number; y: number; width: number; height: number }
export function nativeCameraAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('CameraPreview')
}
/** 优先系统逻辑后摄的标准视角，避免直接绑定厂商支持不一的物理微距／长焦镜头。 */
export function preferredRearCamera(devices: CameraDevice[]): CameraDevice | undefined {
  const rear = devices.filter(device => device.position === 'rear')
  return rear.find(device => device.isLogical && device.minZoom <= 1 && device.maxZoom >= 1)
    ?? rear.find(device => device.lenses.some(lens => lens.deviceType === 'wideAngle')) ?? rear[0]
}
export function jpegFile(base64: string): File {
  if (!base64 || base64.length > 32 * 1024 * 1024) throw new Error('相机返回的照片为空或过大，请重新拍摄。')
  const raw = atob(base64), data = Uint8Array.from(raw, value => value.charCodeAt(0))
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('相机未返回有效的JPEG照片，请重新拍摄。')
  return new File([data], 'shike-native-capture.jpg', { type: 'image/jpeg' })
}

/** 原生会话串行执行：权限尚未返回就退出时，stop仍排在start之后，避免后台遗留摄像头。 */
export class NativeCameraSession {
  private active = false
  private generation = 0
  constructor(private bridge: CameraPreviewPlugin = CameraPreview) {}
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = nativeWork.then(work); nativeWork = result.catch(() => {}); return result
  }
  start(bounds: PreviewBounds, requestedDevice?: string) {
    const current = ++this.generation
    return this.enqueue(async () => {
      const permission = await this.bridge.requestPermissions({ disableAudio: true, showSettingsAlert: false })
      if (current !== this.generation) throw new DOMException('相机请求已取消。', 'AbortError')
      if (permission.camera !== 'granted') throw new DOMException('请允许食刻使用相机。', 'NotAllowedError')
      const devices = await this.bridge.getAvailableDevices().then(value => value.devices).catch(() => [] as CameraDevice[])
      if (current !== this.generation) throw new DOMException('相机请求已取消。', 'AbortError')
      const chosen = devices.find(device => device.deviceId === requestedDevice) ?? (!requestedDevice ? preferredRearCamera(devices) : undefined)
      try {
        await this.bridge.start({ ...bounds, ...(chosen ? { deviceId: chosen.deviceId } : { position: 'rear' }),
          toBack: true, aspectMode: 'cover', positioning: 'top', includeSafeAreaInsets: false, disableAudio: true, storeToFile: false,
          enableVideoMode: false, enablePhysicalDeviceSelection: false, disableFocusIndicator: true,
          captureResolution: { width: 3264, height: 2448 },
        })
        this.active = true
      } catch (cause) { await this.bridge.stop().catch(() => {}); throw cause }
      const actual = await this.bridge.getDeviceId().then(value => value.deviceId).catch(() => chosen?.deviceId ?? '')
      const zoom = await this.bridge.getZoom().then(value => value.current).catch(() => null)
      // 取景页只切换标准后摄与前摄，不轮流误选固定焦点的物理微距／长焦镜头。
      const rear = preferredRearCamera(devices), front = devices.find(device => device.position === 'front' && device.isLogical) ?? devices.find(device => device.position === 'front')
      return { devices: [rear, front].filter((device): device is CameraDevice => !!device), deviceId: actual, label: devices.find(device => device.deviceId === actual)?.label ?? chosen?.label ?? '后置相机', zoom }
    })
  }
  stop() { this.generation++; return this.enqueue(async () => { if (this.active) { try { await this.bridge.stop() } finally { this.active = false } } }) }
  resize(bounds: PreviewBounds) { return this.enqueue(async () => { if (this.active) await this.bridge.setPreviewSize(bounds) }) }
  focus(x: number, y: number) { return this.enqueue(async () => { if (!this.active) return false; await this.bridge.setFocus({ x, y }); return true }) }
  flash(enabled: boolean) { return this.enqueue(async () => { if (this.active) await this.bridge.setFlashMode({ flashMode: enabled ? 'torch' : 'off' }) }) }
  flashAvailable() { return this.enqueue(async () => this.active && (await this.bridge.getSupportedFlashModes()).result.includes('torch')) }
  capture() {
    return this.enqueue(async () => {
      if (!this.active) throw new Error('相机已暂停，请继续拍摄。')
      // CameraX ImageCapture输出照片；不截视频帧、不保存相册、不请求位置、不经磁盘长期保存。
      const photo = await this.bridge.capture({ quality: 92, format: 'jpeg', saveToGallery: false, withExifLocation: false, embedLocation: false, embedTimestamp: false })
      return jpegFile(photo.value)
    })
  }
}
