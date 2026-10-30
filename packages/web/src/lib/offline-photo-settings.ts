/** 本机识图偏好只读本地开关；不能因查询模式而加载食品匹配库或开始推理。 */
import { offlineVisionSupported } from "./offline-vision";

const preferenceKey = 'shike-offline-photo-v1'
export function offlinePhotoEnabled(): boolean {
  if (!offlineVisionSupported()) return false
  try { return JSON.parse(localStorage.getItem(preferenceKey) ?? '{}').enabled === true } catch { return false }
}
export function offlinePhotoEstimates(): boolean {
  try { return JSON.parse(localStorage.getItem(preferenceKey) ?? '{}').estimateWeights !== false } catch { return true }
}
export function configureOfflinePhoto(enabled: boolean, estimateWeights = offlinePhotoEstimates()) {
  if (enabled && !offlineVisionSupported()) throw new Error('本机识图需要新版安卓独立APK。')
  localStorage.setItem(preferenceKey, JSON.stringify({ enabled, estimateWeights }))
}
