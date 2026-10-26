import { describe, expect, it, vi } from 'vitest'
import { cameraCrop, cameraFocusPoint, continuousFocus, pointFocus } from '../src/lib/camera'
describe('相机高清取景', () => {
  it('浏览器点按对焦使用完整视频坐标，失败返回不可用而非成功', async () => {
    const point = cameraFocusPoint(1920, 1080, 390, 550, 0, .5)
    expect(point.x).toBeGreaterThan(0); expect(point.y).toBe(.5)
    const applyConstraints = vi.fn().mockResolvedValue(undefined), track = { getCapabilities: () => ({ focusMode: ['continuous'] }), applyConstraints } as unknown as MediaStreamTrack
    expect(await pointFocus(track, point)).toBe(true); expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous', pointsOfInterest: [point] }] })
    applyConstraints.mockRejectedValueOnce(new Error('blocked')); expect(await pointFocus(track, point)).toBe(false)
  })
  it('横向后摄铺满竖屏，裁切而不挤压，并保持拍摄与预览相同', () => {
    const crop = cameraCrop(1920, 1080, 390, 550)
    expect(crop.height).toBe(1080); expect(crop.width / crop.height).toBeCloseTo(390 / 550); expect(crop.x).toBeCloseTo((1920 - crop.width) / 2); expect(crop.y).toBe(0)
    expect(crop.width).toBeLessThan(1920)
  })
  it('竖向后摄和横屏采用正确裁切，不超出源像素边界', () => {
    for (const [width, height, vw, vh] of [[1080, 1920, 390, 550], [1920, 1080, 800, 350], [1920, 1080, 1920, 1080]]) {
      const crop = cameraCrop(width!, height!, vw!, vh!); expect(crop.x).toBeGreaterThanOrEqual(0); expect(crop.y).toBeGreaterThanOrEqual(0); expect(crop.x + crop.width).toBeLessThanOrEqual(width!); expect(crop.y + crop.height).toBeLessThanOrEqual(height!); expect(crop.width / crop.height).toBeCloseTo(vw! / vh!)
    }
    expect(() => cameraCrop(0, 100, 390, 550)).toThrow()
  })
  it('仅在摄像头声明支持时启用连续对焦，拒绝后仍可拍摄', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined), track = { getCapabilities: () => ({ focusMode: ['manual', 'continuous'] }), applyConstraints } as unknown as MediaStreamTrack
    expect(await continuousFocus(track)).toBe(true); expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] })
    applyConstraints.mockRejectedValueOnce(new Error('unsupported')); expect(await continuousFocus(track)).toBe(false)
    applyConstraints.mockClear(); expect(await continuousFocus({ getCapabilities: () => ({}), applyConstraints } as unknown as MediaStreamTrack)).toBe(false); expect(applyConstraints).not.toHaveBeenCalled()
  })
})
