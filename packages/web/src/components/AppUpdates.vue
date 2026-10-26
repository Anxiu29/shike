<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUpRight, Download, LoaderCircle, RefreshCw, ShieldCheck, Smartphone } from '@lucide/vue'
import type { PluginListenerHandle } from '@capacitor/core'
import { normalizeUpdateRepository, type UpdateRelease } from '@shike/shared'
import { appUpdateInfo, buildUpdateInfo, cancelAppUpdate, checkAppUpdate, downloadAppUpdate, installAppUpdate, listenUpdateProgress, nativeUpdatesSupported, setUpdateRepository, type UpdateProgress } from '../lib/app-updates'

const native = nativeUpdatesSupported(), info = ref(buildUpdateInfo()), repository = ref(info.value.repository)
const giteeRepository = ref(info.value.giteeRepository)
const release = ref<UpdateRelease | null>(null), state = ref<'idle' | 'checking' | 'available' | 'current' | 'no_release' | 'downloading' | 'ready'>('idle')
const progress = ref<UpdateProgress>({ phase: 'downloading', percent: 0, received: 0, total: 0 }), error = ref(''), message = ref(''), saving = ref(false), installing = ref(false), cancelling = ref(false)
const locked = computed(() => saving.value || installing.value || state.value === 'checking' || state.value === 'downloading')
const compatible = computed(() => !native || !release.value || release.value.manifest.minSdk <= info.value.sdk)
const formatBytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`
let listener: PluginListenerHandle | undefined, disposed = false
onMounted(async () => {
  try { const value = await appUpdateInfo(); if (!disposed) { info.value = value; repository.value = value.repository; giteeRepository.value = value.giteeRepository ?? '' } }
  catch { error.value = '无法读取当前安装版本，请重新打开设置。' }
})
onBeforeUnmount(() => { disposed = true; if (state.value === 'downloading') void cancelAppUpdate().catch(() => {}); void listener?.remove() })
async function saveRepository() {
  if (locked.value) return
  saving.value = true; error.value = ''; message.value = ''
  try { info.value = await setUpdateRepository(repository.value, giteeRepository.value); repository.value = info.value.repository; giteeRepository.value = info.value.giteeRepository; release.value = null; state.value = 'idle'; message.value = '更新仓库已保存，点击检查更新查看发行版。' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '更新仓库保存失败。' }
  finally { saving.value = false }
}
async function check() {
  if (locked.value) return
  error.value = ''; message.value = ''
  try { if (normalizeUpdateRepository(repository.value) !== info.value.repository || (giteeRepository.value.trim() ? normalizeUpdateRepository(giteeRepository.value, 'gitee') : '') !== (info.value.giteeRepository ?? '')) { error.value = '仓库地址已修改，请先保存。'; return } }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '仓库地址无效。'; return }
  state.value = 'checking'
  try {
    const result = await checkAppUpdate(); if (disposed) return
    info.value = result.current; release.value = result.release; state.value = result.status; message.value = result.message ?? ''
    if (result.status === 'available' && result.current.readyVersionCode === result.release?.manifest.versionCode) state.value = 'ready'
  } catch (cause) { state.value = 'idle'; release.value = null; error.value = cause instanceof Error ? cause.message : '检查更新失败，请稍后重试。' }
}
async function download() {
  if (locked.value || !release.value || !compatible.value || !native) return
  state.value = 'downloading'; error.value = ''; message.value = ''; progress.value = { phase: 'downloading', percent: 0, received: 0, total: release.value.manifest.bytes }
  try {
    listener = await listenUpdateProgress(value => { if (!disposed && state.value === 'downloading' && Number.isFinite(value.percent)) { progress.value = { ...value, percent: Math.max(0, Math.min(99, value.percent)) }; if (release.value && value.source) release.value.source = value.source } })
    if (disposed) { await listener.remove(); return }
    if (cancelling.value) throw new Error('下载已取消。')
    info.value = await downloadAppUpdate(); if (!disposed) { if (release.value && info.value.readySource) release.value.source = info.value.readySource; state.value = 'ready'; message.value = '安装包校验通过，可继续安装。' }
  } catch (cause) { state.value = 'available'; if (cancelling.value) message.value = '下载已取消，可重新下载。'; else error.value = cause instanceof Error ? cause.message : '下载失败，请重新检查更新。' }
  finally { await listener?.remove().catch(() => {}); listener = undefined; cancelling.value = false }
}
async function cancel() { if (cancelling.value) return; cancelling.value = true; try { await cancelAppUpdate() } catch { cancelling.value = false; error.value = '暂时无法取消，请稍候。' } }
async function install() {
  if (locked.value || state.value !== 'ready') return
  installing.value = true; error.value = ''; message.value = ''
  try {
    const result = await installAppUpdate()
    message.value = result.status === 'permission_required' ? '请在系统页面允许食刻安装更新，返回后点击“安装更新”继续。' : '已打开系统安装界面。完成安装后重新打开食刻；取消安装仍可继续使用当前版本。'
  } catch (cause) { state.value = 'available'; error.value = cause instanceof Error ? cause.message : '无法安装，请重新下载。' }
  finally { installing.value = false }
}
</script>
<template>
  <article class="card settings-card app-update-card" data-testid="app-update-card">
    <div class="settings-card-title"><span class="settings-feature-icon"><Smartphone :size="22" /></span><div><h2>版本与更新</h2><p>当前{{ native ? '安装' : '网页' }}版本 <strong data-testid="app-current-version">{{ info.versionName }}</strong></p></div><span class="soft-tag">{{ native ? 'Android' : '网页版' }}</span></div>
    <div class="app-update-overview"><p data-testid="app-update-priority">{{ info.giteeRepository ? 'Gitee 国内源优先，GitHub 作为备用。' : '从 GitHub 检查公开发行版。' }}</p><button type="button" class="button secondary" data-testid="check-app-update" :disabled="locked" @click="check"><LoaderCircle v-if="state === 'checking'" :size="16" class="spin" /><RefreshCw v-else :size="16" />{{ state === 'checking' ? '正在检查' : '检查更新' }}</button></div>
    <p v-if="state === 'current'" class="notice" data-testid="app-update-status">当前已是此发布源提供的版本或更新版本。</p>
    <p v-if="state === 'no_release'" class="notice warning" data-testid="app-update-status">暂未发现带更新文件的公开发行版，请先在仓库发布 APK 和更新说明文件。</p>
    <div v-if="release && ['available', 'downloading', 'ready'].includes(state)" class="app-update-release" data-testid="app-update-release">
      <div class="section-heading"><h3>发现新版 {{ release.manifest.versionName }}</h3><span class="soft-tag">{{ formatBytes(release.manifest.bytes) }}</span></div>
      <p class="tiny muted">{{ release.manifest.releasedAt.slice(0, 10) }} 发布 · <span data-testid="app-update-selected-source">{{ release.source === 'gitee' ? 'Gitee 国内源' : 'GitHub 备用源' }}</span></p>
      <ul><li v-for="note in release.manifest.notes" :key="note">{{ note }}</li></ul>
      <p v-if="!compatible" class="notice warning">此更新需要更高版本的 Android，当前设备暂不能安装。</p>
      <div v-if="state === 'downloading'" class="app-update-progress" aria-live="polite" data-testid="app-update-progress"><div><span>{{ progress.phase === 'verifying' ? '正在校验安装包…' : cancelling ? '正在取消…' : '正在下载' }}</span><strong>{{ progress.percent }}%</strong></div><progress :value="progress.percent" max="100" aria-label="更新下载进度"></progress><div><small>{{ formatBytes(progress.received) }} / {{ formatBytes(progress.total) }}</small><button class="text-button" :disabled="cancelling" data-testid="cancel-app-update" @click="cancel">取消下载</button></div></div>
      <div v-else class="backup-buttons"><button v-if="native && state !== 'ready'" class="button primary" :disabled="locked || !compatible" data-testid="download-app-update" @click="download"><Download :size="16" />下载更新</button><button v-if="native && state === 'ready'" class="button primary" :disabled="locked" data-testid="install-app-update" @click="install"><LoaderCircle v-if="installing" class="spin" :size="16" />安装更新</button><a v-if="!native" class="button primary" :href="release.apkUrl" target="_blank" rel="noopener noreferrer" data-testid="download-apk-link"><Download :size="16" />下载安卓 APK</a><a class="text-button" :href="release.releaseUrl" target="_blank" rel="noopener noreferrer">查看发行版<ArrowUpRight :size="13" /></a></div>
      <p class="app-update-verification"><ShieldCheck :size="14" /><span>{{ native ? '下载后核对文件完整性、应用标识、版本和签名，由系统确认安装。' : '安卓 APK 用于手机安装；网页由部署者更新，刷新时保留同一来源的本地记录。' }}</span></p>
    </div>
    <p v-if="error" class="notice danger" role="alert" data-testid="app-update-error">{{ error }}</p><p v-if="message" class="notice" role="status" data-testid="app-update-message">{{ message }}</p>
    <details class="settings-inline-details app-update-source" data-testid="app-update-source"><summary>更新仓库与说明</summary><p>先查 Gitee；连接失败、未发布或没有更高版本时再查 GitHub。读取公开版本无需令牌。</p><label>Gitee 国内源（优先）<input v-model="giteeRepository" :disabled="locked" placeholder="用户名/仓库名；留空停用" autocomplete="off" spellcheck="false" data-testid="update-gitee-repository" /></label><label>GitHub 备用源<input v-model="repository" :disabled="locked" placeholder="用户名/仓库名" autocomplete="off" spellcheck="false" data-testid="update-repository" /></label><button class="button secondary" :disabled="locked" data-testid="save-update-repository" @click="saveRepository">保存仓库</button><p>点击检查才联网；测试发行版也会列出。Gitee 下载连接失败时，仅在备用源版本与哈希一致时切换；校验失败会停止。下载可取消，安装由系统确认，保留记录与模型配置。</p></details>
  </article>
</template>
