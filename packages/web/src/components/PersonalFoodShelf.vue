<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, BookHeart, History, Plus, Star } from '@lucide/vue'
import { calculateNutrients, type FoodEntry, type LibraryFood, type MealRecord } from '@shike/shared'
import { copyLibraryEntry, personalFoodSymbol, sortedPersonalFoods } from '../lib/personal-foods'
import { copyHistoryFood, historyFoodShortcuts, type HistoryFood } from '../lib/diary-shortcuts'
import { numberLabel, portionLabel } from '../lib/dates'

const props = defineProps<{ foods: LibraryFood[]; meals: MealRecord[]; date: string }>()
const emit = defineEmits<{ open: []; add: [entry: FoodEntry] }>()
const selected = ref<'saved' | 'recent' | 'frequent' | null>(null)
const history = computed(() => historyFoodShortcuts(props.meals, props.date))
const mode = computed(() => selected.value ?? (props.foods.length || !history.value.recent.length ? 'saved' : 'recent'))
const modes = computed(() => [
  { value: 'saved' as const, label: '我的常用', count: props.foods.length },
  { value: 'recent' as const, label: '最近吃过', count: history.value.recent.length },
  { value: 'frequent' as const, label: '经常吃', count: history.value.frequent.length },
])
interface Shortcut { id: string; entry: FoodEntry; library?: LibraryFood; history?: HistoryFood; caption: string }
const shown = computed<Shortcut[]>(() => mode.value === 'saved'
  ? sortedPersonalFoods(props.foods).slice(0, 6).map(food => ({ id: `quick-food-${food.id}`, entry: food.entry, library: food, caption: food.favorite ? '星标常用' : '常用份量' }))
  : history.value[mode.value].slice(0, 6).map(food => ({ id: `history-food-${food.id}`, entry: food.entry, history: food, caption: mode.value === 'frequent' ? `已记录 ${food.uses} 次` : food.date === props.date ? '当日记录' : `${food.date.slice(5).replace('-', '/')} 记录` })))
function energy(entry: FoodEntry) { const value = calculateNutrients(entry).energyKcal; return value === null ? '热量待补充' : `约 ${numberLabel(value)} kcal` }
function add(food: Shortcut) { emit('add', food.library ? copyLibraryEntry(food.library) : copyHistoryFood(food.history!)) }
</script>

<template>
  <section class="personal-food-shelf card" aria-labelledby="personal-food-title" data-testid="personal-food-shelf">
    <div class="personal-shelf-heading"><div><span class="personal-section-icon"><BookHeart :size="19" /></span><div><h2 id="personal-food-title">常用与最近</h2><p>熟悉的食物，少找一次</p></div></div><button type="button" class="text-button" data-testid="open-personal-library" @click="emit('open')">管理常用<ArrowUpRight :size="15" /></button></div>
    <div class="food-shortcut-tabs" role="group" aria-label="快捷食物来源"><button v-for="item in modes" :key="item.value" type="button" :aria-pressed="mode === item.value" :data-testid="`shortcut-tab-${item.value}`" @click="selected = item.value">{{ item.label }}<small v-if="item.count">{{ item.count }}</small></button></div>
    <div v-if="shown.length" class="personal-shelf-list">
      <button v-for="food in shown" :key="food.id" type="button" class="personal-quick-food" :data-testid="food.id" :aria-label="`添加${food.entry.name}`" @click="add(food)"><span class="personal-food-symbol" aria-hidden="true">{{ personalFoodSymbol(food.entry) }}</span><span class="personal-quick-copy"><strong>{{ food.entry.name }}</strong><small>{{ portionLabel(food.entry) }}</small><span>{{ energy(food.entry) }}</span><small class="shortcut-context">{{ food.caption }}</small></span><Star v-if="food.library?.favorite" class="personal-quick-star" :size="11" fill="currentColor" /><span class="personal-quick-plus"><Plus :size="16" /></span></button>
    </div>
    <button v-else-if="mode === 'saved'" type="button" class="personal-shelf-empty" data-testid="personal-library-empty-cta" @click="emit('open')"><span class="personal-empty-art" aria-hidden="true">🥑<span>＋</span></span><span><strong>把常吃的食物留下</strong><small>识别或添加后，点「存为常用」，下次直接选。</small></span><Plus :size="19" /></button>
    <div v-else class="shortcut-history-empty" data-testid="history-shortcuts-empty"><History :size="22" /><div><strong>{{ mode === 'recent' ? '记录一餐，下次更快' : '慢慢找到你的日常味道' }}</strong><p>{{ mode === 'recent' ? '保存过的食物会出现在这里；模拟记录不加入快捷列表。' : '常吃的食物会根据你的饮食记录显示在这里。' }}</p></div></div>
  </section>
</template>
