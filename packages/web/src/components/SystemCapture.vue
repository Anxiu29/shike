<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, ImagePlus, Keyboard, LoaderCircle } from '@lucide/vue'
import type { MealType } from '@shike/shared'
import AppSheet from './AppSheet.vue'
import PhotoModelPicker from './PhotoModelPicker.vue'
import { takeSystemPhoto } from '../lib/system-photo'
import { readBarcode } from '../lib/barcode'
import { validateOriginal } from '../lib/image'
const props = defineProps<{ mealType: MealType }>()
const emit = defineEmits<{ close: []; capture: [file: File, kind: 'food' | 'label', meal: MealType]; barcode: [value: string, meal: MealType]; skip: [meal: MealType, kind: string] }>()
const meal = ref(props.mealType), kind = ref<'food' | 'label' | 'barcode'>('food'), busy = ref(false), switching = ref(false), error = ref('')
const gallery = ref<HTMLInputElement | null>(null)
let alive = true
onBeforeUnmount(() => { alive = false })
async function accept(file: File) {
  validateOriginal(file)
  const selectedKind = kind.value, selectedMeal = meal.value
  if (selectedKind === 'barcode') {
    const value = await readBarcode(file)
    if (alive) emit('barcode', value, selectedMeal)
  } else if (alive) emit('capture', file, selectedKind, selectedMeal)
}
async function takePhoto(opening = false) {
  if (busy.value || (!opening && switching.value)) return
  busy.value = true; error.value = ''
  try { const file = await takeSystemPhoto(); if (file && alive) await accept(file) }
  catch (cause) { if (alive) error.value = cause instanceof Error ? cause.message : '拍照失败，请重试或选照片。' }
  finally { busy.value = false }
}
// 此组件只在用户点击拍照入口后挂载；首次直接打开系统相机，取消后留在选择页。
// 模型列表的初次读取不阻塞拍照；照片返回后仍走原有识别配置校验。
onMounted(() => { void takePhoto(true) })
async function fromFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || busy.value || switching.value) return
  busy.value = true; error.value = ''
  try { await accept(file) } catch (cause) { if (alive) error.value = cause instanceof Error ? cause.message : '照片读取失败。' }
  finally { busy.value = false }
}
</script>
<template>
  <AppSheet :open="true" title="拍照记录" subtitle="使用手机系统相机" :busy="busy || switching" test-id="system-capture" @close="emit('close')">
    <div class="system-photo-fields">
      <label>餐次<select v-model="meal" :disabled="busy || switching" data-testid="system-photo-meal"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="snack">加餐</option></select></label>
      <label>拍摄内容<select v-model="kind" :disabled="busy || switching" data-testid="system-photo-kind"><option value="food">食物</option><option value="label">营养表</option><option value="barcode">条码</option></select></label>
    </div>
    <p class="muted">{{ kind === 'barcode' ? '拍清完整条码，照片在本机读码，不发送给AI。' : kind === 'label' ? '拍清营养表、每100g／mL或每份的单位，返回后识别。' : '拍下整份食物，返回后识别并核对份量。' }}</p>
    <PhotoModelPicker v-if="kind !== 'barcode'" compact :kind="kind" :busy="busy" @switching="switching = $event" />
    <p class="tiny muted" data-testid="system-photo-privacy">食刻不申请相机权限。拍照由系统相机完成，照片仅在确认后返回；相册保存方式由系统相机决定。</p>
    <p v-if="error" class="notice danger" role="alert" data-testid="system-photo-error">{{ error }}</p>
    <input ref="gallery" type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" :disabled="busy || switching" data-testid="system-photo-gallery-input" @change="fromFile" />
    <template #footer><div class="system-photo-actions">
      <button class="button primary full" :disabled="busy || switching" data-testid="system-photo-take" @click="takePhoto()"><LoaderCircle v-if="busy" :size="18" class="spin"/><Camera v-else :size="18"/>{{ busy ? '正在处理照片…' : '打开系统相机' }}</button>
      <button class="button secondary" :disabled="busy || switching" data-testid="system-photo-gallery" @click="gallery?.click()"><ImagePlus :size="17"/>选照片</button>
      <button class="button secondary" :disabled="busy || switching" data-testid="system-photo-manual" @click="emit('skip', meal, kind)"><Keyboard :size="17"/>{{ kind === 'barcode' ? '输入条码' : '手动记录' }}</button>
    </div></template>
  </AppSheet>
</template>
<style scoped>
.system-photo-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.system-photo-fields label { display: grid; gap: 6px; }
.system-photo-fields select { width: 100%; }
.system-photo-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.system-photo-actions > :first-child { grid-column: 1 / -1; }
</style>
