<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, Image, Camera, Zap, CircleHelp, Keyboard, RefreshCw, X, SwitchCamera } from '@lucide/vue'
import type { MealType } from '@shike/shared'
import { readBarcode } from '../lib/barcode'
import { cameraCrop, cameraFocusPoint, continuousFocus, pointFocus } from '../lib/camera'
import { NativeCameraSession, nativeCameraAvailable, type PreviewBounds } from '../lib/native-camera'
import ModelPicker from './ModelPicker.vue'
import { useBackLayer } from '../lib/use-back-layer'

export type CaptureKind = 'food' | 'label' | 'barcode'
const props = defineProps<{ mealType: MealType }>()
const emit = defineEmits<{ close: []; capture: [file: File, kind: 'food' | 'label', meal: MealType]; barcode: [value: string, meal: MealType]; skip: [meal: MealType, kind: CaptureKind] }>()
const kind = ref<CaptureKind>('food'), meal = ref(props.mealType), video = ref<HTMLVideoElement | null>(null)
const gallery = ref<HTMLInputElement | null>(null), systemCamera = ref<HTMLInputElement | null>(null)
const error = ref(''), starting = ref(false), ready = ref(false), busy = ref(false), capturing = ref(false), switching = ref(false), help = ref(false), paused = ref(false), torch = ref(false), hasTorch = ref(false)
const cameras = ref<Array<{ deviceId: string; label: string }>>([]), activeDevice = ref(''), resolution = ref(''), autofocus = ref(false)
const preview = ref<HTMLElement | null>(null), native = ref(false), cameraName = ref(''), focusing = ref(false)
const controls = ref<HTMLElement | null>(null), controlsHeight = ref(260)
const focusRing = ref<{ x: number; y: number } | null>(null), focusMessage = ref('')
const nativeSession = new NativeCameraSession()
useBackLayer(() => true, () => { if (help.value) help.value = false; else close() })
const mealTypes = [{ value: 'breakfast', label: '早餐', symbol: '☕' }, { value: 'lunch', label: '午餐', symbol: '🍚' }, { value: 'dinner', label: '晚餐', symbol: '🍲' }, { value: 'snack', label: '加餐', symbol: '🍎' }] as const
const modes = [{ value: 'food', label: '食物拍照' }, { value: 'label', label: '营养表' }, { value: 'barcode', label: '条码' }] as const
const tip = computed(() => kind.value === 'food' ? '让整份食物清晰地出现在框内' : kind.value === 'label' ? '对准营养成分表，拍清单位和数字' : '让条码横向、完整地出现在框内')
let stream: MediaStream | null = null, generation = 0, oldOverflow = '', resizeObserver: ResizeObserver | null = null
let focusTimer: ReturnType<typeof setTimeout> | undefined, lastBounds = '', resizeFrame = 0
function stop() {
  generation++; stream?.getTracks().forEach(track => track.stop()); stream = null
  if (video.value) video.value.srcObject = null
  ready.value = false; starting.value = false; torch.value = false; hasTorch.value = false; native.value = false; focusing.value = false
  focusRing.value = null; focusMessage.value = ''; clearTimeout(focusTimer)
  document.documentElement.classList.remove('camera-native-active')
  return nativeSession.stop().catch(() => {})
}
function bounds(): PreviewBounds {
  const rect = preview.value!.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}
