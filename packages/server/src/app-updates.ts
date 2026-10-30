import { normalizeUpdateRepository, updateAssetUrl, updateDownloadUrl } from '@shike/shared';
import { ApiError } from './errors.js';
import type { FetchLike } from './vision/types.js';
import { discardResponse, readBoundedText, ResponseTooLargeError } from './http-body.js';

/**
 * 仅代理Gitee公开版本列表/固定JSON，解决浏览器跨域；不代理APK或任意URL。
 * 仓库规范化→构造固定地址→逐跳校验地址→有界读取→JSON解析。
 * 无凭据请求不代表可以随意跳转：每一跳仍由共享URL策略拒绝私网/不受支持主机。
 * 这里只有传输与JSON边界，更新版本/哈希等业务字段仍由使用者的共享更新逻辑验证。
 */
export async function readGiteeUpdate(repository: string, tag: string | undefined, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const repo = normalizeUpdateRepository(repository, 'gitee');
  let url = `https://gitee.com/api/v5/repos/${repo}/releases?page=1&per_page=10&direction=desc`;
  if (tag !== undefined) {
    if (!tag || tag.length > 200 || /[/\\]/.test(tag) || ['.', '..'].includes(tag)) throw new ApiError('UPDATE_SOURCE_INVALID', '发行版标签无效。');
    url = updateAssetUrl(`https://gitee.com/${repo}/releases/download/${encodeURIComponent(tag)}/shike-update.json`, repo, 'shike-update.json', 'gitee');
  }
  // 同一个signal贯穿所有跳转及正文下载，不能每跳重新获得15秒，导致总等待叠加。
  const signal = AbortSignal.timeout(15000), limit = tag === undefined ? 1024 * 1024 : 65536;
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      try { updateDownloadUrl(url, 'gitee'); } catch { throw new ApiError('UPDATE_METADATA_INVALID', '更新下载跳转到不受支持的地址，已停止。', 502); }
      const response = await fetchImpl(url, { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/json', 'User-Agent': 'Shike-Updater' } });
      if (response.status >= 300 && response.status < 400) {
        // 未读正文也要取消；清理不await，否则取消迟迟不完成会一直占用更新检查槽位。
        const location = response.headers.get('location'); discardResponse(response);
        if (!location) throw new Error();
        url = new URL(location, url).href; continue;
      }
      if (!response.ok) {
        discardResponse(response);
        throw new ApiError('UPDATE_SOURCE_UNAVAILABLE', response.status === 404 ? 'Gitee仓库或更新文件不存在、尚未公开。' : 'Gitee暂时无法访问，请稍后重试。', 502);
      }
      if (!response.body) throw new Error();
      let text: string;
      try { text = await readBoundedText(response, limit, signal); }
      catch (error) {
        if (error instanceof ResponseTooLargeError) throw new ApiError('UPDATE_METADATA_INVALID', '更新信息过大，已停止读取。', 502);
        throw error;
      }
      try { return JSON.parse(text) as unknown; }
      catch { throw new ApiError('UPDATE_METADATA_INVALID', 'Gitee更新文件不是有效JSON，已停止检查。', 502); }
    }
    throw new Error();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('UPDATE_SOURCE_UNAVAILABLE', 'Gitee暂时无法访问，请稍后重试。', 502);
  }
}
