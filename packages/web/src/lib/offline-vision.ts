import { Capacitor, registerPlugin } from '@capacitor/core'
import { compressedImageBase64, validateOriginal } from './image'
import type { OfflineAiState } from './offline-ai'

interface OfflineVisionBridge {
  getState(): Promise<OfflineAiState>
  downloadModel(): Promise<void>
  importModel(): Promise<void>
  generateImage(options: { imageBase64: string; prompt: string; namesOnly?: boolean; task?: 'names' | 'food_estimate' | 'package_label' }): Promise<void>
  cancel(): Promise<void>
  unload(): Promise<void>
  deleteModel(): Promise<void>
}
export const offlineVision = registerPlugin<OfflineVisionBridge>('OfflineVision')
export const offlineVisionModel = {
  name: 'Qwen3.5-0.8B · INT8 视觉版', bytes: 1_303_671_472,
  filename: 'Qwen3.5-0.8B-VL_int8.litertlm',
  revision: 'ff11c109e8e56797cd1ee5befa856975bb465afc',
  sha256: '1ab56460263fe94fde5fec160363d3aacbae9c5ee3638121c11feb51e483e29d',
  source: 'https://huggingface.co/litert-community/Qwen3.5-0.8B',
  url: 'https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/ff11c109e8e56797cd1ee5befa856975bb465afc/Qwen3.5-0.8B-VL_int8.litertlm',
}
export const offlineVisionSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('OfflineVision')
/** 一张512方图：等比例缩小并补白，不裁掉餐盘；重新编码移除EXIF/GPS。 */
export async function offlineVisionImage(file: File): Promise<{ base64: string; preview: string }> {
  validateOriginal(file)
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > 50_000_000) throw new Error('照片像素过大或无效，请缩小后重试。')
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    const context = canvas.getContext('2d'); if (!context) throw new Error('当前设备无法处理照片。')
    const scale = Math.min(512 / bitmap.width, 512 / bitmap.height, 1), width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale))
    context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 512)
    context.drawImage(bitmap, (512 - width) / 2, (512 - height) / 2, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob || blob.size > 1024 * 1024) throw new Error('照片压缩失败，请换一张照片。')
    const base64 = await compressedImageBase64(new File([blob], 'offline-vision.jpg', { type: 'image/jpeg' }))
    return { base64, preview: `data:image/jpeg;base64,${base64}` }
  } finally { bitmap.close() }
}