function resizeNative() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    if (!native.value || !ready.value || !preview.value) return
    const next = bounds(), key = JSON.stringify(next)
    if (key !== lastBounds) { lastBounds = key; void nativeSession.resize(next).catch(() => { focusMessage.value = '画面调整中，可重新打开相机。' }) }
  })
}
function layoutChanged() {
  if (controls.value) controlsHeight.value = controls.value.getBoundingClientRect().height
  resizeNative()
}
async function start(deviceId?: string) {
  const stopped = stop(); const current = generation; error.value = ''; paused.value = false; starting.value = true
  try {
    await stopped
    if (current !== generation) return
    if (nativeCameraAvailable()) {
      native.value = true; document.documentElement.classList.add('camera-native-active'); await nextTick()
      if (current !== generation || !preview.value) return
      const area = bounds(); lastBounds = JSON.stringify(area)
      const info = await nativeSession.start(area, deviceId)
      if (current !== generation || document.hidden) { if (current === generation) void stop(); return }
      cameras.value = info.devices; activeDevice.value = info.deviceId; cameraName.value = info.label
      resolution.value = `原生CameraX · ${info.zoom === null ? '设备默认视角' : `${Number(info.zoom.toFixed(2))}×`} · 拍照目标最长边3264px（设备决定实际尺寸）`
      autofocus.value = false; ready.value = true
      const flash = await nativeSession.flashAvailable().catch(() => false)
      if (current === generation) { hasTorch.value = flash; void nativeSession.focus(.5, .5).catch(() => {}) }
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器地址无法打开实时相机。请使用下方系统相机，或在APK内拍摄。')
    // 只申请视频权限，不采集音频；优先后摄，照片仅在内存中交给识别流程。
    // 请求高清原生视频，ideal不会排除只支持较低画质的设备；实际尺寸以视频元数据为准。
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 24, max: 30 } } })
    if (current !== generation || document.hidden) { media.getTracks().forEach(track => track.stop()); return }
    stream = media; await nextTick()
    if (!video.value) { stop(); return }
    video.value.srcObject = media; await video.value.play()
    if (current !== generation) return
    ready.value = true
    const track = media.getVideoTracks()[0]!
    let capabilities: (MediaTrackCapabilities & { torch?: boolean }) | undefined
    try { capabilities = track.getCapabilities?.() } catch { /* 老浏览器没有能力查询时仍保留拍摄。 */ }
    hasTorch.value = capabilities?.torch === true
    resolution.value = `${video.value.videoWidth} × ${video.value.videoHeight}`
    activeDevice.value = track.getSettings().deviceId ?? ''
    void navigator.mediaDevices.enumerateDevices?.().then(devices => { if (current === generation) cameras.value = devices.filter(device => device.kind === 'videoinput') }).catch(() => {})
    autofocus.value = await continuousFocus(track)
  } catch (cause) {
    if (current !== generation) return
    stop()
    const name = cause instanceof Error ? cause.name : ''
    error.value = name === 'NotAllowedError' ? '相机权限未开启。请在系统设置中允许食刻使用相机，或选择相册照片。' : name === 'NotFoundError' ? '没有找到可用的相机，请选择相册照片。' : name === 'NotReadableError' ? '相机正被其他应用占用，请关闭后重试。' : cause instanceof Error ? cause.message : '相机暂时无法打开，请重试或选照片。'
  } finally { if (current === generation) starting.value = false }
}
function switchCamera() { const next = cameras.value[(cameras.value.findIndex(camera => camera.deviceId === activeDevice.value) + 1) % cameras.value.length]; if (next) void start(next.deviceId) }
async function toggleTorch() {
  if (native.value) {
    try { await nativeSession.flash(!torch.value); torch.value = !torch.value } catch { error.value = '这台设备暂时不能控制补光灯。' }
    return
  }
  const track = stream?.getVideoTracks()[0]; if (!track || !hasTorch.value) return
  try { await track.applyConstraints({ advanced: [{ torch: !torch.value } as MediaTrackConstraintSet] }); torch.value = !torch.value }
  catch { error.value = '这台设备暂时不能控制补光灯。' }
}
async function accept(file: File) {
  if (busy.value || switching.value) return
  const current = generation, capturedKind = kind.value, capturedMeal = meal.value
  busy.value = true; error.value = ''
  try {
    const value = capturedKind === 'barcode' ? await readBarcode(file) : null
    if (current !== generation) return
    const releasing = stop(), releaseGeneration = generation
    await releasing
    // 关闭／卸载也会停止相机。原生释放或读码晚到时，不能重新打开已取消的编辑页。
    if (releaseGeneration !== generation) return
    if (capturedKind === 'barcode') emit('barcode', value!, capturedMeal)
    else emit('capture', file, capturedKind, capturedMeal)
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : '照片读取失败，请重试。' }
  finally { busy.value = false }
}
async function takePhoto() {
  if (!ready.value || busy.value || capturing.value || switching.value) return
  const current = generation
  if (native.value) {
    capturing.value = true; error.value = ''
    try { const file = await nativeSession.capture(); if (current === generation) await accept(file) }
    catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : '拍摄失败，请重试或使用系统相机。' }
    finally { capturing.value = false }
    return
  }
  if (!video.value) return
  const source = video.value, width = source.videoWidth, height = source.videoHeight
  if (!width || !height) { error.value = '相机还未准备好，请稍后再拍。'; return }
  // 按屏幕实际看到的cover区域拍摄，避免预览铺满后，照片却包含屏幕外的内容。
  const rect = source.getBoundingClientRect(), crop = cameraCrop(width, height, rect.width, rect.height)
  const ratio = Math.min(1, 1920 / Math.max(crop.width, crop.height)), canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(crop.width * ratio)); canvas.height = Math.max(1, Math.round(crop.height * ratio))
  const context = canvas.getContext('2d'); if (!context) return
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
  capturing.value = true
  try {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (current !== generation) return
    if (blob) await accept(new File([blob], 'shike-capture.jpg', { type: 'image/jpeg' }))
    else error.value = '拍摄失败，请重试。'
  } finally { capturing.value = false }
}
function fromFile(event: Event) { const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (file) void accept(file) }
async function focusAt(event: PointerEvent) {
  if (!ready.value || busy.value || capturing.value || focusing.value || !preview.value || (event.target as HTMLElement).closest('button,select,.capture-help')) return
  const current = generation, area = preview.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (event.clientX - area.left) / area.width)), y = Math.max(0, Math.min(1, (event.clientY - area.top) / area.height))
  focusRing.value = { x: x * 100, y: y * 100 }; focusing.value = true; focusMessage.value = '已请求对焦，请等文字清楚后拍摄'
  try {
    const track = stream?.getVideoTracks()[0], source = video.value
    const accepted = native.value ? await nativeSession.focus(x, y) : !!track && !!source && await pointFocus(track, cameraFocusPoint(source.videoWidth, source.videoHeight, area.width, area.height, x, y))
    if (current === generation && !accepted) focusMessage.value = '当前相机未开放点按对焦，可使用系统相机'
  } catch { if (current === generation) focusMessage.value = '对焦请求未完成，可重试或使用系统相机' }
  finally {
    if (current === generation) { focusing.value = false; clearTimeout(focusTimer); focusTimer = setTimeout(() => { focusRing.value = null; focusMessage.value = '' }, 1800) }
  }
}
async function openSystemCamera() { await stop(); paused.value = true; starting.value = false; systemCamera.value?.click() }
function visibility() { if (document.hidden) { stop(); paused.value = true; starting.value = false } }
function skip() { stop(); emit('skip', meal.value, kind.value) }
function close() { stop(); emit('close') }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { if (help.value) help.value = false; else close(); return }
  if (event.key !== 'Tab') return
  const controls = [...document.querySelectorAll<HTMLElement>('.capture-camera button:not(:disabled), .capture-camera select:not(:disabled)')].filter(element => element.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => { oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.addEventListener('visibilitychange', visibility); resizeObserver = new ResizeObserver(layoutChanged); if (preview.value) resizeObserver.observe(preview.value); if (controls.value) resizeObserver.observe(controls.value); layoutChanged(); void start(); document.querySelector<HTMLButtonElement>('[data-testid="close-camera"]')?.focus() })
