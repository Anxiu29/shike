<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, CalendarDays, Plus, Sun, Sunrise, Moon, Cookie, Pencil, Trash2, ArrowUpRight, Leaf, Camera, Copy, Check } from '@lucide/vue'
import { aggregateNutrients, calculateEnergyRange, selectedEstimateOption, type FoodEntry, type LibraryFood, type MealRecord, type MealType, type Settings, type WeightRecord, type WaterRecord, type ExerciseRecord, type DailyPlan } from '@shike/shared'
import PersonalFoodShelf from '../components/PersonalFoodShelf.vue'
import DailyWellness from '../components/DailyWellness.vue'
import EnergySummary from '../components/EnergySummary.vue'
import DiaryWeek from '../components/DiaryWeek.vue'
import DateField from '../components/DateField.vue'
import type { ToastAction } from '../lib/toast'
import { dateLabel, localDate, numberLabel, rangeLabel, shiftDate, portionLabel, suggestedMealType } from '../lib/dates'
import { entryBasis } from '../lib/entries'

const props = defineProps<{ date: string; meals: MealRecord[]; settings: Settings; weights: WeightRecord[]; water: WaterRecord[]; exercises: ExerciseRecord[]; dailyPlans: DailyPlan[]; libraryFoods: LibraryFood[] }>()
const emit = defineEmits<{ date: [value: string]; add: [type: MealType, start: 'photo' | 'manual']; edit: [record: MealRecord]; reuse: [record: MealRecord, date: string]; remove: [record: MealRecord]; changed: []; notify: [message: string, action?: ToastAction]; goals: []; library: []; quickAdd: [entry: FoodEntry] }>()
const wellnessRef = ref<InstanceType<typeof DailyWellness> | null>(null)
const calendarRef = ref<InstanceType<typeof DiaryWeek> | null>(null)
let homeSwipe: { x: number; y: number; active: boolean } | null = null, suppressSwipeClick = false
function cancelSwipe() { if (homeSwipe?.active) calendarRef.value?.finishDrag(true); homeSwipe = null }
function touchstart(event: TouchEvent) {
  suppressSwipeClick = false
  const target = event.target as HTMLElement
  if (event.touches.length !== 1 || target.closest('input, select, textarea, [contenteditable=true]')) { cancelSwipe(); return }
  const touch = event.touches[0]!
  homeSwipe = { x: touch.clientX, y: touch.clientY, active: false }
}
function touchmove(event: TouchEvent) {
  if (!homeSwipe || event.touches.length !== 1) { cancelSwipe(); return }
  const touch = event.touches[0]!, dx = Math.abs(touch.clientX - homeSwipe.x), dy = touch.clientY - homeSwipe.y
  if (!homeSwipe.active) {
    if (dx > Math.abs(dy) * 1.3 && dx > 8) { homeSwipe = null; return }
    if (Math.abs(dy) < 8 || Math.abs(dy) < dx * 1.3) return
    if (!event.cancelable || !calendarRef.value?.canDrag(dy)) { homeSwipe = null; return }
    homeSwipe.active = true; suppressSwipeClick = true; calendarRef.value.beginDrag()
  }
  // 下拉增加可见高度，上推减少；同一手势中反向移动也实时跟随。
  if (event.cancelable) event.preventDefault()
  calendarRef.value?.dragBy(dy)
}
function touchend() {
  const swipe = homeSwipe; homeSwipe = null
  if (swipe?.active) calendarRef.value?.finishDrag()
}
function gestureClick(event: MouseEvent) {
  if (suppressSwipeClick && event.detail > 0) { suppressSwipeClick = false; event.preventDefault(); event.stopPropagation() }
}
function pointerdown(event: PointerEvent) { if (event.pointerType !== 'touch') suppressSwipeClick = false }
const todayMeals = computed(() => props.meals.filter(record => record.date === props.date).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
const groups = [{ type: 'breakfast' as MealType, label: '早餐', subtitle: '开启新的一天', icon: Sunrise, color: 'sunrise' }, { type: 'lunch' as MealType, label: '午餐', subtitle: '给午后充点能量', icon: Sun, color: 'sun' }, { type: 'dinner' as MealType, label: '晚餐', subtitle: '好好吃一顿晚饭', icon: Moon, color: 'moon' }, { type: 'snack' as MealType, label: '加餐', subtitle: '两餐之间的小补给', icon: Cookie, color: 'snack' }]
function groupRecords(type: MealType) { return todayMeals.value.filter(record => record.mealType === type) }
function mealCalories(records: MealRecord[]) { return aggregateNutrients(records.flatMap(record => record.items)) }
function mealEnergy(records: MealRecord[]) {
  const items = records.flatMap(record => record.items), total = aggregateNutrients(items).energyKcal
  if (total.missing === items.length) return '热量待补充'
  return (total.missing ? '已知约 ' : '约 ') + numberLabel(total.known) + ' kcal'
}
const previousByType = computed(() => {
  const previous = props.meals.filter(record => record.date < props.date).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return Object.fromEntries(groups.map(group => [group.type, previous.find(record => record.mealType === group.type)])) as Partial<Record<MealType, MealRecord>>
})
const foodCount = computed(() => todayMeals.value.reduce((count, meal) => count + meal.items.length, 0))
const recordedGroups = computed(() => new Set(todayMeals.value.map(meal => meal.mealType)).size)
</script>

<template>
  <section class="diary-view" data-testid="diary-home" @touchstart.passive="touchstart" @touchmove="touchmove" @touchend.passive="touchend" @touchcancel.passive="cancelSwipe" @pointerdown.capture="pointerdown" @click.capture="gestureClick">
    <div class="page-heading"><div><span class="eyebrow">把每一餐，记得清楚</span><h1>饮食记录</h1></div><div class="date-switcher"><button class="icon-button" aria-label="前一天" data-testid="previous-date" @click="emit('date', shiftDate(date, -1))"><ChevronLeft :size="18" /></button><label class="date-picker"><CalendarDays :size="17" /><span>{{ date === localDate() ? '今天' : date.slice(5).replace('-', '/') }}</span><DateField :model-value="date" compact data-testid="diary-date" aria-label="选择记录日期" @update:model-value="emit('date', $event)" /></label><button class="icon-button" aria-label="后一天" data-testid="next-date" @click="emit('date', shiftDate(date, 1))"><ChevronRight :size="18" /></button></div></div>
    <div v-if="date !== localDate()" class="history-caption">{{ dateLabel(date) }} <button class="text-button" @click="emit('date', localDate())">回到今天</button></div>
    <DiaryWeek ref="calendarRef" :date="date" :meals="meals" :settings="settings" :weights="weights" :exercises="exercises" :daily-plans="dailyPlans" @select="emit('date', $event)" />
    <div class="diary-dashboard">
      <EnergySummary class="diary-energy" :date="date" :meals="todayMeals" :settings="settings" :weights="weights" :exercises="exercises" :daily-plans="dailyPlans" @goals="emit('goals')" @extra-exercise="wellnessRef?.openExtraExercise()" @changed="emit('changed')" @notify="emit('notify', $event)" />
      <div class="diary-quick-actions"><button class="button primary" data-testid="hero-camera" @click="emit('add', suggestedMealType(), 'photo')"><Camera :size="20" /><span>拍照识别</span><ArrowUpRight :size="16" /></button><button class="button secondary" data-testid="manual-add" @click="emit('add', suggestedMealType(), 'manual')"><Plus :size="20" /><span>添加食物</span><ArrowUpRight :size="16" /></button></div>
      <PersonalFoodShelf class="diary-shortcuts" :foods="libraryFoods" :meals="meals" :date="date" @open="emit('library')" @add="emit('quickAdd', $event)" />
      <aside class="diary-wellness" aria-label="日常健康记录">
        <DailyWellness ref="wellnessRef" :date="date" :settings="settings" :weights="weights" :water="water" :exercises="exercises" :daily-plans="dailyPlans" @changed="emit('changed')" @notify="(message, action) => emit('notify', message, action)" @goals="emit('goals')" />
        <div class="diary-record-overview card"><div class="diary-overview-heading"><span>当日记录</span><small>{{ recordedGroups }} / 4 个餐次</small></div><div class="diary-overview-meals"><div v-for="group in groups" :key="group.type" :class="{ recorded: groupRecords(group.type).length }"><span><Check v-if="groupRecords(group.type).length" :size="15" /><component :is="group.icon" v-else :size="15" /></span>{{ group.label }}</div></div><p>已记录 {{ foodCount }} 项食物。<br />重复的一餐可直接复用，再核对本次份量。</p></div>
      </aside>
      <section class="diary-meals" aria-labelledby="diary-meals-title">
        <div class="section-heading diary-heading"><div><h2 id="diary-meals-title">三餐记录</h2><p>{{ foodCount ? '已记录 ' + foodCount + ' 项食物，随时可以调整' : '从你吃下的第一餐开始' }}</p></div><span class="soft-tag">{{ todayMeals.length }} 条</span></div>
        <div class="meal-grid">
          <article v-for="group in groups" :key="group.type" class="meal-card card" :class="{ 'is-empty': !groupRecords(group.type).length }" :data-testid="'meal-' + group.type">
            <header class="meal-card-header">
              <div class="meal-title"><span class="meal-icon" :class="group.color"><component :is="group.icon" :size="22" stroke-width="1.6" /></span><div><h3>{{ group.label }}</h3><p>{{ group.subtitle }}</p></div></div>
              <span v-if="groupRecords(group.type).length" class="meal-total">{{ mealEnergy(groupRecords(group.type)) }}</span>
              <div class="meal-entry-actions"><button type="button" class="meal-camera" :aria-label="'拍照记录' + group.label" :data-testid="'photo-' + group.type" @click="emit('add', group.type, 'photo')"><Camera :size="17" /><span>拍照</span></button><button type="button" class="icon-button add-circle" :aria-label="'添加' + group.label" :data-testid="'add-' + group.type" @click="emit('add', group.type, 'manual')"><Plus :size="18" /></button></div>
            </header>
            <div v-if="!groupRecords(group.type).length" class="meal-empty"><span>还没有记录</span><button v-if="previousByType[group.type]" type="button" class="text-button" :data-testid="'reuse-previous-' + group.type" @click="emit('reuse', previousByType[group.type]!, date)"><Copy :size="14" />复用上次{{ group.label }}</button></div>
            <div v-for="record in groupRecords(group.type)" :key="record.id" class="meal-record" data-testid="meal-record">
              <div class="record-actions"><span class="record-time">{{ new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}<span v-if="record.mode === 'mock'" class="mock-tag">模拟记录</span><span v-else-if="record.mode === 'live'" class="ai-tag">AI 辅助</span></span><div><button type="button" class="text-button reuse-meal" aria-label="复用这条饮食记录" data-testid="reuse-meal" @click="emit('reuse', record, localDate())"><Copy :size="13" />再记一餐</button><button class="icon-button small" aria-label="编辑饮食记录" data-testid="edit-meal" @click="emit('edit', record)"><Pencil :size="14" /></button><button class="icon-button small" aria-label="删除饮食记录" data-testid="delete-meal" @click="emit('remove', record)"><Trash2 :size="14" /></button></div></div>
              <div v-for="item in record.items" :key="item.id" class="record-food"><div><strong>{{ item.name }}</strong><span>{{ portionLabel(item) }} · {{ entryBasis(item) }}{{ item.estimateProfile ? ' · ' + selectedEstimateOption(item.estimateProfile, item.estimateLevel ?? 'medium').label : '' }}</span><p v-if="item.estimateProfile" class="record-range">估算范围约 {{ rangeLabel(calculateEnergyRange(item)) }} kcal · 按中值记账</p></div><span class="food-calories">{{ aggregateNutrients([item]).energyKcal.missing ? '待补充' : '约 ' + numberLabel(aggregateNutrients([item]).energyKcal.known) }} <small v-if="!aggregateNutrients([item]).energyKcal.missing">kcal</small></span></div>
              <p v-if="mealCalories([record]).incompleteEntries" class="record-warning">{{ mealCalories([record]).incompleteEntries }} 项营养数据待补充 · 当前为已知部分估算</p>
            </div>
          </article>
        </div>
      </section>
    </div>
    <p class="daily-footnote"><Leaf :size="14" /> 食物没有好坏，记录只是为了更了解自己。所有营养数据为估算值。</p>
  </section>
</template>
