import { normalizeUpdateRepository, updateAssetUrl, updateDownloadUrl } from '@shike/shared';
import { ApiError } from './errors.js';
import type { FetchLike } from './vision/types.js';

/** 仅代理 Gitee 的公开版本列表/固定 JSON，解决浏览器跨域；不代理 APK 或任意 URL。 */
export async function readGiteeUpdate(repository: string, tag: string | undefined, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const repo = normalizeUpdateRepository(repository, 'gitee');
  let url = `https://gitee.com/api/v5/repos/${repo}/releases?page=1&per_page=10&direction=desc`;
  if (tag !== undefined) {
    if (!tag || tag.length > 200 || /[/\\]/.test(tag) || ['.', '..'].includes(tag)) throw new ApiError('UPDATE_SOURCE_INVALID', '发行版标签无效。');
    url = updateAssetUrl(`https://gitee.com/${repo}/releases/download/${encodeURIComponent(tag)}/shike-update.json`, repo, 'shike-update.json', 'gitee');
  }
  const signal = AbortSignal.timeout(15000), limit = tag === undefined ? 1024 * 1024 : 65536;
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      try { updateDownloadUrl(url, 'gitee'); } catch { throw new ApiError('UPDATE_METADATA_INVALID', '更新下载跳转到不受支持的地址，已停止。', 502); }
      const response = await fetchImpl(url, { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/json', 'User-Agent': 'Shike-Updater' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error();
        url = new URL(location, url).href; continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError('UPDATE_SOURCE_UNAVAILABLE', response.status === 404 ? 'Gitee仓库或更新文件不存在、尚未公开。' : 'Gitee暂时无法访问，请稍后重试。', 502);
      }
      if (!response.body) throw new Error();
      const reader = response.body.getReader(); let size = 0; const parts: Uint8Array[] = [];
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); throw new ApiError('UPDATE_METADATA_INVALID', '更新信息过大，已停止读取。', 502); } parts.push(part.value); }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown; }
      catch { throw new ApiError('UPDATE_METADATA_INVALID', 'Gitee更新文件不是有效JSON，已停止检查。', 502); }
    }
    throw new Error();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('UPDATE_SOURCE_UNAVAILABLE', 'Gitee暂时无法访问，请稍后重试。', 502);
  }
}
