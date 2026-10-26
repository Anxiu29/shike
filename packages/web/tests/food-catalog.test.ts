// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { bridge, platform } = vi.hoisted(() => ({ bridge: { lookup: vi.fn() }, platform: { isNativePlatform: vi.fn(() => true) } }))
vi.mock('@capacitor/core', () => ({ Capacitor: platform, registerPlugin: () => bridge }))
import { lookupProduct } from '../src/lib/food-catalog'
import { parseOffProduct } from '@shike/shared'
const code = '3274080005003'
const payload = { status: 1, product: { code, product_name: '测试', quantity: '250 ml', nutriments: { 'energy-kcal_100g': 40 } } }
let tick = 0
beforeEach(() => { vi.clearAllMocks(); platform.isNativePlatform.mockReturnValue(true); vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + ++tick * 10_000); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('设备商品查询路由', () => {
  it('Android仅把条码交给原生插件，返回数据仍执行共享校验', async () => {
    bridge.lookup.mockResolvedValue({ data: JSON.stringify(payload) })
    expect((await lookupProduct(code))!.source!.barcode).toBe(code); expect(bridge.lookup).toHaveBeenCalledWith({ barcode: code }); expect(fetch).not.toHaveBeenCalled()
    await expect(lookupProduct(code)).rejects.toThrow('间隔4秒'); expect(bridge.lookup).toHaveBeenCalledTimes(1)
  })
  it('Android拒绝无效JSON及条码，不请求模型或网页后端', async () => {
    bridge.lookup.mockResolvedValue({ data: '{invalid}' }); await expect(lookupProduct(code)).rejects.toThrow('无法确认')
    await expect(lookupProduct('invalid')).rejects.toThrow('有效的商品条码'); expect(bridge.lookup).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
  })
  it('网页只查同源接口，不传Key与Cookie，结构错误不保存', async () => {
    platform.isNativePlatform.mockReturnValue(false)
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ product: parseOffProduct(payload, code) })))
    expect((await lookupProduct(code))!.label.basis).toBe('100ml'); expect(fetch).toHaveBeenCalledWith(`/api/packaged-foods/${code}`, expect.objectContaining({ credentials: 'omit', redirect: 'error' })); expect(bridge.lookup).not.toHaveBeenCalled()
  })
  it('网页缺商品返回null，错误不自动重试或切到AI', async () => {
    platform.isNativePlatform.mockReturnValue(false); vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ product: null })))
    expect(await lookupProduct(code)).toBeNull(); vi.mocked(Date.now).mockReturnValue(2_000_000 + tick * 10_000)
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: '稍后再试' } }), { status: 429 })); await expect(lookupProduct(code)).rejects.toThrow('稍后再试'); expect(fetch).toHaveBeenCalledTimes(2)
  })
})
