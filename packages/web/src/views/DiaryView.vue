<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, CalendarDays, Plus, Sun, Sunrise, Moon, Cookie, Pencil, Trash2, ArrowUpRight, Leaf, Sparkles, Camera, Utensils } from '@lucide/vue'
import { aggregateNutrients, calculateEnergyRange, selectedEstimateOption, type MealRecord, type MealType } from '@shike/shared'
import PlateArt from '../components/PlateArt.vue'
import { dateLabel, localDate, numberLabel, rangeLabel, shiftDate } from '../lib/dates'
import { entryBasis, aggregateEnergyRanges } from '../lib/entries'

const props = defineProps<{ date: string; meals: MealRecord[] }>()
const emit = defineEmits<{ date: [value: string]; add: [type: MealType, start: 'photo' | 'manual']; edit: [record: MealRecord]; remove: [record: MealRecord] }>()
const todayMeals = computed(() => props.meals.filter(record => record.date === props.date).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
const totals = computed(() => aggregateNutrients(todayMeals.value.flatMap(record => record.items)))
const dailyRange = computed(() => aggregateEnergyRanges(todayMeals.value.flatMap(record => record.items)))
const hasMock = computed(() => todayMeals.value.some(record => record.mode === 'mock'))
const groups = [{ type: 'breakfast' as MealType, label: '早餐', subtitle: '一天的温柔开场', icon: Sunrise, color: 'sunrise' }, { type: 'lunch' as MealType, label: '午餐', subtitle: '为午后好好充电', icon: Sun, color: 'sun' }, { type: 'dinner' as MealType, label: '晚餐', subtitle: '用一餐照顾自己', icon: Moon, color: 'moon' }, { type: 'snack' as MealType, label: '加餐', subtitle: '小小补给，刚刚好', icon: Cookie, color: 'snack' }]
const macros = computed(() => [
  { key: 'protein', label: '蛋白质', nutrient: totals.value.proteinG, color: '#4f9d85' },
  { key: 'fat', label: '脂肪', nutrient: totals.value.fatG, color: '#d7b478' },
  { key: 'carbs', label: '碳水', nutrient: totals.value.carbsG, color: '#9caec7' },
])
const nutrientGradient = computed(() => {
  const p = totals.value.proteinG.known * 4, f = totals.value.fatG.known * 9, c = totals.value.carbsG.known * 4
  const total = p + f + c
  if (!total) return 'conic-gradient(#e6ece4 0deg 360deg)'
  const a = p / total * 360, b = (p + f) / total * 360
  return `conic-gradient(#4f9d85 0deg ${a}deg, #d7b478 ${a}deg ${b}deg, #9caec7 ${b}deg 360deg)`
})
function groupRecords(type: MealType) { return todayMeals.value.filter(record => record.mealType === type) }
function mealCalories(records: MealRecord[]) { return aggregateNutrients(records.flatMap(record => record.items)) }
</script>

<template>
  <section class="diary-view">
    <div class="page-heading"><div><span class="eyebrow">每一餐，都是生活的小片刻</span><h1>好好吃饭，<span>慢慢记录。</span></h1><p>不必追求完美，从了解每一餐开始。</p></div><div class="date-switcher"><button class="icon-button" aria-label="前一天" data-testid="previous-date" @click="emit('date', shiftDate(date, -1))"><ChevronLeft :size="18" /></button><label class="date-picker"><CalendarDays :size="17" /><span>{{ date === localDate() ? '今天' : dateLabel(date) }}</span><input :value="date" data-testid="diary-date" type="date" aria-label="选择记录日期" @change="emit('date', ($event.target as HTMLInputElement).value)" /></label><button class="icon-button" aria-label="后一天" data-testid="next-date" @click="emit('date', shiftDate(date, 2))"><ChevronRight :size="18" /></button></div></div>
    <div v-if="date !== localDate()" class="history-caption">{{ dateLabel(date) }} <button class="text-button" @click="emit('date', localDate())">回到今天</button></div>
    <div class="dashboard-top">
      <div class="daily-summary card" data-testid="daily-summary">
        <div class="summary-top"><span class="label-with-icon"><Leaf :size="17" /> {{ totals.incompleteEntries ? '已知部分摄入估算' : date === localDate() ? '今日摄入估算' : '当日摄入估算' }}</span><span class="soft-tag">{{ todayMeals.length }} 条记录</span></div>
        <div class="calories-number" data-testid="daily-calories"><span class="approx">约</span> {{ numberLabel(totals.energyKcal.known) }} <span class="calories-unit">kcal</span></div>
        <p class="summary-subtitle">{{ totals.incompleteEntries ? `${totals.incompleteEntries} 项食物含待补充数据，汇总尚不完整` : todayMeals.length ? '每一份认真记录，都是了解自己的开始' : '今天的美味故事，等你来记录' }}</p>
        <p v-if="dailyRange.hasProfile" class="daily-range" data-testid="daily-range">{{ dailyRange.missing ? '可计算部分区间' : '摄入估算区间' }}约 {{ rangeLabel(dailyRange) }} kcal<span v-if="dailyRange.missing"> · {{ dailyRange.missing }} 项热量待补充</span></p>
        <div v-if="hasMock" class="mock-inline" data-testid="daily-mock">包含模拟记录 · 汇总含示例数据</div>
        <div class="macro-summary"><div class="macro-ring" :style="{ background: nutrientGradient }"><span><Utensils :size="20" /></span></div><div v-for="macro in macros" :key="macro.key" class="macro-stat"><span><i :style="{ background: macro.color }"></i>{{ macro.label }}</span><strong>{{ numberLabel(macro.nutrient.known, 2) }} <small>g</small></strong><small v-if="macro.nutrient.missing" class="amber-text">{{ macro.nutrient.missing }} 项待补充</small><small v-else>估算值</small></div></div>
      </div>
      <div class="capture-hero"><div class="hero-copy"><span class="hero-chip"><Sparkles :size="13" /> AI 辅助记录</span><h2>拍下美味<br />轻松记一餐</h2><p>食物识别交给 AI<br />份量与配料由你确认</p><button class="button primary" data-testid="hero-camera" @click="emit('add', 'lunch', 'photo')"><Camera :size="17" /> 拍照记录 <ArrowUpRight :size="16" /></button></div><PlateArt /></div>
    </div>
    <div class="section-heading diary-heading"><div><h2>这一日的三餐四季</h2><p>每一餐，都值得好好对待</p></div><button class="text-button" data-testid="manual-add" @click="emit('add', 'lunch', 'manual')"><Plus :size="17" /> 手动记录</button></div>
    <div class="meal-grid">
      <article v-for="group in groups" :key="group.type" class="meal-card card" :data-testid="`meal-${group.type}`">
        <header class="meal-card-header"><div class="meal-title"><span class="meal-icon" :class="group.color"><component :is="group.icon" :size="22" stroke-width="1.6" /></span><div><h3>{{ group.label }}</h3><p>{{ group.subtitle }}</p></div></div><span v-if="groupRecords(group.type).length" class="meal-total">约 {{ numberLabel(mealCalories(groupRecords(group.type)).energyKcal.known) }} <small>kcal</small></span><button class="icon-button add-circle" :aria-label="`添加${group.label}`" :data-testid="`add-${group.type}`" @click="emit('add', group.type, 'manual')"><Plus :size="18" /></button></header>
        <div v-if="!groupRecords(group.type).length" class="meal-empty"><span class="empty-line"></span><span>还没有记录，记下这一餐吧</span><button class="text-button" @click="emit('add', group.type, 'photo')">拍照识别 <ArrowUpRight :size="13" /></button></div>
        <div v-for="record in groupRecords(group.type)" :key="record.id" class="meal-record" data-testid="meal-record">
          <div class="record-actions"><span class="record-time">{{ new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}<span v-if="record.mode === 'mock'" class="mock-tag">模拟记录</span><span v-else-if="record.mode === 'live'" class="ai-tag">AI 辅助</span></span><div><button class="icon-button small" aria-label="编辑饮食记录" data-testid="edit-meal" @click="emit('edit', record)"><Pencil :size="14" /></button><button class="icon-button small" aria-label="删除饮食记录" data-testid="delete-meal" @click="emit('remove', record)"><Trash2 :size="14" /></button></div></div>
          <div v-for="item in record.items" :key="item.id" class="record-food"><div><strong>{{ item.name }}</strong><span>{{ item.weightG === null ? '重量待补充' : `${numberLabel(item.weightG, 2)} g` }} · {{ entryBasis(item) }}{{ item.estimateProfile ? ` · ${selectedEstimateOption(item.estimateProfile, item.estimateLevel ?? 'medium').label}` : '' }}</span><p v-if="item.estimateProfile" class="record-range">估算范围约 {{ rangeLabel(calculateEnergyRange(item)) }} kcal · 按中值记账</p></div><span class="food-calories">{{ aggregateNutrients([item]).energyKcal.missing ? '待补充' : `约 ${numberLabel(aggregateNutrients([item]).energyKcal.known)}` }} <small v-if="!aggregateNutrients([item]).energyKcal.missing">kcal</small></span></div>
          <p v-if="mealCalories([record]).incompleteEntries" class="record-warning">{{ mealCalories([record]).incompleteEntries }} 项营养数据待补充 · 当前为已知部分估算</p>
        </div>
      </article>
    </div>
    <p class="daily-footnote"><Leaf :size="14" /> 食物没有好坏，记录只是为了更了解自己。所有营养数据为估算值。</p>
  </section>
</template>
