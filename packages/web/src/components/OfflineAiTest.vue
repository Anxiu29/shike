<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download, FolderOpen, LoaderCircle, Play, Square, Trash2, Copy, HardDrive } from '@lucide/vue'
import { offlineAi, offlineModel, formatOfflineBytes, formatOfflineTime, offlineAssistantEnabled, offlineAssistantBackend, configureOfflineAssistant, type OfflineAiState } from '../lib/offline-ai'

const emit = defineEmits<{ busy: [value: boolean] }>()
const state = ref<OfflineAiState | null>(null), error = ref(''), notice = ref(''), pending = ref(false)
const backend = ref<'cpu' | 'gpu'>(offlineAssistantBackend())
const prompt = ref('请把以下用餐描述整理成清单，只列食物名称和明确说出的数量，不推测重量和热量：午餐吃了两个鸡蛋、一碗米饭和一杯牛奶。')
const busy = computed(() => pending.value || Boolean(state.value?.busy))
const stages: Record<string, string> = { idle: '模型尚未准备', downloading: '正在下载', importing: '正在导入', verifying: '正在校验完整性', ready: '模型已保存，尚未加载', loading: '正在加载模型', loaded: '已加载，可以提问', generating: '正在本机生成', completed: '本次生成完成', stopped: '已停止', releasing: '正在释放内存', deleting: '正在删除', error: '操作未完成' }
const status = computed(() => state.value ? stages[state.value.stage] ?? '等待操作' : '正在读取手机状态')
const transferring = computed(() => ['downloading', 'importing', 'verifying'].includes(state.value?.stage ?? ''))
const canStop = computed(() => transferring.value || state.value?.stage === 'generating')
const progress = computed(() => Math.min(100, Math.max(0, (state.value?.progressBytes ?? 0) / offlineModel.bytes * 100)))
let disposed = false, polling = false, timer: ReturnType<typeof setInterval> | undefined
watch(busy, value => emit('busy', value), { immediate: true })
async function refresh() {
  if (polling || disposed) return
  polling = true
  try { const value = await offlineAi.getState(); if (!disposed) { state.value = value; if (value.loaded && (value.backend === 'gpu' || value.backend === 'cpu')) backend.value = value.backend } }
  catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '读取离线模型状态失败，请重新打开。' }
  finally { polling = false }
}
async function act(action: () => Promise<void>) {
  if (busy.value) return
  pending.value = true; error.value = ''; notice.value = ''
  try { await action(); await refresh() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试。' }
  finally { pending.value = false }
}
async function stop() {
  try { await offlineAi.cancel(); notice.value = '正在停止，请等待当前任务退出…'; await refresh() }
  catch { error.value = '停止失败，请稍后再试。' }
}
function downloadModel() { return act(() => offlineAi.downloadModel()) }
function importModel() { return act(() => offlineAi.importModel()) }
function loadModel() { return act(() => offlineAi.loadModel({ backend: backend.value })) }
function unloadModel() { return act(() => offlineAi.unload()) }
function generate() { return act(() => offlineAi.generate({ prompt: prompt.value })) }
function useForMeals() { try { configureOfflineAssistant(true, backend.value); notice.value = '已选用本机文字记餐。回到首页点“AI记餐”，核对草稿后确认保存。' } catch { error.value = '选用失败，请重试。' } }
function remove() {
  if (window.confirm('删除此测试模型和未完成的下载？饮食记录不受影响。')) void act(() => offlineAi.deleteModel())
}
async function copyReport() {
  if (!state.value) return
  const s = state.value
  const report = [`食刻离线 AI 测试 · LiteRT-LM 0.18.1`, `设备：${s.device}`, `模型：${offlineModel.name}`, `计算方式：${s.backend || backend.value}`, `加载：${formatOfflineTime(s.loadMs)}`, `首段文字等待：${formatOfflineTime(s.firstTextMs)}`, `生成总耗时：${formatOfflineTime(s.responseMs)}`, `输出：${s.characters} 字符（不是 token）`, `系统当前可用内存：${formatOfflineBytes(s.availableMemoryBytes)}`, `状态：${status.value}`, ...(s.error ? [`错误：${s.error}`] : [])].join('\n')
  try { await navigator.clipboard.writeText(report); notice.value = '测试数据已复制，不包含问题、回答或饮食记录。' }
  catch { error.value = '无法复制，可截图保留下方测试数据。' }
}
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 500) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); emit('busy', false); if (!offlineAssistantEnabled()) void offlineAi.unload().catch(() => {}) })
</script>

