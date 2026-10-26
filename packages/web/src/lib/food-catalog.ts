import { Capacitor, registerPlugin } from '@capacitor/core'
import { barcodeSchema, packagedFoodSchema, parseOffProduct, type PackagedFood } from '@shike/shared'
const native = registerPlugin<{ lookup(input: { barcode: string }): Promise<{ data: string }> }>('FoodCatalog')
let lastQuery = 0
export async function lookupProduct(value: string): Promise<PackagedFood | null> {
  const barcode = barcodeSchema.safeParse(value.trim())
  if (!barcode.success) throw new Error('请输入有效的商品条码，检查数字与末位校验码。')
  if (Date.now() - lastQuery < 4000) throw new Error('请间隔4秒再查询免费商品库。')
  lastQuery = Date.now()
  if (Capacitor.isNativePlatform()) {
    const response = await native.lookup({ barcode: barcode.data })
    if (typeof response.data !== 'string' || response.data.length > 262144) throw new Error('商品库返回的数据无效。')
    try { return parseOffProduct(JSON.parse(response.data), barcode.data) } catch { throw new Error('商品数据无法确认，请拍营养表或手动填写。') }
  }
  try {
    const response = await fetch(`/api/packaged-foods/${barcode.data}`, { signal: AbortSignal.timeout(10000), credentials: 'omit', redirect: 'error' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error?.message ?? '免费商品库暂时不可用。')
    return payload.product === null ? null : packagedFoodSchema.parse(payload.product)
  } catch (error) { if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new Error('商品查询超时，本地包装库仍可使用。'); throw error }
}
