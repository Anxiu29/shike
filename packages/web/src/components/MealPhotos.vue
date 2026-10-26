<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { liveQuery } from 'dexie'
import { Image, LoaderCircle } from '@lucide/vue'
import type { MealPhoto } from '@shike/shared'
import { db } from '../lib/db'
import PhotoViewer from './PhotoViewer.vue'
const props = defineProps<{ mealId: string }>()
const photos = ref<MealPhoto[]>([]), open = ref(false), loading = ref(true), error = ref('')
let subscription: { unsubscribe: () => void } | undefined
function load() {
  subscription?.unsubscribe(); loading.value = true; error.value = ''
  subscription = liveQuery(() => db.mealPhotos.where('mealId').equals(props.mealId).sortBy('position')).subscribe({
    next: data => { photos.value = data; loading.value = false },
    error: () => { error.value = '照片暂时无法读取，点击重试'; loading.value = false },
  })
}
onMounted(load)
onBeforeUnmount(() => subscription?.unsubscribe())
</script>
<template>
  <button type="button" class="meal-photo-link" data-testid="view-meal-photo" :disabled="loading" :aria-label="error || `查看这餐的${photos.length}张照片`" @click="error ? load() : open = true">
    <LoaderCircle v-if="loading" class="spin" :size="21"/><img v-else-if="photos[0]" :src="photos[0].dataUrl" alt="餐次照片缩略图" loading="lazy"/>
    <span><strong><Image :size="15"/>{{ loading ? '正在读取照片…' : error || '查看餐次照片' }}</strong><small v-if="!loading && !error">{{ photos.length }} 张 · 点击查看大图</small></span>
  </button>
  <PhotoViewer v-if="open && photos.length" :photos="photos.map(photo => photo.dataUrl)" @close="open = false"/>
</template>
