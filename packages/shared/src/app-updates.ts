import { z } from 'zod';

export const updateAppId = 'cn.anxiu29.shike';
export const defaultUpdateRepository = 'Anxiu29/shike';
export const defaultGiteeUpdateRepository = 'anxiu29/shike';
export type UpdateSource = 'gitee' | 'github';
export const updateManifestName = 'shike-update.json';
export const updateApkName = 'shike.apk';
export const maxUpdateBytes = 200 * 1024 * 1024;
export const updateManifestSchema = z.object({
  schemaVersion: z.literal(1), appId: z.literal(updateAppId),
  versionCode: z.number().int().min(1).max(2100000000), versionName: z.string().trim().min(1).max(60),
  releasedAt: z.iso.datetime(), minSdk: z.number().int().min(24).max(100),
  bytes: z.number().int().min(1024).max(maxUpdateBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  notes: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
}).strict();
export type UpdateManifest = z.infer<typeof updateManifestSchema>;
export interface UpdateRelease { manifest: UpdateManifest; apkUrl: string; releaseUrl: string; source?: UpdateSource }

/** 只配置公开仓库，不接受凭据、任意主机或本机文件。 */
export function normalizeUpdateRepository(value: string, source: UpdateSource = 'github'): string {
  const text = value.trim().replace(/\/$/, '');
  const prefix = `https://${source}.com/`;
  const repository = (text.startsWith(prefix) ? text.slice(prefix.length) : text).replace(/\.git$/, '');
  const owner = source === 'gitee' ? '[A-Za-z0-9][A-Za-z0-9_-]{0,99}' : '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
  if (!new RegExp(`^${owner}/[A-Za-z0-9_.-]{1,100}$`).test(repository) || ['.', '..'].includes(repository.split('/')[1]!)) throw new Error(`请填写公开${source === 'gitee' ? 'Gitee' : 'GitHub'}仓库，格式为 用户名/仓库名。`);
  return repository;
}
export function updateAssetUrl(value: string, repository: string, filename: string, source: UpdateSource = 'github'): string {
  const url = new URL(value), prefix = `/${normalizeUpdateRepository(repository, source)}/releases/download/`;
  const rest = url.pathname.slice(prefix.length), parts = rest.split('/');
  if (url.protocol !== 'https:' || url.hostname !== `${source}.com` || url.port || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix) || parts.length !== 2 || !parts[0] || parts[1] !== filename || /%2f|%5c/i.test(parts[0]) || ['.', '..'].includes(decodeURIComponent(parts[0]))) throw new Error('更新资源地址与所选仓库不一致。');
  return url.href;
}
/** Gitee 的附件没有 size / published_at；大小以严格更新说明及下载流校验为准。 */
export function giteeUpdateAssets(value: unknown, repository: string): { apkUrl: string; manifestUrl: string; releaseUrl: string } | null {
  if (!Array.isArray(value) || value.length > 10) throw new Error('Gitee更新列表格式无效。');
  // Gitee 的实际接口会按旧版在前返回，不能沿用 GitHub 的列表顺序。
  const timestamp = (item: any) => typeof item?.created_at === 'string' && Number.isFinite(Date.parse(item.created_at)) ? Date.parse(item.created_at) : 0;
  const releases = [...value].sort((a, b) => timestamp(b) - timestamp(a) || (Number.isSafeInteger(b?.id) ? b.id : 0) - (Number.isSafeInteger(a?.id) ? a.id : 0));
  for (const item of releases) {
    if (!item || typeof item !== 'object' || item.draft === true || !item.created_at || !Array.isArray(item.assets)) continue;
    if (item.assets.length > 100) throw new Error('Gitee更新资源过多。');
    const apk = item.assets.find((asset: any) => asset?.name === updateApkName), manifest = item.assets.find((asset: any) => asset?.name === updateManifestName);
    if (!apk || !manifest) continue;
    if (typeof item.tag_name !== 'string' || typeof apk.browser_download_url !== 'string' || typeof manifest.browser_download_url !== 'string') throw new Error('Gitee更新资源格式无效。');
    const apkUrl = updateAssetUrl(apk.browser_download_url, repository, updateApkName, 'gitee'), manifestUrl = updateAssetUrl(manifest.browser_download_url, repository, updateManifestName, 'gitee');
    const prefix = apkUrl.slice(0, -updateApkName.length);
    if (prefix !== manifestUrl.slice(0, -updateManifestName.length) || decodeURIComponent(new URL(apkUrl).pathname.split('/').at(-2)!) !== item.tag_name) throw new Error('更新文件来自不同发行版。');
    return { apkUrl, manifestUrl, releaseUrl: prefix.slice(0, -1).replace('/releases/download/', '/releases/tag/') };
  }
  return null;
}
export function updateDownloadUrl(value: string, source: UpdateSource): string {
  const url = new URL(value);
  const hosts = source === 'gitee' ? ['gitee.com', 'foruda.gitee.com'] : ['github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !hosts.includes(url.hostname)) throw new Error('更新下载跳转到不受支持的地址，已停止。');
  return url.href;
}
export function githubUpdateAssets(value: unknown, repository: string): { apkUrl: string; manifestUrl: string; bytes: number; releaseUrl: string } | null {
  if (!Array.isArray(value) || value.length > 10) throw new Error('GitHub更新列表格式无效。');
  for (const item of value) {
    if (!item || typeof item !== 'object' || item.draft !== false || !item.published_at || !Array.isArray(item.assets)) continue;
    const apk = item.assets.find((asset: any) => asset?.name === updateApkName), manifest = item.assets.find((asset: any) => asset?.name === updateManifestName);
    if (!apk || !manifest) continue;
    if (!Number.isInteger(apk.size) || apk.size < 1024 || apk.size > maxUpdateBytes || typeof apk.browser_download_url !== 'string' || typeof manifest.browser_download_url !== 'string') throw new Error('GitHub更新资源格式无效。');
    const apkUrl = updateAssetUrl(apk.browser_download_url, repository, updateApkName), manifestUrl = updateAssetUrl(manifest.browser_download_url, repository, updateManifestName);
    if (new URL(apkUrl).pathname.slice(0, -updateApkName.length) !== new URL(manifestUrl).pathname.slice(0, -updateManifestName.length)) throw new Error('更新文件来自不同发行版。');
    return { apkUrl, manifestUrl, bytes: apk.size, releaseUrl: apkUrl.slice(0, apkUrl.lastIndexOf('/')).replace('/releases/download/', '/releases/tag/') };
  }
  return null;
}
