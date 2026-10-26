/**
 * OFF只读查询：条码先本地校验，固定URL/请求头/超时，限制响应大小后共享解析。
 * 查询不到返回null，网络或结构错误报中文错误；不自动改用AI，也不默认写个人包装库。
 * 页面需核对后显式保存；原始来源、营养口径与ODbL许可保留。完整接入步骤见
 * docs/open-food-facts.md；静态扩库脚本与此运行时接口是两个入口。
 */
import { offProductUrl, parseOffProduct, type PackagedFood } from '@shike/shared';
import { ApiError } from './errors.js';
import type { FetchLike } from './vision/types.js';
export async function lookupPackagedFood(barcode: string, fetchImpl: FetchLike = fetch): Promise<PackagedFood | null> {
  let url: string;
  try { url = offProductUrl(barcode) } catch { throw new ApiError('BARCODE_INVALID', '商品条码无效，请检查数字与校验位。') }
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Shike/0.7.0 (https://github.com/Anxiu29/shike)' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (response.status === 429) throw new ApiError('CATALOG_RATE_LIMIT', '免费商品库查询较频繁，请稍后再试。', 429, 60);
    if (!response.ok && response.status !== 404) throw new ApiError('CATALOG_UNAVAILABLE', '免费商品库暂时不可用，可以拍营养表或使用本地包装库。', 502);
    const text = await response.text(); if (text.length > 262144) throw new Error('oversize');
    const product = parseOffProduct(JSON.parse(text), barcode);
    if (response.status === 404 && product !== null) throw new Error('unexpected product');
    return product;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('CATALOG_UNAVAILABLE', '商品库连接失败或数据无法确认。可稍后重试、拍营养表或手动填写。', 502);
  }
}
