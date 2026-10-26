<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { BookHeart, Check, ChevronRight, Plus, Search, Sparkles, Star, Trash2, X } from '@lucide/vue'
import { calculateNutrients, normalizeFoodName, type FoodEntry, type LibraryFood } from '@shike/shared'
import AppSheet from './AppSheet.vue'
import PersonalFoodDetails from './PersonalFoodDetails.vue'
import { db } from '../lib/db'
import { copyLibraryEntry, personalFoodSymbol, sortedPersonalFoods } from '../lib/personal-foods'
import { entryBasis } from '../lib/entries'
import { numberLabel, portionLabel } from '../lib/dates'
import type { ToastAction } from '../lib/toast'

const props = defineProps<{ foods: LibraryFood[] }>()
const emit = defineEmits<{ close: []; add: [entry: FoodEntry]; create: []; changed: []; notify: [message: string, action?: ToastAction] }>()
const query = ref(''), filter = ref('全部'), busy = ref(false), error = ref('')
const removedFood = ref<LibraryFood | null>(null)
const selectedFoodId = ref<string | null>(null)
const selectedFood = computed(() => props.foods.find(food => food.id === selectedFoodId.value))
async function addFromDetails() {
  const food = selectedFood.value
  if (!food) return
  selectedFoodId.value = null
  // 先卸载详情层再关闭食物库，让滚动锁和焦点按打开顺序恢复。
  await nextTick()
  emit('add', copyLibraryEntry(food))
}
const filters = ['全部', '星标', 'AI 识别', '手动添加']
const results = computed(() => sortedPersonalFoods(props.foods).filter(food => {
  if (filter.value === '星标' && !food.favorite) return false
  if (filter.value === 'AI 识别' && food.origin !== 'ai') return false
  if (filter.value === '手动添加' && food.origin !== 'manual') return false
  return normalizeFoodName(food.entry.name).includes(normalizeFoodName(query.value))
}))
const favoriteCount = computed(() => props.foods.filter(food => food.favorite).length)
function originLabel(food: LibraryFood) { return food.origin === 'ai' ? 'AI 识别' : food.origin === 'manual' ? '手动添加' : '食物库收藏' }
function energy(food: LibraryFood) { const value = calculateNutrients(food.entry).energyKcal; return value === null ? '热量待补充' : `约 ${numberLabel(value)} kcal` }
async function favorite(food: LibraryFood) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await db.libraryFoods.update(food.id, { favorite: !food.favorite, updatedAt: new Date().toISOString() }); emit('changed') }
  catch { error.value = '星标保存失败，请重试。' }
  finally { busy.value = false }
}
async function remove(food: LibraryFood) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const snapshot = JSON.parse(JSON.stringify(food)) as LibraryFood
    await db.libraryFoods.delete(food.id)
    removedFood.value = snapshot
    emit('changed')
    emit('notify', `已移除「${food.entry.name}」`, { label: '撤销', run: () => restore(snapshot) })
  } catch { error.value = '移除失败，请检查本机存储后重试。' }
  finally { busy.value = false }
}
async function restore(food: LibraryFood) {
  await db.transaction('rw', db.libraryFoods, async () => { if (!await db.libraryFoods.get(food.id)) await db.libraryFoods.put(JSON.parse(JSON.stringify(food))) })
  removedFood.value = null; emit('changed')
}
async function undo() {
  if (!removedFood.value || busy.value) return
  busy.value = true
  try { await restore(removedFood.value); error.value = '' }
  catch { error.value = '撤销失败，请重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <AppSheet open title="个人常用食物库" subtitle="收集常吃的食物，让每次记录都简单一点" :busy="busy" test-id="personal-food-library" class-name="personal-library-sheet" @close="emit('close')">
    <div class="personal-library-banner"><span class="personal-library-mark"><BookHeart :size="27" stroke-width="1.5" /></span><div><strong>你的日常，随手可用</strong><p><span>{{ foods.length }} 项常用</span><i></i><span>{{ favoriteCount }} 项星标</span></p></div><Sparkles :size="23" stroke-width="1.3" /></div>
    <div class="personal-library-toolbar"><label class="personal-library-search"><Search :size="18" /><span class="sr-only">搜索常用食物</span><input v-model="query" type="search" maxlength="100" placeholder="搜索我的常用食物" data-testid="personal-library-search" /><button v-if="query" type="button" class="icon-button small" aria-label="清空常用食物搜索" @click="query = ''"><X :size="15" /></button></label><button type="button" class="button primary" :disabled="busy" data-testid="personal-library-create" @click="emit('create')"><Plus :size="17" /><span>添加食物</span></button></div>
    <div class="personal-library-filters" role="group" aria-label="常用食物筛选"><button v-for="name in filters" :key="name" type="button" :aria-pressed="filter === name" :data-testid="`personal-filter-${name}`" @click="filter = name"><Star v-if="name === '星标'" :size="13" />{{ name }}</button><span>{{ results.length }} 项</span></div>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <div v-if="removedFood" class="personal-library-undo" role="status"><span>已移除「{{ removedFood.entry.name }}」</span><button type="button" class="text-button" :disabled="busy" data-testid="personal-library-undo" @click="undo">撤销</button></div>
    <div v-if="results.length" class="personal-library-grid">
      <article v-for="food in results" :key="food.id" class="personal-library-food" :data-testid="`personal-food-${food.id}`">
        <div class="personal-food-card-top"><span class="personal-food-symbol" aria-hidden="true">{{ personalFoodSymbol(food.entry) }}</span><span class="personal-origin" :class="{ ai: food.origin === 'ai' }">{{ originLabel(food) }}</span><button type="button" class="icon-button personal-star" :class="{ active: food.favorite }" :disabled="busy" :aria-label="`${food.favorite ? '取消星标' : '星标'}${food.entry.name}`" :aria-pressed="food.favorite" :data-testid="`personal-favorite-${food.id}`" @click="favorite(food)"><Star :size="18" :fill="food.favorite ? 'currentColor' : 'none'" /></button></div>
        <h3><button type="button" class="personal-food-view" :aria-label="`查看${food.entry.name}的详情`" :data-testid="`personal-detail-${food.id}`" @click="selectedFoodId = food.id"><span>{{ food.entry.name }}</span><ChevronRight :size="16" aria-hidden="true" /></button></h3><p class="personal-food-portion">{{ portionLabel(food.entry) }}<span> · {{ energy(food) }}</span></p><p class="personal-food-basis">{{ entryBasis(food.entry) }} · 点击查看详情</p>
        <div class="personal-food-card-actions"><button type="button" class="button secondary" :disabled="busy" :data-testid="`personal-add-${food.id}`" @click="emit('add', copyLibraryEntry(food))"><Plus :size="16" />加入这一餐</button><button type="button" class="icon-button personal-remove" :disabled="busy" :aria-label="`移除${food.entry.name}`" :data-testid="`personal-delete-${food.id}`" @click="remove(food)"><Trash2 :size="16" /></button></div>
      </article>
    </div>
    <div v-else class="personal-library-empty" data-testid="personal-library-empty"><span>{{ foods.length ? '🔎' : '🥣' }}</span><h3>{{ foods.length ? '没有找到匹配的食物' : '从你常吃的第一样开始' }}</h3><p>{{ foods.length ? '换个关键词，或查看全部常用食物。' : '拍照识别或手动添加后，点「存为常用」。份量和营养数据会一起保存。' }}</p><button v-if="foods.length" type="button" class="button secondary" @click="query = ''; filter = '全部'">查看全部</button><button v-else type="button" class="button primary" data-testid="personal-library-first-food" @click="emit('create')"><Plus :size="17" />添加第一项食物</button></div>
    <template #footer><p class="personal-library-note"><Check :size="15" />保存在本机，随备份导出。再次添加时可调整份量。</p></template>
  </AppSheet>
  <PersonalFoodDetails v-if="selectedFood" :food="selectedFood" @close="selectedFoodId = null" @add="addFromDetails" />
</template>
