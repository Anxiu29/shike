import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { defaultGiteeUpdateRepository, defaultUpdateRepository, giteeUpdateAssets, githubUpdateAssets, normalizeUpdateRepository, updateManifestSchema, type UpdateRelease, type UpdateSource, updateAppId } from '@shike/shared'
import release from '../../../../config/app-release.json'

export interface AppUpdateInfo { appId: string; versionCode: number; versionName: string; repository: string; giteeRepository: string; sdk: number; readyVersionCode: number; readySource?: UpdateSource }
export interface AppUpdateCheck { current: AppUpdateInfo; status: 'available' | 'current' | 'no_release'; release: UpdateRelease | null; message?: string }
export interface UpdateProgress { phase: 'downloading' | 'verifying'; percent: number; received: number; total: number; source?: UpdateSource }
interface UpdaterBridge {
  getInfo(): Promise<AppUpdateInfo>
  setRepository(input: { repository: string; giteeRepository: string }): Promise<AppUpdateInfo>
  check(): Promise<AppUpdateCheck>
  download(): Promise<AppUpdateInfo>
  cancelDownload(): Promise<void>
  install(): Promise<{ status: 'permission_required' | 'installer_opened' }>
  addListener(event: 'downloadProgress', callback: (value: UpdateProgress) => void): Promise<PluginListenerHandle>
}
const native = registerPlugin<UpdaterBridge>('AppUpdater'), repositoryKey = 'shike-update-repository-v1', giteeKey = 'shike-update-gitee-repository-v1'
export const nativeUpdatesSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AppUpdater')
export function buildUpdateInfo(): AppUpdateInfo {
  let repository = defaultUpdateRepository, giteeRepository = ''
  try { repository = normalizeUpdateRepository(localStorage.getItem(repositoryKey) || repository) } catch { /* 损坏偏好回到默认仓库，不影响记录。 */ }
  try { const saved = localStorage.getItem(giteeKey); giteeRepository = saved === null ? (repository.toLowerCase() === defaultUpdateRepository.toLowerCase() ? defaultGiteeUpdateRepository : '') : saved ? normalizeUpdateRepository(saved, 'gitee') : '' } catch { /* 无效镜像停用，继续使用备用源。 */ }
  return { appId: updateAppId, versionCode: release.versionCode, versionName: release.versionName, repository, giteeRepository, sdk: 0, readyVersionCode: 0 }
}
export async function appUpdateInfo() { return nativeUpdatesSupported() ? native.getInfo() : buildUpdateInfo() }
export async function setUpdateRepository(input: string, giteeInput = buildUpdateInfo().giteeRepository) {
  const repository = normalizeUpdateRepository(input), giteeRepository = giteeInput.trim() ? normalizeUpdateRepository(giteeInput, 'gitee') : ''
  if (nativeUpdatesSupported()) return native.setRepository({ repository, giteeRepository })
  localStorage.setItem(repositoryKey, repository); localStorage.setItem(giteeKey, giteeRepository); return buildUpdateInfo()
}
class SourceUnavailable extends Error {}
export async function checkAppUpdate(): Promise<AppUpdateCheck> {
  if (nativeUpdatesSupported()) {
    const result = await native.check()
    if (result.release) result.release.manifest = updateManifestSchema.parse(result.release.manifest)
    return result
  }
  const current = buildUpdateInfo()
  async function checkSource(source: UpdateSource): Promise<UpdateRelease | null> {
    const signal = AbortSignal.timeout(source === 'gitee' ? 15000 : 20000), label = source === 'gitee' ? 'Gitee' : 'GitHub'
    async function json(url: string, limit: number): Promise<unknown> {
      let response: Response
      try { response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } }) }
      catch { throw new SourceUnavailable(`${label}连接失败或超时。`) }
      if (!response.ok) {
        if (source === 'gitee') { const body = await response.json().catch(() => null); if (body?.error?.code === 'UPDATE_METADATA_INVALID') throw new Error('Gitee更新文件无效，已停止检查。') }
        if (response.status === 404) throw new SourceUnavailable(`${label}仓库或更新文件不存在、尚未公开，请检查仓库与发行版设置。`)
        throw new SourceUnavailable(`${label}暂时限制访问或服务不可用，请稍后重试。`)
      }
      if (!response.body) throw new Error('更新信息为空。')
      const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0, text = ''
      try {
        while (true) { let chunk: ReadableStreamReadResult<Uint8Array>; try { chunk = await reader.read() } catch { throw new SourceUnavailable(`${label}读取更新信息失败。`) } if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('更新信息过大，已停止读取。') } text += decoder.decode(chunk.value, { stream: true }) }
        text += decoder.decode(); return JSON.parse(text) as unknown
      } finally { reader.releaseLock() }
    }
    const repo = source === 'gitee' ? current.giteeRepository : current.repository
    const listUrl = source === 'gitee' ? `/api/app-updates/gitee?repository=${encodeURIComponent(repo)}` : `https://api.github.com/repos/${repo}/releases?per_page=10`
    const assets = source === 'gitee' ? giteeUpdateAssets(await json(listUrl, 1024 * 1024), repo) : githubUpdateAssets(await json(listUrl, 1024 * 1024), repo)
    if (!assets) return null
    const manifestUrl = source === 'gitee' ? `${listUrl}&tag=${encodeURIComponent(decodeURIComponent(new URL(assets.manifestUrl).pathname.split('/').at(-2)!))}` : assets.manifestUrl
    const manifest = updateManifestSchema.parse(await json(manifestUrl, 65536))
    if ('bytes' in assets && assets.bytes !== manifest.bytes) throw new Error('安装包大小与更新说明不一致。')
    return { manifest, apkUrl: assets.apkUrl, releaseUrl: assets.releaseUrl, source }
  }
  let first: UpdateRelease | null = null, reason = ''
  if (current.giteeRepository) {
    try { first = await checkSource('gitee') } catch (error) { if (!(error instanceof SourceUnavailable)) throw new Error('Gitee更新文件无效，已停止检查；请联系发布者。'); reason = error.message }
    if (first && first.manifest.versionCode > current.versionCode) return { current, status: 'available', release: first }
  }
  try {
    const backup = await checkSource('github')
    if (backup && (!first || backup.manifest.versionCode > first.manifest.versionCode)) return { current, status: backup.manifest.versionCode > current.versionCode ? 'available' : 'current', release: backup, message: current.giteeRepository ? `${reason || 'Gitee暂无更高版本。'} 已检查 GitHub 备用源。` : '' }
    if (reason && !backup) throw new SourceUnavailable(`${reason} GitHub暂无可用发行版，尚无法确认更新。`)
    return { current, status: first || backup ? 'current' : 'no_release', release: first || backup }
  } catch (error) {
    if (!(error instanceof SourceUnavailable)) throw new Error('GitHub更新文件无效，已停止检查；请联系发布者。')
    if (first) return { current, status: 'current', release: first, message: `已检查 Gitee；${error.message} 备用源未完成检查。` }
    throw error
  }
}
export const downloadAppUpdate = () => native.download()
export const cancelAppUpdate = () => native.cancelDownload()
export const installAppUpdate = () => native.install()
export const listenUpdateProgress = (callback: (value: UpdateProgress) => void) => native.addListener('downloadProgress', callback)
