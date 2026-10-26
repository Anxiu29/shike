/** 与object-fit:cover相同的中心裁切。拍下的内容须与屏幕取景一致，不拉伸画面。 */
export function cameraCrop(width: number, height: number, viewWidth: number, viewHeight: number) {
  if (![width, height, viewWidth, viewHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('相机画面尺寸无效。')
  const scale = Math.max(viewWidth / width, viewHeight / height)
  const cropWidth = Math.min(width, viewWidth / scale), cropHeight = Math.min(height, viewHeight / scale)
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight }
}

type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean }
/** 对焦按真实能力启用。不支持或浏览器拒绝时，保留正常取景，不伪装对焦成功。 */
export async function continuousFocus(track: MediaStreamTrack): Promise<boolean> {
  try { const capabilities = track.getCapabilities?.() as FocusCapabilities | undefined; if (!capabilities?.focusMode?.includes('continuous')) return false; await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); return true }
  catch { return false }
}

/** 将cover取景框的点击还原到完整视频图像的归一化坐标，不能直接用屏幕百分比。 */
export function cameraFocusPoint(width: number, height: number, viewWidth: number, viewHeight: number, x: number, y: number) {
  const crop = cameraCrop(width, height, viewWidth, viewHeight)
  return { x: (crop.x + Math.max(0, Math.min(1, x)) * crop.width) / width, y: (crop.y + Math.max(0, Math.min(1, y)) * crop.height) / height }
}
export async function pointFocus(track: MediaStreamTrack, point: { x: number; y: number }): Promise<boolean> {
  try {
    const capabilities = track.getCapabilities?.() as FocusCapabilities | undefined
    const mode = capabilities?.focusMode?.find(value => value === 'continuous') ?? capabilities?.focusMode?.find(value => value === 'single-shot')
    if (!mode) return false
    await track.applyConstraints({ advanced: [{ focusMode: mode, pointsOfInterest: [point] } as MediaTrackConstraintSet] }); return true
  } catch { return false }
}
