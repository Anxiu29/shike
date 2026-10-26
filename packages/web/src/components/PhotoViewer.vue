<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, ImageOff } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
const props = defineProps<{ photos: string[]; title?: string; subtitle?: string; testId?: string }>()
const emit = defineEmits<{ close: [] }>()
const index = ref(0), zoom = ref(1), failed = ref(false)
watch(index, () => { zoom.value = 1; failed.value = false })
watch(() => props.photos, () => { index.value = 0; zoom.value = 1; failed.value = false })
</script>
<template>
  <AppSheet open :title="title ?? '餐次照片'" :subtitle="subtitle ?? '用于识别的压缩照片，保存在此设备'" :test-id="testId ?? 'meal-photo-viewer'" class-name="photo-viewer-sheet" @close="emit('close')">
    <div class="photo-viewer-controls"><span role="status" data-testid="photo-page">{{ index + 1 }} / {{ photos.length }}</span><button type="button" class="icon-button" aria-label="缩小照片" :disabled="zoom <= 1 || failed" @click="zoom = Math.max(1, zoom - .5)"><ZoomOut :size="20"/></button><button type="button" class="icon-button" aria-label="放大照片" data-testid="zoom-meal-photo" :disabled="zoom >= 3 || failed" @click="zoom = Math.min(3, zoom + .5)"><ZoomIn :size="20"/></button><button type="button" class="icon-button" aria-label="还原照片大小" :disabled="zoom === 1" @click="zoom = 1"><RotateCcw :size="18"/></button></div>
    <div class="photo-viewer-frame" :class="{ zoomed: zoom > 1 }" tabindex="0" aria-label="照片查看区，放大后可滑动查看">
      <p v-if="failed" class="photo-load-error" role="alert"><ImageOff :size="26"/>这张照片无法显示，请关闭后重试。</p>
      <img v-else :key="index" :src="photos[index]" :style="zoom > 1 ? { width: `${zoom * 100}%` } : undefined" :alt="`餐次照片 ${index + 1}`" data-testid="meal-photo-image" @error="failed = true"/>
    </div>
    <template #footer><div class="photo-viewer-footer"><button type="button" class="button secondary" aria-label="上一张照片" :disabled="index === 0" @click="index--"><ChevronLeft :size="17"/>上一张</button><span>{{ zoom === 1 ? '可点放大查看细节' : '可滑动查看，点还原恢复全图' }}</span><button type="button" class="button secondary" aria-label="下一张照片" :disabled="index >= photos.length - 1" @click="index++">下一张<ChevronRight :size="17"/></button></div></template>
  </AppSheet>
</template>
