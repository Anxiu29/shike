<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, Search, ChevronRight, Trash2, LoaderCircle } from '@lucide/vue'
import type { EstimatedFood } from '@shike/shared'
import AppSheet from './AppSheet.vue'
import { numberLabel } from '../lib/dates'
const props = defineProps<{ foods: EstimatedFood[]; compact?: boolean; deletingId?: string | null }>()
const emit = defineEmits<{ remove: [food: EstimatedFood] }>()
const open = ref(false), query = ref(''), limit = ref(10)
const filtered = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return props.foods.filter(food => !text || `${food.name} ${food.model}`.toLocaleLowerCase().includes(text))
})
watch(query, () => { limit.value = 10 })
function show() { query.value = ''; limit.value = 10; open.value = true }
</script>
<template>
  <article class="card settings-card settings-estimate-card" :class="{ 'settings-estimate-inline': compact }" data-testid="settings-estimate-card">
    <button type="button" class="settings-tool-row estimate-library-entry" data-testid="manage-estimates" @click="show">
      <span class="settings-tool-icon"><BookOpen :size="21"/></span>
      <span><strong>个人估算库 <b class="soft-tag" data-testid="estimated-food-count">{{ foods.length }} 项</b></strong><small>{{ foods.length ? '搜索和管理已保存的 AI 营养估算' : '确认保存的 AI 营养估算会留在这里' }}</small></span><ChevronRight :size="18"/>
    </button>
    <p v-if="!compact" class="tiny muted library-note">同名食物可复用；修改或删除估算不影响历史饮食快照。</p>
  </article>
  <AppSheet :open="open" :busy="!!deletingId" title="个人估算库" subtitle="搜索、核对与管理已确认保存的 AI 估算" test-id="estimate-library" @close="open = false">
    <label class="estimate-search"><Search :size="18"/><input v-model="query" type="search" aria-label="搜索个人估算" placeholder="搜索食物名称或模型" data-testid="estimate-search"/></label>
    <p class="tiny muted estimate-result-count">{{ filtered.length }} 项{{ query.trim() ? '匹配结果' : '已保存估算' }} · AI 粗估，未经测量</p>
    <div v-if="!filtered.length" class="personal-empty"><BookOpen :size="26"/><p>{{ foods.length ? '没有找到匹配的估算，试试其他名称。' : '还没有保存的估算。真实 AI 粗估在确认保存后会出现在这里。' }}</p></div>
    <article v-for="(food, index) in filtered.slice(0, limit)" :key="food.id" class="estimate-library-item" :data-testid="`estimated-food-${index}`">
      <div><strong>{{ food.name }}</strong><button class="icon-button" data-testid="delete-estimated-food" :disabled="!!deletingId" :aria-busy="deletingId === food.id" :aria-label="`删除个人估算${food.name}`" @click="emit('remove', food)"><LoaderCircle v-if="deletingId === food.id" class="spin" :size="16"/><Trash2 v-else :size="16"/></button></div>
      <p>{{ food.nutrientsPer100g.energyKcal === null ? '热量待补充' : `约 ${numberLabel(food.nutrientsPer100g.energyKcal)} kcal / 100 g` }}</p>
      <small class="muted">{{ food.provider === 'mock' ? '导入的模拟估算 · 不参与真实匹配' : 'AI 粗估 · 未经测量' }} · {{ food.model }}</small>
      <details class="settings-inline-details"><summary>查看估算假设</summary><p>{{ food.assumptions.join(' ') || '请核对用油、糖和含水量。' }}</p></details>
    </article>
    <button v-if="filtered.length > limit" class="button secondary estimate-load-more" data-testid="estimate-load-more" @click="limit += 10">再显示 {{ Math.min(10, filtered.length - limit) }} 项</button>
    <p class="tiny muted library-note">估算不属于 USDA 参考数据。照片和未保存草稿不会加入此库。</p>
  </AppSheet>
</template>