<template>
  <article class="offline-ai-test" data-testid="offline-ai-test" :aria-busy="busy">
    <p class="offline-intro">模型保存在手机上，加载后可断网生成文字。可先测试，再选用于首页“AI记餐”；测试回答仅展示在这里。</p>
    <section class="offline-section">
      <h3>{{ offlineModel.name }}</h3>
      <p class="small-text">模型文件约 {{ formatOfflineBytes(offlineModel.bytes) }}，建议使用 Wi-Fi 下载。无需 API Key，下载完成不自动加载。</p>
      <div class="offline-actions">
        <button class="button primary" data-testid="offline-download" :disabled="busy || !state || state.ready" @click="downloadModel"><Download :size="17"/>{{ state?.ready ? '模型已保存' : state?.downloadedBytes ? '继续下载模型' : '下载模型' }}</button>
        <button class="button secondary" data-testid="offline-import" :disabled="busy || !state" @click="importModel"><FolderOpen :size="17"/>从文件导入</button>
      </div>
      <p v-if="state && !state.ready && state.downloadedBytes > 0 && !transferring" class="small-text">已下载 {{ formatOfflineBytes(state.downloadedBytes) }}，可继续下载。</p>
      <div v-if="transferring" class="offline-progress" role="status">
        <label for="offline-progress">{{ status }} · {{ progress.toFixed(1) }}%</label>
        <progress id="offline-progress" :value="progress" max="100"/>
        <span class="small-text">{{ formatOfflineBytes(state?.progressBytes ?? 0) }} / {{ formatOfflineBytes(offlineModel.bytes) }}</span>
      </div>
      <details class="settings-inline-details"><summary>下载失败或想手动导入？</summary>
        <p>可用浏览器下载下面指定版本的 .litertlm 文件，再点“从文件导入”。App 会复制到私有空间并校验大小和 SHA-256；导入时需额外留出约 1.6GB。网络无法访问模型站时，可以先把这个文件传到手机。</p>
        <a :href="offlineModel.url" target="_blank" rel="noopener noreferrer">下载指定模型文件</a><br/>
        <a :href="offlineModel.source" target="_blank" rel="noopener noreferrer">模型来源与 Apache-2.0 许可</a>
        <p class="offline-filename">{{ offlineModel.filename }}</p>
      </details>
    </section>
    <section class="offline-section">
      <div class="offline-backend"><label for="offline-backend">计算方式</label><select id="offline-backend" v-model="backend" data-testid="offline-backend" :disabled="busy || state?.loaded"><option value="gpu">GPU · 先试这一项</option><option value="cpu">CPU · 兼容性测试</option></select></div>
      <p class="small-text">GPU 加载失败时，手动选择 CPU 再试。切换前先释放模型；本轮不启用 NPU。</p>
      <div class="offline-actions">
        <button class="button primary" data-testid="offline-load" :disabled="busy || !state?.ready || state.loaded" @click="loadModel"><LoaderCircle v-if="state?.stage === 'loading'" :size="17" class="spin"/><Play v-else :size="17"/>{{ state?.stage === 'loading' ? '正在加载…' : '加载模型' }}</button>
        <button class="button secondary" data-testid="offline-unload" :disabled="busy || !state?.loaded" @click="unloadModel"><HardDrive :size="17"/>释放内存</button>
      </div>
    </section>
    <section class="offline-section">
      <label for="offline-prompt">测试问题</label>
      <textarea id="offline-prompt" v-model="prompt" data-testid="offline-prompt" rows="4" maxlength="600" :disabled="busy"/>
      <p class="small-text">每次独立提问，最多输出 256 token；长回答可能在长度限制处结束。不会写入饮食记录。</p>
      <div class="offline-actions">
        <button class="button primary" data-testid="offline-generate" :disabled="busy || !state?.loaded || !prompt.trim()" @click="generate"><LoaderCircle v-if="state?.stage === 'generating'" :size="17" class="spin"/><Play v-else :size="17"/>{{ state?.stage === 'generating' ? '正在生成…' : '生成回答' }}</button>
        <button v-if="canStop" class="button secondary" data-testid="offline-stop" @click="stop"><Square :size="16"/>停止</button>
      </div>
      <p class="offline-status" role="status" data-testid="offline-status">{{ status }}</p>
      <p v-if="error || state?.error" class="notice danger" role="alert" data-testid="offline-error">{{ error || state?.error }}</p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <div v-if="state?.text" class="offline-answer" data-testid="offline-answer">{{ state.text }}</div>
      <dl v-if="state" class="offline-metrics" data-testid="offline-metrics">
        <div><dt>加载耗时</dt><dd>{{ formatOfflineTime(state.loadMs) }}</dd></div>
        <div><dt>首段文字等待</dt><dd>{{ formatOfflineTime(state.firstTextMs) }}</dd></div>
        <div><dt>生成总耗时</dt><dd>{{ formatOfflineTime(state.responseMs) }}</dd></div>
        <div><dt>输出字符数</dt><dd>{{ state.characters }} 字符</dd></div>
      </dl>
      <p v-if="state" class="small-text">{{ state.device }} · 系统当前可用内存 {{ formatOfflineBytes(state.availableMemoryBytes) }} / 总内存 {{ formatOfflineBytes(state.totalMemoryBytes) }}。这不是模型自身的内存占用。</p>
      <p class="small-text">耗时来自手机原生计时；首段等待不含加载，总耗时包含处理问题和生成。页面每半秒刷新，切后台会停止生成并释放模型。</p>
      <div class="offline-actions">
        <button class="button primary" data-testid="offline-use-for-meals" :disabled="busy || !state?.ready" @click="useForMeals">用于文字记餐</button>
        <button class="button secondary" data-testid="offline-copy-report" :disabled="busy || !state" @click="copyReport"><Copy :size="16"/>复制测试数据</button>
        <button class="text-button" data-testid="offline-delete" :disabled="busy || !state || (!state.ready && !state.downloadedBytes)" @click="remove"><Trash2 :size="16"/>删除测试模型</button>
      </div>
    </section>
  </article>
</template>

<style scoped>
.offline-ai-test { display: grid; gap: 20px; }
.offline-intro { margin: 0; color: #667267; }
.offline-section { display: grid; gap: 12px; min-width: 0; }
.offline-section + .offline-section { border-top: 1px solid var(--border); padding-top: 20px; }
.offline-section h3, .offline-section p { margin: 0; }
.offline-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.offline-backend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.offline-backend select { flex: 1; min-width: 180px; }
.offline-section textarea { width: 100%; resize: vertical; font: inherit; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.offline-section textarea:focus-visible { outline: 2px solid var(--green); }
.offline-progress { display: grid; gap: 8px; }
.offline-progress progress { width: 100%; accent-color: var(--green); }
.offline-filename { overflow-wrap: anywhere; }
.offline-answer { white-space: pre-wrap; overflow-wrap: anywhere; padding: 14px; background: #f4f7f0; border-radius: 12px; }
.offline-metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; margin: 0; }
.offline-metrics dt { color: #667267; font-size: 13px; }
.offline-metrics dd { margin: 3px 0 0; font-variant-numeric: tabular-nums; }
.offline-status { font-weight: 600; }
</style>
