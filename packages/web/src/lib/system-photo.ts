import { Capacitor, registerPlugin } from '@capacitor/core'
import { jpegFile } from './native-camera'

interface SystemPhotoBridge { capture(): Promise<{ cancelled: boolean; jpegBase64?: string }> }
const systemPhoto = registerPlugin<SystemPhotoBridge>('SystemPhoto')
export function systemPhotoAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SystemPhoto')
}
/** 只在用户点击拍照后调用。取消返回null，不创建照片、草稿或记录。 */
export async function takeSystemPhoto(): Promise<File | null> {
  if (!systemPhotoAvailable()) throw new Error('请安装支持系统相机的新版安卓APK。')
  const result = await systemPhoto.capture()
  if (result.cancelled === true) return null
  if (result.cancelled !== false || !result.jpegBase64) throw new Error('系统相机没有返回照片，请重试。')
  return jpegFile(result.jpegBase64)
}
