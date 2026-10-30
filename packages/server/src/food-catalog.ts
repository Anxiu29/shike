/**
 * OFF只读查询：条码先本地校验，固定URL/请求头/超时，限制响应大小后共享解析。
 * 查询不到返回null，网络或结构错误报中文错误；不自动改用AI，也不默认写个人包装库。
 * 页面需核对后显式保存；原始来源、营养口径与ODbL许可保留。完整接入步骤见
 * docs/open-food-facts.md；静态扩库脚本与此运行时接口是两个入口。
 */
import { offProductUrl, parseOffProduct, type PackagedFood } from '@shike/shared';
import { ApiError } from './errors.js';
import type { FetchLike } from './vision/types.js';
import { discardResponse, readBoundedText } from './http-body.js';
/**
 * 条码查询的null只表示来源明确报告未找到；网络/格式错误必须抛出，不能伪装成无商品。
 * offProductUrl先校验条码及校验位，固定来源避免把此接口变成任意URL代理。
 * 返回规范化的PackagedFood，是否采纳并保存由网页用户核对后决定。
 */
export async function lookupPackagedFood(barcode: string, fetchImpl: FetchLike = fetch): Promise<PackagedFood | null> {
  let url: string;
  try { url = offProductUrl(barcode) } catch { throw new ApiError('BARCODE_INVALID', '商品条码无效，请检查数字与校验位。') }
  try {
    const signal = AbortSignal.timeout(8000);
    const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Shike/0.7.0 (https://github.com/Anxiu29/shike)' }, signal, redirect: 'error' });
    if (response.status === 429) { discardResponse(response); throw new ApiError('CATALOG_RATE_LIMIT', '免费商品库查询较频繁，请稍后再试。', 429, 60); }
    if (!response.ok && response.status !== 404) { discardResponse(response); throw new ApiError('CATALOG_UNAVAILABLE', '免费商品库暂时不可用，可以拍营养表或使用本地包装库。', 502); }
    // 共享读取器同时处理分块字节上限、中文UTF-8和超时取消，不按Content-Length放行。
    const text = await readBoundedText(response, 262144, signal);
    const product = parseOffProduct(JSON.parse(text), barcode);
    if (response.status === 404 && product !== null) throw new Error('unexpected product');
    return product;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('CATALOG_UNAVAILABLE', '商品库连接失败或数据无法确认。可稍后重试、拍营养表或手动填写。', 502);
  }
}
