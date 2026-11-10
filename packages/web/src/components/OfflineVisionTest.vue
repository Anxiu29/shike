<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download, FolderOpen, Camera, ImagePlus, Play, Square, Trash2, Copy, LoaderCircle } from '@lucide/vue'
import { offlineVision, offlineVisionModel as model, offlineVisionImage } from '../lib/offline-vision'
import { formatOfflineBytes, formatOfflineTime, type OfflineAiState } from '../lib/offline-ai'
import { takeSystemPhoto } from '../lib/system-photo'
import { configureOfflinePhoto, offlinePhotoEnabled } from '../lib/offline-photo'
const emit = defineEmits<{ busy: [value: boolean] }>()
const state = ref<OfflineAiState | null>(null), pending = ref(false), error = ref(''), notice = ref('')
const enabled = ref(offlinePhotoEnabled())
const image = ref(''), preview = ref(''), hasRun = ref(false), gallery = ref<HTMLInputElement | null>(null)
const prompt = ref('请只列照片中能确认的主要食物，最多6项，每种只写一次。数量看不清写不确定，不猜重量和热量，不列看不出的调料；列完结束。')
const busy = computed(() => pending.value || !!state.value?.busy)
const transferring = computed(() => ['downloading', 'verifying', 'importing'].includes(state.value?.stage ?? ''))
const stages: Record<string, string> = { idle: '请下载视觉模型', ready: '模型已保存', downloading: '正在下载', verifying: '正在校验文件', importing: '正在导入', loading: '正在加载CPU视觉模型', generating: '正在手机本地识图', completed: '本次生成结束，请核对识别内容', limited: '检测到异常输出，已停止', error: '本次操作未完成', stopped: '已停止', releasing: '正在释放模型', deleting: '正在删除视觉模型' }
const status = computed(() => state.value ? stages[state.value.stage] ?? '等候操作' : '正在读取手机状态')
const showOutput = computed(() => hasRun.value && ['generating', 'completed', 'limited', 'stopped'].includes(state.value?.stage ?? ''))
let disposed = false, polling = false, timer: ReturnType<typeof setInterval> | undefined
watch(busy, value => emit('busy', value), { immediate: true })
async function refresh() {
  if (disposed || polling) return
  polling = true
  try { const value = await offlineVision.getState(); if (!disposed) state.value = value }
  catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '读取模型状态失败。' }
  finally { polling = false }
}
async function act(action: () => Promise<void>) {
  if (busy.value) return
  pending.value = true; error.value = ''; notice.value = ''
  try { await action(); await refresh() } catch (cause) { error.value = cause instanceof Error ? cause.message : '本机操作失败，请重试。' }
  finally { pending.value = false }
}
async function select(file: File) {
  const next = await offlineVisionImage(file)
  if (!disposed) { image.value = next.base64; preview.value = next.preview; hasRun.value = false }
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (file) void act(() => select(file))
}
function photo() { return act(async () => { const file = await takeSystemPhoto(); if (file) await select(file) }) }
function download() { return act(() => offlineVision.downloadModel()) }
function importModel() { return act(() => offlineVision.importModel()) }
function changeUsage() {
  try { configureOfflinePhoto(!enabled.value); enabled.value = !enabled.value; notice.value = enabled.value ? '拍照记餐已切到本机离线，下次点击记录生效。' : '拍照记餐已切回在线方式，需你已配置的在线模型。' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '设置未保存。' }
}
function generate() { return act(async () => { hasRun.value = true; await offlineVision.generateImage({ imageBase64: image.value, prompt: prompt.value.trim() }) }) }
async function stop() { try { await offlineVision.cancel(); notice.value = '正在停止，请等待模型退出…'; await refresh() } catch { error.value = '停止请求未完成，请稍后再试。' } }
function remove() { if (window.confirm('仅删除视觉测试模型和未完成下载？原文字模型与饮食记录保留。')) void act(() => offlineVision.deleteModel()) }
async function copy() {
  const s = state.value; if (!s) return
  const structured = ['food_estimate', 'package_label'].includes(s.task ?? '')
  const report = [`食刻离线识图测试 · LiteRT-LM 0.18.1`, `设备：${s.device}`, `模型：${model.name}`, '计算：文字CPU / 图像CPU · 每次新建引擎', `任务：${({ food_estimate: '名称与估重（试验）', package_label: '营养表识读（试验）', names: '仅名称', test: '自由识图测试' } as Record<string, string>)[s.task ?? 'test'] ?? s.task}`, structured ? `解码：受约束JSON / 最多${s.maxOutputTokens || 512}token` : `解码：重复惩罚1.15 / 频次惩罚0.15 / 最多${s.maxOutputTokens || 128}token`, '输入：单张512×512照片', `加载：${formatOfflineTime(s.loadMs)}`, `首段文字等待：${formatOfflineTime(s.firstTextMs)}`, `识图生成：${formatOfflineTime(s.responseMs)}`, `输出：${s.characters} 字符（不是token）`, `系统当前可用内存：${formatOfflineBytes(s.availableMemoryBytes)}`, `状态：${status.value}`, `停止原因：${s.stopReason || '无主动截停'}`, ...(s.error ? [`提示：${s.error}`] : [])].join('\n')
  try { await navigator.clipboard.writeText(report); notice.value = '测试数据已复制，不含照片、问题或回答。' } catch { error.value = '复制失败，可记录下方数据。' }
}
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 500) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); emit('busy', false); image.value = ''; preview.value = ''; void offlineVision.cancel().then(() => offlineVision.unload()).catch(() => {}) })
</script>
<template>
  <article class="vision-test" data-testid="offline-vision-test" :aria-busy="busy">
    <p>在这里测试本机识图，也可用于拍照记餐。拍照记餐可试估重和读取营养表，核对后才保存；下方自由测试回答不自动加入记录。</p>
    <section><h3>拍照记餐</h3><p class="small-text">开启后，点击首页“记录”或选择照片会使用本机模型，无需Key。食物照片默认试估重量，也可选择“仅名称”；拍摄内容选“营养表”时试读标签原值，实际摄入量由你填写。失败保留草稿，不自动转在线。</p><button type="button" class="button secondary" :disabled="busy || !state || (!enabled && !state.ready)" :aria-pressed="enabled" data-testid="vision-use-for-meals" @click="changeUsage">{{ enabled ? '已用于拍照记餐 · 点击关闭' : '用于拍照记餐' }}</button></section>
    <section><h3>{{ model.name }}</h3><p class="small-text">需单独下载约 {{ formatOfflineBytes(model.bytes) }}，原文字模型保留。下载后可断网识图，无需API Key。</p>
      <div class="vision-actions"><button class="button primary" :disabled="busy || !state || state.ready" data-testid="vision-download" @click="download"><Download :size="17"/>{{ state?.ready ? '视觉模型已保存' : state?.downloadedBytes ? '继续下载视觉模型' : '下载视觉模型' }}</button><button class="button secondary" :disabled="busy || !state" data-testid="vision-import" @click="importModel"><FolderOpen :size="17"/>从文件导入</button></div>
      <div v-if="transferring" role="status"><p>{{ status }} · {{ formatOfflineBytes(state?.progressBytes ?? 0) }} / {{ formatOfflineBytes(model.bytes) }}</p><progress :value="state?.progressBytes ?? 0" :max="model.bytes" /></div>
      <details class="settings-inline-details"><summary>下载失败或想手动导入？</summary><p>下载指定文件后导入，大小和SHA-256通过才保存。导入会复制一份，需另留约1.30GB。</p><a :href="model.url" target="_blank" rel="noopener noreferrer">下载指定视觉模型</a><p class="vision-filename">{{ model.filename }}</p><a :href="model.source" target="_blank" rel="noopener noreferrer">模型来源、限制与Apache-2.0许可</a></details>
    </section>
    <section><h3>选择一张食物照片</h3><input ref="gallery" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-testid="vision-image-input" @change="choose"/>
      <div class="vision-actions"><button class="button secondary" :disabled="busy" data-testid="vision-choose" @click="gallery?.click()"><ImagePlus :size="17"/>选照片</button><button class="button secondary" :disabled="busy" data-testid="vision-photo" @click="photo"><Camera :size="17"/>系统相机拍照</button></div>
      <img v-if="preview" :src="preview" alt="本次离线识图照片" class="vision-preview" data-testid="vision-preview"/>
      <p class="small-text">仅处理这一张照片，等比例缩小并补白至512×512；保留整张图，但小字和细节可能丢失。</p>
      <label>想观察什么？<textarea v-model="prompt" rows="3" maxlength="400" :disabled="busy" data-testid="vision-prompt"/></label>
      <p class="small-text">本轮自由测试固定使用CPU，每次识图后释放引擎。仅试主要食物，最多6项；清单过长或循环重复会停止并警告，保留停止前原文。估重和营养表识读请在拍照记餐里测试，所有结果都需核对。</p>
      <div class="vision-actions"><button class="button primary" :disabled="busy || !state?.ready || !image || !prompt.trim()" data-testid="vision-generate" @click="generate"><LoaderCircle v-if="busy" :size="17" class="spin"/><Play v-else :size="17"/>开始离线识图</button><button v-if="state?.busy" class="button secondary" data-testid="vision-stop" @click="stop"><Square :size="16"/>停止</button></div>
      <p role="status" data-testid="vision-status">{{ status }}</p><p v-if="error || state?.error" class="notice danger" role="alert" data-testid="vision-error">{{ error || state?.error }}</p><p v-if="notice" class="notice">{{ notice }}</p>
      <p v-if="state?.stage === 'limited'" class="small-text">停止前的原始输出（未去重，未修补）：</p><div v-if="showOutput && state?.text" class="vision-answer" data-testid="vision-answer">{{ state.text }}</div>
      <dl v-if="state" class="vision-metrics"><div><dt>加载</dt><dd>{{ formatOfflineTime(state.loadMs) }}</dd></div><div><dt>首段等待</dt><dd>{{ formatOfflineTime(state.firstTextMs) }}</dd></div><div><dt>识图生成</dt><dd>{{ formatOfflineTime(state.responseMs) }}</dd></div><div><dt>输出字符数</dt><dd>{{ state.characters }}</dd></div></dl>
      <p v-if="state" class="small-text">{{ state.device }} · 系统当前可用内存 {{ formatOfflineBytes(state.availableMemoryBytes) }}，不是模型峰值内存。加载后开始计首段等待；生成耗时包含图片和问题处理。后台/锁屏会停止生成。</p>
      <div class="vision-actions"><button class="button secondary" :disabled="busy || !state" data-testid="vision-copy" @click="copy"><Copy :size="17"/>复制测试数据</button><button class="text-button" :disabled="busy || !state || (!state.ready && !state.downloadedBytes)" data-testid="vision-delete" @click="remove"><Trash2 :size="17"/>删除视觉模型</button></div>
    </section>
  </article>
</template>
<style scoped>
.vision-test, .vision-test section { display: grid; gap: 14px; min-width: 0; }
.vision-test section + section { border-top: 1px solid var(--border); padding-top: 20px; }
.vision-test p, .vision-test h3 { margin: 0; }
.vision-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.vision-preview { display: block; width: min(100%, 300px); aspect-ratio: 1; object-fit: contain; border-radius: 12px; }
.vision-test textarea { display: block; width: 100%; resize: vertical; }
.vision-test progress { width: 100%; accent-color: var(--green); }
.vision-answer { white-space: pre-wrap; overflow-wrap: anywhere; padding: 14px; background: #f4f7f0; border-radius: 12px; }
.vision-filename { overflow-wrap: anywhere; }
.vision-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0; }
.vision-metrics dt { font-size: 13px; color: #667267; }
.vision-metrics dd { margin: 3px 0 0; }
</style>
