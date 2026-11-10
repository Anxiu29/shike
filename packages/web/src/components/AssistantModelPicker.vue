<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { LoaderCircle } from '@lucide/vue'
import ModelPicker from './ModelPicker.vue'
import { offlineAi, offlineAiSupported, offlineAssistantEnabled, offlineAssistantBackend, configureOfflineAssistant, type OfflineAiState } from '../lib/offline-ai'
const props = defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ switching: [value: boolean]; offline: [value: boolean] }>()
const supported = offlineAiSupported(), selected = ref(offlineAssistantEnabled()), backend = ref(offlineAssistantBackend())
const pending = ref(false), error = ref(''), note = ref(''), state = ref<OfflineAiState | null>(null)
let disposed = false
async function prepare() {
  if (props.busy || pending.value || !selected.value) return
  pending.value = true; emit('switching', true); error.value = ''; note.value = '正在准备本机模型，首次可能需要较久…'
  try {
    state.value = await offlineAi.getState()
    if (!state.value.ready) throw new Error('请先到设置 → 手机离线 AI 下载或导入模型，已有下载无需重复下载。')
    await offlineAi.prepareAssistant({ backend: backend.value })
    if (!disposed) { state.value = await offlineAi.getState(); note.value = '本机模型已准备，可以离线文字记餐。' }
  } catch (cause) { if (!disposed) { note.value = ''; error.value = cause instanceof Error ? cause.message : '本机模型准备失败，请到设置检查。' } }
  finally { pending.value = false; emit('switching', false) }
}
async function changeRoute(event: Event) {
  if (props.busy || pending.value) return
  const enabled = (event.target as HTMLSelectElement).value === 'offline'
  pending.value = true; emit('switching', true)
  try {
    configureOfflineAssistant(enabled, backend.value); selected.value = enabled; emit('offline', enabled); error.value = ''; note.value = ''
    if (enabled) note.value = '已选择本机离线，请点击“准备模型”后发送。'
    else { const current = await offlineAi.getState(); if (current.loaded && !current.busy) await offlineAi.unload() }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '切换未成功，请重试。' }
  finally { pending.value = false; emit('switching', false) }
}
function changeBackend() {
  if (props.busy || pending.value) return
  configureOfflineAssistant(true, backend.value)
  error.value = ''; note.value = '运行方式已更改，请点击“准备模型”后发送。'
}
// 打开面板只显示选择，不因进入页面消耗内存或触发GPU编译。
onMounted(() => { emit('offline', selected.value) })
onBeforeUnmount(() => { disposed = true; if (pending.value) void offlineAi.cancel().catch(() => {}); emit('switching', false) })
</script>
<template>
  <div v-if="supported" class="assistant-route-picker">
    <label>文字记餐方式<select :value="selected ? 'offline' : 'online'" :disabled="busy || pending" data-testid="assistant-ai-route" @change="changeRoute"><option value="online">在线模型</option><option value="offline">本机离线 · Qwen2.5-1.5B（文字）</option></select></label>
    <template v-if="selected">
      <div class="assistant-offline-controls"><label>运行方式<select v-model="backend" :disabled="busy || pending" data-testid="assistant-offline-backend" @change="changeBackend"><option value="gpu">GPU</option><option value="cpu">CPU</option></select></label><button type="button" class="button secondary compact" :disabled="busy || pending" data-testid="assistant-offline-prepare" @click="prepare"><LoaderCircle v-if="pending" :size="15" class="spin"/>{{ pending ? '正在准备…' : '准备模型' }}</button></div>
      <p class="tiny muted">点击“准备模型”后发送文字；打开助手或切换运行方式不会自动加载。描述在手机处理，份量需核对后保存。</p>
      <p v-if="note" class="tiny muted" role="status" data-testid="assistant-offline-ready">{{ note }}</p>
      <p v-if="error" class="notice danger" role="alert" data-testid="assistant-offline-model-error">{{ error }}</p>
    </template>
  </div>
  <ModelPicker v-if="!selected" :busy="busy || pending" compact label="助手模型" @switching="emit('switching', $event)"/>
</template>
<style scoped>
.assistant-route-picker { display: grid; gap: 10px; margin-bottom: 14px; }
.assistant-offline-controls { display: flex; gap: 12px; align-items: end; }
.assistant-offline-controls label { flex: 1; }
</style>