onBeforeUnmount(() => { void stop(); resizeObserver?.disconnect(); cancelAnimationFrame(resizeFrame); document.body.style.overflow = oldOverflow; document.removeEventListener('visibilitychange', visibility) })
</script>
<template>
  <Teleport to="body">
    <section class="capture-camera" :style="{ '--capture-controls-height': `${controlsHeight}px` }" role="dialog" aria-modal="true" aria-label="拍照记录" data-testid="capture-camera" @keydown="keydown">
      <header class="capture-header"><button class="capture-icon" aria-label="关闭相机" data-testid="close-camera" @click="close"><ArrowLeft :size="25" /></button><span>拍照记录</span><div><button v-if="cameras.length > 1" class="capture-icon" aria-label="切换摄像头" :disabled="starting || busy || capturing" data-testid="switch-camera" @click="switchCamera"><SwitchCamera :size="21" /></button><button v-if="hasTorch" class="capture-icon" :aria-pressed="torch" aria-label="补光灯" @click="toggleTorch"><Zap :size="21" /></button><button type="button" class="capture-icon capture-system-camera" :disabled="busy || capturing" aria-label="打开系统相机" data-testid="system-camera" @click="openSystemCamera"><Camera :size="19" /><small>系统</small></button><button class="capture-icon" aria-label="拍摄帮助" @click="help = !help"><CircleHelp :size="23" /></button></div></header>
      <div ref="preview" class="capture-preview" :class="{ 'barcode-frame': kind === 'barcode', 'native-preview': native }" :data-camera-engine="native ? 'native' : 'web'" @pointerup="focusAt">
        <video v-show="!native" ref="video" autoplay playsinline muted aria-label="实时相机画面" data-testid="camera-preview" />
        <span v-if="focusRing" class="capture-focus-ring" data-testid="camera-focus-ring" :style="{ left: `${focusRing.x}%`, top: `${focusRing.y}%` }" aria-hidden="true"></span>
        <p v-if="ready" class="capture-focus-hint" role="status" data-testid="camera-focus-status">{{ focusMessage || '点击画面中的文字／食物对焦' }}</p>
        <div v-if="ready" class="capture-guide" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <p v-if="ready" class="capture-tip">{{ tip }}</p>
        <div v-if="!ready || error" class="capture-feedback" role="status"><Camera v-if="!error" :size="32" /><p>{{ error || (starting ? '正在打开相机…' : paused ? '已暂停相机' : '准备拍摄') }}</p><button v-if="!starting && !ready" class="capture-pill" data-testid="camera-retry" @click="start()"><RefreshCw :size="15" />{{ paused ? '继续拍摄' : '重试相机' }}</button><button v-if="!starting && !ready" class="capture-pill" data-testid="system-camera-fallback" @click="openSystemCamera">打开系统相机</button></div>
        <div v-if="help" class="capture-help"><button class="capture-icon" aria-label="关闭帮助" @click="help = false"><X :size="19" /></button><h3>拍得清楚，记录更准</h3><p v-if="ready">当前相机：{{ resolution }}{{ autofocus ? ' · 已启用连续对焦' : '' }}。{{ native ? `镜头：${cameraName}。采用原生照片输出，点按文字请求对焦后，等画面清楚再拍。` : '设备和浏览器决定实际画质。' }}如仍模糊，可直接点击下方系统相机作对照。</p><p>食物：拍全餐盘，减少遮挡，重量仍需核对。</p><p>营养表：保持适当距离，待文字清晰后再拍；对准每100g／mL或每份的单位。净含量不等于摄入量。</p><p>条码：拍摄后在设备本地读码，再查询商品；条码照片不上传AI。</p><p>食物与营养表照片点击拍摄后会交给你选定的模型。确认保存餐次后，压缩照片会一并保留在本机，可从饮食记录查看。</p></div>
      </div>
      <footer ref="controls" class="capture-controls">
        <div class="capture-meals" role="group" aria-label="餐次"><button v-for="item in mealTypes" :key="item.value" :aria-pressed="meal === item.value" :class="{ active: meal === item.value }" :data-testid="`camera-meal-${item.value}`" @click="meal = item.value"><span>{{ item.symbol }}</span>{{ item.label }}</button></div>
        <div class="capture-modes" role="group" aria-label="拍摄类型"><button v-for="item in modes" :key="item.value" :aria-pressed="kind === item.value" :class="{ active: kind === item.value }" :disabled="busy || capturing" :data-testid="`camera-mode-${item.value}`" @click="kind = item.value; if (ready) error = ''">{{ item.label }}</button></div>
        <ModelPicker v-show="kind !== 'barcode'" compact :busy="busy || capturing" @switching="switching = $event" />
        <p v-if="kind === 'barcode'" class="capture-private">本地读码 · 不调用AI</p>
        <div class="capture-actions"><button class="capture-gallery" :disabled="busy || capturing || switching" data-testid="camera-gallery" @click="gallery?.click()"><Image :size="25" /><span>相册</span></button><button class="capture-shutter" aria-label="拍摄照片" data-testid="camera-shutter" :disabled="!ready || busy || capturing || switching" @click="takePhoto"><span></span></button><button class="capture-gallery" :disabled="busy" data-testid="camera-skip" @click="skip"><Keyboard :size="25" /><span>{{ kind === 'barcode' ? '输入条码' : '手动记录' }}</span></button></div>
        <p class="capture-disclosure">{{ busy ? '正在读取条码…' : kind === 'barcode' ? '拍清条码后查询，未收录可改拍营养表' : '拍摄后识别 · 结果可修改' }}</p>
      </footer>
      <input ref="gallery" class="sr-only" tabindex="-1" type="file" accept="image/jpeg,image/png,image/webp" data-testid="gallery-input" @change="fromFile" />
      <input ref="systemCamera" class="sr-only" tabindex="-1" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-testid="system-camera-input" @change="fromFile" />
    </section>
  </Teleport>
</template>
