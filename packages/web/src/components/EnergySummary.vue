<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, ChevronDown, Flame, Leaf } from '@lucide/vue'
import { aggregateNutrients, calorieBudget, makeDailyPlan, weightOnDate, type DailyPlan, type ExerciseRecord, type MealRecord, type Settings, type WeightRecord } from '@shike/shared'
import { aggregateEnergyRanges } from '../lib/entries'
import { numberLabel, rangeLabel } from '../lib/dates'
import PushupQuickEntry from './PushupQuickEntry.vue'
const props = defineProps<{ date: string; meals: MealRecord[]; settings: Settings; weights: WeightRecord[]; exercises: ExerciseRecord[]; dailyPlans: DailyPlan[] }>()
const emit = defineEmits<{ goals: []; extraExercise: []; changed: []; notify: [message: string] }>()
const currentWeight = computed(() => weightOnDate(props.date, props.weights, props.settings.personalInfo).weightKg)
function savedView(): 'consumed' | 'remaining' | null { try { const value = localStorage.getItem('shike-energy-view-v1'); return value === 'consumed' || value === 'remaining' ? value : null } catch { return null } }
const chosenView = ref(savedView())
const view = computed(() => chosenView.value ?? (budget.value.total === null ? 'consumed' : 'remaining'))
function changeView(value: 'consumed' | 'remaining') { chosenView.value = value; try { localStorage.setItem('shike-energy-view-v1', value) } catch { /* 仍可在本次会话切换。 */ } }
const entries = computed(() => props.meals.flatMap(record => record.items))
const totals = computed(() => aggregateNutrients(entries.value))
const energyValue = computed(() => entries.value.length && totals.value.energyKcal.missing === entries.value.length ? '—' : numberLabel(totals.value.energyKcal.known))
const range = computed(() => aggregateEnergyRanges(entries.value))
const savedPlan = computed(() => props.dailyPlans.find(plan => plan.date === props.date))
const budget = computed(() => calorieBudget(savedPlan.value ?? makeDailyPlan(props.date, props.settings, props.weights), props.exercises, totals.value.energyKcal.known, totals.value.energyKcal.missing))
const hasMock = computed(() => props.meals.some(record => record.mode === 'mock'))
const progress = computed(() => budget.value.total && !totals.value.energyKcal.missing ? Math.min(100, totals.value.energyKcal.known / budget.value.total * 100) : 0)
const macros = computed(() => [ { label: '蛋白质', value: totals.value.proteinG, color: '#428d76' }, { label: '脂肪', value: totals.value.fatG, color: '#bd955b' }, { label: '碳水', value: totals.value.carbsG, color: '#7899b4' } ])
</script>
<template>
  <article class="card energy-summary" data-testid="daily-summary">
    <div data-testid="calorie-budget">
      <div class="energy-heading"><span><Flame :size="17" /> 当日能量</span><div class="energy-view-toggle" role="group" aria-label="热量显示方式"><button type="button" data-testid="energy-view-consumed" :aria-pressed="view === 'consumed'" @click="changeView('consumed')">已摄入</button><button type="button" data-testid="energy-view-remaining" :aria-pressed="view === 'remaining'" @click="changeView('remaining')">剩余</button></div><button class="text-button energy-goals" data-testid="open-goals" :aria-label="budget.total === null ? '设置目标' : '调整目标'" @click="emit('goals')"><span>{{ budget.total === null ? '设置目标' : '调整目标' }}</span><ArrowUpRight :size="16" /></button></div>

      <div class="energy-hero">
        <div v-if="view === 'remaining'" class="energy-main"><p>{{ budget.total === null ? '尚未设置热量预算' : budget.remaining === null ? '剩余额度待补充' : budget.remaining < 0 ? '已超出预算估算' : '剩余热量估算' }}</p><strong data-testid="remaining-calories">{{ budget.remaining === null ? '—' : numberLabel(Math.abs(budget.remaining)) }}<small>kcal</small></strong></div>
        <div v-else class="energy-main"><p>{{ totals.energyKcal.missing ? '已知部分摄入估算' : '已记录摄入估算' }}</p><strong data-testid="daily-calories">{{ energyValue }}<small>kcal</small></strong></div>
        <div class="energy-ring" :style="{ '--energy-progress': `${progress * 3.6}deg` }" :aria-label="budget.total ? `已记录摄入占预算约 ${numberLabel(progress, 0)}%` : '尚未设置热量预算'"><span><b v-if="budget.total && !totals.energyKcal.missing">{{ numberLabel(progress, 0) }}<small>%</small></b><Leaf v-else :size="28" stroke-width="1.4" /><small>{{ budget.total ? totals.energyKcal.missing ? '待补充' : '已摄入' : '慢慢记录' }}</small></span></div>
      </div>
      <div class="energy-facts"><div><span>{{ view === 'consumed' ? '剩余估算' : '摄入估算' }}</span><strong v-if="view === 'remaining'" data-testid="daily-calories">{{ energyValue }} <small>kcal</small></strong><strong v-else data-testid="remaining-calories">{{ budget.remaining === null ? '—' : budget.remaining < 0 ? '超出 ' + numberLabel(-budget.remaining) : numberLabel(budget.remaining) }} <small>kcal</small></strong></div><div><span>基础预算</span><strong v-if="budget.base !== null" data-testid="base-calorie-budget">约 {{ numberLabel(budget.base) }} <small>kcal</small></strong><button v-else class="text-button" @click="emit('goals')">去设置 <ArrowUpRight :size="13" /></button></div><div><div class="energy-extra-label"><span>额外活动</span><PushupQuickEntry :date="date" :weight-kg="currentWeight" @changed="emit('changed')" @notify="emit('notify', $event)" /></div><strong data-testid="exercise-budget-credit">+ {{ numberLabel(budget.extra) }} <small>kcal</small></strong></div></div>
      <div class="energy-macros"><div v-for="macro in macros" :key="macro.label"><span><i :style="{ background: macro.color }"></i>{{ macro.label }}</span><strong>{{ entries.length && macro.value.missing === entries.length ? '—' : numberLabel(macro.value.known) }} <small>g</small></strong><small v-if="macro.value.missing" class="amber-text">{{ macro.value.missing }} 项待补充</small></div></div>
      <div v-if="budget.remaining !== null && budget.remaining < 0" class="energy-extra-action" data-testid="over-budget-exercise"><p>今天超出约 {{ numberLabel(-budget.remaining) }} kcal。按实际完成量记运动，不必一次性抵消。</p><button type="button" class="text-button" data-testid="record-extra-exercise" @click="emit('extraExercise')">记录额外运动 <ArrowUpRight :size="14" /></button></div>
      <p v-if="range.hasProfile" class="energy-range" data-testid="daily-range">{{ range.missing ? '可计算部分区间' : '摄入估算区间' }}约 {{ rangeLabel(range) }} kcal<span v-if="range.missing"> · {{ range.missing }} 项热量待补充</span></p>
      <p v-if="totals.energyKcal.missing" class="energy-alert" data-testid="budget-incomplete">还有 {{ totals.energyKcal.missing }} 项食物热量未补全{{ budget.total !== null ? '，暂不显示剩余额度' : '' }}。</p>
      <p v-if="budget.activitySummary.incomplete" class="energy-alert">全天活动中用于增加预算的热量待确认，暂不显示完整剩余额度。</p>
      <p v-if="budget.activitySummary.daily && !budget.activitySummary.incomplete" class="energy-range" data-testid="daily-budget-summary">手环活动 {{ numberLabel(budget.activitySummary.dailyReadingKcal) }} kcal，<template v-if="budget.activitySummary.estimatedActivityKcal !== null">常规已预留 {{ numberLabel(budget.activitySummary.estimatedActivityKcal) }} kcal，仅超出部分增加 {{ numberLabel(budget.activitySummary.dailyKcal) }} kcal</template><template v-else>缺少可用个人资料，暂不增加预算</template><template v-if="budget.activitySummary.independentKcal">；俯卧撑另计 {{ numberLabel(budget.activitySummary.independentKcal) }} kcal</template>。{{ budget.activitySummary.estimatedActivityKcal === null ? "已勾选的单次额外运动继续计入" : "普通明细不重复叠加" }}。</p>
      <p v-if="hasMock" class="mock-inline" data-testid="daily-mock">包含模拟记录 · 汇总含示例数据</p>
      <p v-if="budget.total === null && settings.personalInfo" class="energy-alert">{{ budget.reason }}</p>
      <details class="energy-explanation" data-testid="budget-details"><summary>估算说明 <ChevronDown :size="14" /></summary><div><p v-if="budget.reason">{{ budget.reason }}</p><p>{{ savedPlan ? '使用已保存的当日资料与目标' : '按当前资料预览，记录后保存当日目标' }}<template v-if="budget.resting !== null"> · 静息代谢约 {{ numberLabel(budget.resting) }} kcal · 全天维持约 {{ numberLabel(budget.maintenance) }} kcal（已含通常活动）</template>。</p><p>剩余估算 = 基础预算 + 选定额外活动 − 已记录摄入。活动保存后按计入开关更新，有可用常规估算和手环累计时，只补高于常规的差额，并保留独立俯卧撑；普通明细不重复相加。实际需求会随身体状况与活动变化。</p></div></details>
    </div>
  </article>
</template>
