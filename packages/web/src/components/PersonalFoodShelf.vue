<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowUpRight, BookHeart, History, Plus, Star } from '@lucide/vue'
import { calculateNutrients, type FoodEntry, type LibraryFood, type MealRecord } from '@shike/shared'
import { personalFoodSymbol, sortedPersonalFoods } from '../lib/personal-food-display'
import { copyHistoryFood, historyFoodShortcuts, type HistoryFood } from '../lib/diary-shortcuts'
import { numberLabel, portionLabel } from '../lib/dates'
import { backLayers } from '../lib/use-back-layer'

const props = defineProps<{ foods: LibraryFood[]; meals: MealRecord[]; date: string; available?: boolean }>()
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
const adding = ref(false), addError = ref('')
let disposed = false, dateRevision = 0
onBeforeUnmount(() => { disposed = true })
// 比较版本而非最终日期值：离开后又返回同一天，也不能恢复已经取消的添加意图。
watch([() => props.date, () => props.available], () => { dateRevision++; addError.value = '' })
// 通过函数重新读取响应式 prop，等待期间父组件可能已改变可用状态。
const isAvailable = () => props.available !== false
async function add(food: Shortcut) {
  if (adding.value || !isAvailable()) return
  const revision = dateRevision, panels = backLayers.revision
  adding.value = true; addError.value = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // 展示常用卡片无需查库；只有用户点添加，才加载可能补初始份量的工厂。
    const entry = food.library ? (await Promise.race([
      import('../lib/personal-foods'),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('加载超时')), 20_000) }),
    ])).copyLibraryEntry(food.library) : copyHistoryFood(food.history!)
    // 面板版本还能覆盖助手、饮水等子组件内部弹窗；只比较“现在没有弹窗”会漏掉打开再关闭。
    if (!disposed && isAvailable() && revision === dateRevision && panels === backLayers.revision) emit('add', entry)
  } catch { if (!disposed && revision === dateRevision && panels === backLayers.revision) addError.value = '食物加载失败，原记录已保留，请重试。' }
  finally { clearTimeout(timer); if (!disposed) adding.value = false }
}
</script>

<template>
  <section class="personal-food-shelf card" aria-labelledby="personal-food-title" data-testid="personal-food-shelf">
    <div class="personal-shelf-heading"><div><span class="personal-section-icon"><BookHeart :size="19" /></span><div><h2 id="personal-food-title">常用与最近</h2><p>熟悉的食物，少找一次</p></div></div><button type="button" class="text-button" data-testid="open-personal-library" @click="emit('open')">管理常用<ArrowUpRight :size="15" /></button></div>
    <div class="food-shortcut-tabs" role="group" aria-label="快捷食物来源"><button v-for="item in modes" :key="item.value" type="button" :aria-pressed="mode === item.value" :data-testid="`shortcut-tab-${item.value}`" @click="selected = item.value">{{ item.label }}<small v-if="item.count">{{ item.count }}</small></button></div>
    <p v-if="adding" class="small-text" role="status">正在准备食物…</p>
    <p v-if="addError" class="notice danger" role="alert">{{ addError }}</p>
    <div v-if="shown.length" class="personal-shelf-list" :inert="adding" :aria-busy="adding">
      <button v-for="food in shown" :key="food.id" type="button" class="personal-quick-food" :data-testid="food.id" :aria-label="`添加${food.entry.name}`" @click="add(food)"><span class="personal-food-symbol" aria-hidden="true">{{ personalFoodSymbol(food.entry) }}</span><span class="personal-quick-copy"><strong>{{ food.entry.name }}</strong><small>{{ portionLabel(food.entry) }}</small><span>{{ energy(food.entry) }}</span><small class="shortcut-context">{{ food.caption }}</small></span><Star v-if="food.library?.favorite" class="personal-quick-star" :size="11" fill="currentColor" /><span class="personal-quick-plus"><Plus :size="16" /></span></button>
    </div>
    <button v-else-if="mode === 'saved'" type="button" class="personal-shelf-empty" data-testid="personal-library-empty-cta" @click="emit('open')"><span class="personal-empty-art" aria-hidden="true">🥑<span>＋</span></span><span><strong>把常吃的食物留下</strong><small>识别或添加后，点「存为常用」，下次直接选。</small></span><Plus :size="19" /></button>
    <div v-else class="shortcut-history-empty" data-testid="history-shortcuts-empty"><History :size="22" /><div><strong>{{ mode === 'recent' ? '记录一餐，下次更快' : '慢慢找到你的日常味道' }}</strong><p>{{ mode === 'recent' ? '保存过的食物会出现在这里；模拟记录不加入快捷列表。' : '常吃的食物会根据你的饮食记录显示在这里。' }}</p></div></div>
  </section>
</template>
