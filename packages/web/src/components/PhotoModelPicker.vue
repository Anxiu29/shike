<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ModelPicker from './ModelPicker.vue'
import { offlineVision, offlineVisionSupported } from '../lib/offline-vision'
import { configureOfflinePhoto, offlinePhotoEnabled, offlinePhotoEstimates } from '../lib/offline-photo'
const props = defineProps<{ busy?: boolean; compact?: boolean; collapsible?: boolean; kind?: 'food' | 'label' }>()
const emit = defineEmits<{ switching: [value: boolean]; mode: [value: 'live' | 'mock']; offline: [value: boolean] }>()
const supported = offlineVisionSupported(), selected = ref(offlinePhotoEnabled()), error = ref(''), ready = ref(false), pending = ref(false)
const estimates = ref(offlinePhotoEstimates())
function changeDetails(event: Event) {
  try { const next = (event.target as HTMLSelectElement).value === 'estimate'; configureOfflinePhoto(selected.value, next); estimates.value = next }
  catch { error.value = '设置未保存，请重试。' }
}
async function check() {
  try { ready.value = (await offlineVision.getState()).ready } catch { ready.value = false }
}
async function change(event: Event) {
  if (props.busy || pending.value) return
  pending.value = true; emit('switching', true); error.value = ''
  try {
    const enabled = (event.target as HTMLSelectElement).value === 'offline'
    configureOfflinePhoto(enabled); selected.value = enabled; emit('offline', enabled)
    if (enabled) { emit('mode', 'live'); await check() }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '切换未成功，原设置保留。' }
  finally { pending.value = false; emit('switching', false) }
}
onMounted(() => { emit('offline', selected.value); if (selected.value) { emit('mode', 'live'); void check() } })
</script>
<template>
  <div v-if="supported" class="photo-route-picker" data-testid="photo-route-picker">
    <label>照片识别方式<select :value="selected ? 'offline' : 'online'" :disabled="busy || pending" data-testid="photo-ai-route" @change="change"><option value="online">在线模型</option><option value="offline">本机离线 · Qwen3.5-0.8B</option></select></label>
    <label v-if="selected && kind !== 'label'">本机识图内容<select :value="estimates ? 'estimate' : 'names'" :disabled="busy || pending" data-testid="photo-offline-detail" @change="changeDetails"><option value="estimate">名称与估重（试验）</option><option value="names">仅名称 · 手动填份量</option></select></label>
    <p v-if="selected" class="tiny muted" data-testid="photo-offline-note">{{ kind === 'label' ? '本机营养表识读（试验）：保留原数值与单位，请贴近拍清同一列；读不清留空，核对后填写实际摄入量。' : estimates ? '本机照片估重（试验），营养匹配本地食物库。克数可能偏差较大，请核对后保存。' : '照片留在手机。只识别名称并匹配本地食物库，份量需你填写；失败不转在线。' }} 失败保留草稿，不自动转在线。</p>
    <p v-if="selected && !ready" class="tiny amber-text">模型状态待确认；未下载时请到设置 → 离线识图下载或导入。</p>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
  </div>
  <ModelPicker v-if="!selected" :compact="compact" :collapsible="collapsible" :busy="busy || pending" @switching="emit('switching', $event)" @mode="emit('mode', $event)" />
</template>
<style scoped>.photo-route-picker { display: grid; gap: 8px; margin-bottom: 14px; }.photo-route-picker label { display: grid; gap: 6px; }.photo-route-picker p { margin: 0; }</style>
