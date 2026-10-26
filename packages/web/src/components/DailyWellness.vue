<script setup lang="ts">
/**
 * 日常交互层：饮水快捷加杯/自定义/历史，普通运动与手环累计的预览、保存和撤销。
 * 新增/编辑/删除等await本地事务后通知父层刷新；撤销提交反向写入，不只是改屏幕数字。
 * 设备默认活动口径，累计不填分钟；同日再打开带原记录，保存最新累计值而不是增量。
 * 活动卡统计与预算增加额分开，实际差额委托shared.watchBudgetCredit，勿直接全量相加。
 * 普通运动草稿在本组件内存，快捷俯卧撑在PushupQuickEntry另存草稿；刷新不能恢复草稿。
 * 测试：interaction.spec.ts、device-activity.spec.ts；浏览器模拟不测量真实手环误差。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Droplets, Footprints, Plus, Pencil, Trash2, Check, ChevronRight } from '@lucide/vue'
import { createExercise, createId, defaultDailyGoals, exerciseActivities, exerciseGroups, exerciseActivityTotal, goalProgress, makeDailyPlan, metEnergy, repetitionMinutes, weightOnDate, watchBudgetCredit, type DailyPlan, type ExerciseRecord, type Settings, type WaterRecord, type WeightRecord } from '@shike/shared'
import { db, saveExercise, saveWater } from '../lib/db'
import { inputNumber } from '../lib/entries'
import { dateLabel, inputNumberLabel, numberLabel } from '../lib/dates'
import AppSheet from './AppSheet.vue'
import type { ToastAction } from '../lib/toast'

const props = defineProps<{ date: string; settings: Settings; weights: WeightRecord[]; water: WaterRecord[]; exercises: ExerciseRecord[]; dailyPlans: DailyPlan[] }>()
const emit = defineEmits<{ changed: []; notify: [message: string, action?: ToastAction]; goals: [] }>()
const savedPlan = computed(() => props.dailyPlans.find(plan => plan.date === props.date))
const plan = computed(() => savedPlan.value ?? makeDailyPlan(props.date, props.settings, props.weights))
const goals = computed(() => plan.value.settingsSnapshot.dailyGoals ?? defaultDailyGoals)
const dayWater = computed(() => props.water.filter(record => record.date === props.date).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const dayExercises = computed(() => props.exercises.filter(record => record.date === props.date).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const waterTotal = computed(() => dayWater.value.reduce((sum, record) => sum + record.amountMl, 0))
const exerciseMinutes = computed(() => dayExercises.value.reduce((sum, record) => sum + (record.minutes ?? 0), 0))
const activitySummary = computed(() => exerciseActivityTotal(props.exercises, props.date))
const exerciseEnergy = computed(() => activitySummary.value.activeKcal)
const dailyActivity = computed(() => dayExercises.value.find(record => record.method === 'manual' && record.manualScope === 'day'))
const summaryOnly = computed(() => !!dayExercises.value.length && dayExercises.value.every(record => record.minutes === null))
const pushupCount = computed(() => dayExercises.value.reduce((sum, record) => sum + (record.repetitionSnapshot?.count ?? 0), 0))
const currentWeight = computed(() => weightOnDate(props.date, props.weights, props.settings.personalInfo).weightKg)
const cup = ref(props.settings.dailyGoals?.cupMl ?? 250)
const cupOptions = computed(() => [...new Set([150, 250, 350, 500, props.settings.dailyGoals?.cupMl ?? 250])].sort((a, b) => a - b))
const waterAmount = ref<number | null>(null), editingWater = ref<WaterRecord | null>(null)
const waterInput = ref<HTMLInputElement | null>(null)
const waterBusy = ref(false), waterError = ref('')
const waterSheet = ref(false), exerciseSheet = ref(false), exerciseDraft = ref(false)
const waterFeedback = ref(''), waterUndo = ref<ToastAction | null>(null)
const exerciseOpen = ref(false), exerciseBusy = ref(false), exerciseError = ref(''), editingExercise = ref<ExerciseRecord | null>(null)
const exerciseMethod = ref<'met' | 'manual'>('met'), activityCode = ref<string>(exerciseActivities[0].code), minutes = ref<number | null>(30)
const manualScope = ref<'session' | 'day'>('day')
const isDailyActivity = computed(() => exerciseMethod.value === 'manual' && manualScope.value === 'day')
const count = ref<number | null>(null), secondsPerRep = ref<number | null>(3)
const selectedActivity = computed(() => exerciseActivities.find(item => item.code === activityCode.value))
const byRepetitions = computed(() => exerciseMethod.value === 'met' && selectedActivity.value?.unit === 'repetitions')
const estimatedMinutes = computed(() => { try { return repetitionMinutes(count.value ?? 0, secondsPerRep.value ?? 0) } catch { return null } })
const weight = ref<number | null>(currentWeight.value), manualName = ref(''), manualKcal = ref<number | null>(null), includeInBudget = ref(true)
const exercisePreview = computed(() => {
  if (exerciseMethod.value === 'manual') return manualKcal.value
  const activity = selectedActivity.value, duration = byRepetitions.value ? estimatedMinutes.value : minutes.value
  if (!activity || weight.value == null || duration == null) return null
  try { return metEnergy(activity.met, weight.value, duration).activeKcal } catch { return null }
})
const watchPreview = computed(() => watchBudgetCredit(plan.value, manualKcal.value ?? 0))
function dailyCredit(record: ExerciseRecord) { return watchBudgetCredit(plan.value, record.activeKcal, record.dayBudgetKcal ?? 0).creditKcal }
const exercisePreviewNote = computed(() => {
  if (isDailyActivity.value) {
    if (!includeInBudget.value) return '仅记录手环活动热量，不增加饮食预算'
    if (watchPreview.value.baselineKcal === null) return '缺少可用个人资料，仅记录读数，不增加饮食预算'
    return `常规已预留 ${numberLabel(watchPreview.value.baselineKcal)} kcal · 仅超出部分增加 ${numberLabel(watchPreview.value.creditKcal)} kcal`
  }
  return byRepetitions.value ? `按实际次数、体重和动作节奏粗估 · 约 ${numberLabel(estimatedMinutes.value)} 分钟` : '不包含同段时间的静息消耗'
})
function changedExerciseType() {
  exerciseError.value = ''
  // 同一日期的累计是更新一条汇总；进入该范围时加载已保存的读数与预算选择。
  if (isDailyActivity.value && !editingExercise.value && dailyActivity.value) {
    manualKcal.value = dailyActivity.value.activeKcal
    includeInBudget.value = dailyActivity.value.includeInBudget
  }
  // 从按次数切回计时，不能把不足一分钟的内部估时直接套作用户填写的运动时长。
  if (!byRepetitions.value && (minutes.value === null || minutes.value < 1 || Math.abs(minutes.value * 100 - Math.round(minutes.value * 100)) > 1e-7)) minutes.value = 30
}
watch(manualKcal, () => { exerciseError.value = '' })
watch(() => props.settings.dailyGoals?.cupMl, value => { cup.value = value ?? 250 })
watch(() => props.date, () => { waterSheet.value = false; exerciseSheet.value = false; exerciseDraft.value = false; waterAmount.value = null; editingWater.value = null; exerciseOpen.value = false; editingExercise.value = null; waterError.value = ''; exerciseError.value = ''; waterFeedback.value = ''; waterUndo.value = null })
async function addWater(amount = waterAmount.value, quick = false) {
  if (waterBusy.value) return
  waterError.value = ''
  if (amount == null || !Number.isFinite(amount) || amount < 1 || amount > 3000) { waterError.value = '每条饮水量请输入 1–3000 mL，最多两位小数。'; return }
  waterBusy.value = true
  const now = new Date().toISOString(), previous = quick ? null : editingWater.value
  try {
    const record = { id: previous?.id ?? createId(), date: props.date, amountMl: amount, createdAt: previous?.createdAt ?? now, updatedAt: now }
    await saveWater(record)
    editingWater.value = null; waterAmount.value = null; emit('changed')
    announceWater(previous ? '饮水记录已更新' : `已记录 ${numberLabel(amount)} mL 饮水`, async () => { if (previous) await saveWater(previous); else await db.water.delete(record.id) })
    if (quick) waterSheet.value = false
  } catch { waterError.value = '保存失败，饮水输入保留。请检查数值与本机存储。' }
  finally { waterBusy.value = false }
}
async function editWater(record: WaterRecord) { editingWater.value = record; waterAmount.value = record.amountMl; waterError.value = ''; await nextTick(); waterInput.value?.focus() }
async function removeWater(record: WaterRecord) {
  if (waterBusy.value) return
  waterBusy.value = true
  try { await db.water.delete(record.id); if (editingWater.value?.id === record.id) { editingWater.value = null; waterAmount.value = null }; emit('changed'); announceWater('饮水记录已删除', () => saveWater(record)) }
  catch { waterError.value = '删除失败，请重试。' }
  finally { waterBusy.value = false }
}
function openExercise(record?: ExerciseRecord) {
  exerciseSheet.value = true
  if (!record && exerciseDraft.value) { exerciseOpen.value = true; return }
  exerciseDraft.value = true
  editingExercise.value = record ?? null; exerciseMethod.value = record?.method === 'manual' ? 'manual' : 'met'; activityCode.value = record?.activityCode ?? exerciseActivities[0].code
  manualScope.value = record?.method === 'manual' ? record.manualScope ?? 'session' : 'day'
  count.value = record?.repetitionSnapshot?.count ?? null; secondsPerRep.value = record?.repetitionSnapshot?.secondsPerRep ?? 3
  minutes.value = record?.minutes ?? 30; weight.value = record?.weightKg ?? currentWeight.value
  manualName.value = record?.method === 'manual' ? record.name : ''; manualKcal.value = record?.method === 'manual' ? record.activeKcal : null
  // 新记录默认计入；编辑历史和继续草稿时保留用户原来选择。
  includeInBudget.value = record?.includeInBudget ?? true; exerciseError.value = ''; exerciseOpen.value = true
}
async function persistExercise() {
  if (exerciseBusy.value) return
  exerciseError.value = ''; exerciseBusy.value = true
  try {
    const record = createExercise({ date: props.date, minutes: minutes.value ?? 0, includeInBudget: includeInBudget.value,
      ...(exerciseMethod.value === 'met' ? { activityCode: activityCode.value, ...(weight.value == null ? {} : { weightKg: weight.value }) } : { manualName: manualName.value, manualActiveKcal: manualKcal.value ?? undefined, manualScope: manualScope.value }),
      ...(byRepetitions.value ? { count: count.value ?? 0, secondsPerRep: secondsPerRep.value ?? 0 } : {}),
      // 手环输入默认不含静息；固定保存活动口径，兼容已有v8快照与备份。
      ...(isDailyActivity.value ? { deviceReading: 'active' as const } : {}),
    }, editingExercise.value ?? (isDailyActivity.value ? dailyActivity.value : undefined))
    await saveExercise(record); exerciseOpen.value = false; exerciseSheet.value = false; exerciseDraft.value = false; editingExercise.value = null; emit('changed'); emit('notify', '运动记录已保存')
  } catch (cause) {
    exerciseError.value = cause instanceof Error && cause.name !== 'DexieError' ? cause.message : '保存失败，运动草稿保留，请检查本机存储。'
    if (isDailyActivity.value) void nextTick(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="exercise-manual-kcal"]'); element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'center' })
    })
  }
  finally { exerciseBusy.value = false }
}
async function removeExercise(record: ExerciseRecord) {
  if (exerciseBusy.value) return
  exerciseBusy.value = true
  try { await db.exercises.delete(record.id); if (editingExercise.value?.id === record.id) exerciseOpen.value = false; exerciseSheet.value = false; exerciseDraft.value = false; emit('changed'); emit('notify', '运动记录已删除', { label: '撤销', run: async () => { await saveExercise(record); emit('changed') } }) }
  catch { exerciseError.value = '删除失败，请重试。' }
  finally { exerciseBusy.value = false }
}
function timeLabel(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }

function announceWater(message: string, operation: () => Promise<void>) {
  let used = false
  const action: ToastAction = { label: '撤销', run: async () => {
    if (used) return
    used = true
    try { await operation(); emit('changed'); waterFeedback.value = '已撤销'; waterUndo.value = null }
    catch (error) { used = false; throw error }
  } }
  waterFeedback.value = message; waterUndo.value = action; emit('notify', message, action)
}
async function undoWater() {
  if (!waterUndo.value || waterBusy.value) return
  waterBusy.value = true
  try { await waterUndo.value.run(); emit('notify', '已撤销') } catch { waterError.value = '撤销失败，请重试。' }
  finally { waterBusy.value = false }
}
function closeExercise() { exerciseSheet.value = false }
function exerciseHistory() { exerciseOpen.value = false; exerciseSheet.value = true }
function openExtraExercise() { const resume = exerciseDraft.value; openExercise(); if (!resume) { activityCode.value = '02022'; includeInBudget.value = true } }
defineExpose({ openExtraExercise })
</script>

<template>
  <div class="habit-cards" data-testid="daily-wellness">
    <article class="habit-card water-habit" data-testid="water-card">
      <div class="habit-heading"><span class="habit-icon"><Droplets :size="20" /></span><h2>饮水</h2><button class="habit-more" aria-label="饮水容量与记录" data-testid="open-water" @click="waterSheet = true"><ChevronRight :size="19" /></button></div>
      <div class="habit-value"><strong data-testid="water-total">{{ numberLabel(waterTotal) }}</strong><span>mL</span></div>
      <div v-if="goals.waterMl" class="goal-meter" role="progressbar" aria-label="饮水目标进度" :aria-valuenow="Math.round(goalProgress(waterTotal, goals.waterMl))" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${goalProgress(waterTotal, goals.waterMl)}%` }"></span></div>
      <p class="habit-caption">{{ goals.waterMl ? waterTotal >= goals.waterMl ? '已达到设定目标' : `目标 ${numberLabel(goals.waterMl)} mL` : '按自己的节奏补水' }}</p>
      <button class="habit-action" data-testid="add-cup" :disabled="waterBusy" @click="addWater(cup, true)"><Plus :size="16" />{{ numberLabel(cup) }} mL</button>
      <p v-if="waterError && !waterSheet" class="habit-error" role="alert">{{ waterError }}</p>
    </article>
    <article class="habit-card exercise-habit" data-testid="exercise-card">
      <div class="habit-heading"><span class="habit-icon"><Footprints :size="20" /></span><h2>运动</h2><button class="habit-more" aria-label="查看运动记录" data-testid="open-exercise-history" @click="exerciseHistory"><ChevronRight :size="19" /></button></div>
      <div class="habit-value"><strong data-testid="exercise-minutes-total">{{ summaryOnly ? "—" : numberLabel(exerciseMinutes) }}</strong><span>分钟</span></div>
      <div v-if="goals.exerciseMinutes && !summaryOnly" class="goal-meter exercise-meter" role="progressbar" aria-label="运动目标进度" :aria-valuenow="Math.round(goalProgress(exerciseMinutes, goals.exerciseMinutes))" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${goalProgress(exerciseMinutes, goals.exerciseMinutes)}%` }"></span></div>
      <p class="habit-caption" data-testid="exercise-calories-total">活动消耗约 {{ numberLabel(exerciseEnergy) }} kcal</p><p v-if="activitySummary.daily" class="tiny muted" data-testid="daily-activity-note">{{ activitySummary.independentKcal ? '手环累计 + 俯卧撑单独统计' : '按手环累计统计，普通运动不重复加' }}{{ summaryOnly ? " · 未记录分钟" : "" }}</p><p v-if="pushupCount" class="tiny muted" data-testid="pushup-count-total">俯卧撑 {{ numberLabel(pushupCount) }} 个 · 独立额外活动</p>
      <button class="habit-action" data-testid="add-exercise" :disabled="exerciseBusy" @click="openExercise()"><Plus :size="16" />{{ exerciseDraft ? '继续填写' : '记运动' }}</button>
    </article>
    <AppSheet :open="waterSheet" title="喝水记录" :subtitle="dateLabel(date)" :busy="waterBusy" test-id="water-sheet" @close="waterSheet = false">
      <div class="sheet-summary"><Droplets :size="25" /><strong>{{ numberLabel(waterTotal) }} <small>mL</small></strong><span>{{ goals.waterMl ? `目标 ${numberLabel(goals.waterMl)} mL` : '饮水量按实际记录' }}</span></div>
      <h3 class="sheet-section-label">选择杯子容量</h3>
      <div class="cup-options" role="group" aria-label="选择杯子容量"><button v-for="size in cupOptions" :key="size" type="button" :class="{ active: cup === size }" :aria-pressed="cup === size" :data-testid="`cup-${size}`" :disabled="waterBusy" @click="cup = size">{{ numberLabel(size) }}<small>mL</small></button></div>
      <button class="button primary water-add" data-testid="sheet-add-cup" :disabled="waterBusy" @click="addWater(cup, true)"><Plus :size="17" />加一杯 · {{ numberLabel(cup) }} mL</button>
      <form class="water-custom" @submit.prevent="addWater()"><label>{{ editingWater ? '修改本次饮水（mL）' : '自定义饮水量（mL）' }}<input ref="waterInput" :value="inputNumberLabel(waterAmount)" data-testid="custom-water" type="number" min="1" max="3000" step="0.01" inputmode="decimal" :disabled="waterBusy" required placeholder="输入实际喝水量" @input="waterAmount = inputNumber($event)" /></label><button class="button secondary" data-testid="save-custom-water" :disabled="waterBusy"><Check :size="17" />{{ editingWater ? '保存' : '添加' }}</button></form>
      <button v-if="editingWater" class="text-button" :disabled="waterBusy" @click="editingWater = null; waterAmount = null">取消修改</button>
      <div v-if="waterFeedback" class="sheet-feedback" role="status"><span>{{ waterFeedback }}</span><button v-if="waterUndo" class="text-button" :disabled="waterBusy" data-testid="sheet-undo-water" @click="undoWater">撤销</button></div>
      <p v-if="waterError" class="notice danger" role="alert">{{ waterError }}</p>
      <div class="sheet-list-heading"><h3>当日记录</h3><span>{{ dayWater.length }} 次</span></div>
      <p v-if="!dayWater.length" class="sheet-empty">还没有饮水记录，先记一杯吧。</p>
      <div class="wellness-history"><div v-for="record in dayWater" :key="record.id" class="wellness-row" data-testid="water-record"><span class="muted">{{ timeLabel(record.createdAt) }}</span><strong>{{ numberLabel(record.amountMl) }} mL</strong><button class="icon-button" data-testid="edit-water" :disabled="waterBusy" aria-label="编辑饮水记录" @click="editWater(record)"><Pencil :size="17" /></button><button class="icon-button" data-testid="delete-water" :disabled="waterBusy" aria-label="删除饮水记录" @click="removeWater(record)"><Trash2 :size="17" /></button></div></div>
      <p class="tiny muted sheet-note">这里只记录饮水量；含糖饮料的热量请另记饮食。常用杯子容量可在目标页修改。</p>
    </AppSheet>
    <AppSheet :open="exerciseSheet" :title="exerciseOpen ? editingExercise ? '编辑运动' : '记录运动' : '运动记录'" :subtitle="dateLabel(date)" :busy="exerciseBusy" test-id="exercise-sheet" @close="closeExercise">
      <form v-if="exerciseOpen" id="exercise-entry-form" class="exercise-form" data-testid="exercise-form" novalidate @submit.prevent="persistExercise">
        <label>消耗记录方式<select v-model="exerciseMethod" data-testid="exercise-method" :disabled="exerciseBusy" @change="changedExerciseType"><option value="met">按项目估算 · 分钟／个数</option><option value="manual">填写活动热量 · 单次／全天</option></select></label>
        <label v-if="exerciseMethod === 'met'">运动项目<select v-model="activityCode" data-testid="exercise-activity" :disabled="exerciseBusy" @change="changedExerciseType"><optgroup v-for="group in exerciseGroups" :key="group" :label="group"><option v-for="activity in exerciseActivities.filter(item => item.category === group)" :key="activity.code" :value="activity.code">{{ activity.name }}</option></optgroup></select></label>
        <label v-else>记录范围<select v-model="manualScope" data-testid="exercise-scope" :disabled="exerciseBusy" @change="changedExerciseType"><option value="day">当天累计活动</option><option value="session">单次运动</option></select></label>
        <p v-if="isDailyActivity" class="tiny muted" data-testid="daily-activity-help">填写手环当天累计的活动热量，默认不含静息消耗；只有高于常规活动估算的差额才增加预算。</p>
        <p v-if="isDailyActivity && dailyActivity" class="notice subtle" data-testid="daily-activity-update">当天已有累计 {{ numberLabel(dailyActivity.activeKcal) }} kcal，本次保存会更新原值，不按新增差额叠加。</p>
        <label v-if="exerciseMethod === 'manual' && !isDailyActivity">运动名称<input v-model="manualName" data-testid="exercise-name" maxlength="80" :disabled="exerciseBusy" required placeholder="例如：游泳 / 力量训练" /></label>
        <fieldset v-if="!byRepetitions && !isDailyActivity" class="duration-fieldset"><legend>运动时长</legend><div class="duration-presets"><button v-for="duration in [15, 30, 45, 60]" :key="duration" type="button" :class="{ active: minutes === duration }" :aria-pressed="minutes === duration" :data-testid="`duration-${duration}`" :disabled="exerciseBusy" @click="minutes = duration">{{ duration }} 分钟</button></div></fieldset>
        <fieldset v-if="byRepetitions" class="duration-fieldset"><legend>已完成的个数</legend><div class="duration-presets"><button v-for="amount in [10, 20, 30, 50]" :key="amount" type="button" :class="{ active: count === amount }" :aria-pressed="count === amount" :data-testid="`repetitions-${amount}`" :disabled="exerciseBusy" @click="count = amount">{{ amount }} 个</button></div></fieldset><div class="wellness-form-grid"><label v-if="byRepetitions">俯卧撑（个）<input :value="inputNumberLabel(count)" data-testid="exercise-count" type="number" min="1" max="2000" step="1" inputmode="numeric" :disabled="exerciseBusy" required placeholder="填写实际完成个数" @input="count = inputNumber($event)" /></label><label v-else-if="!isDailyActivity">分钟<input :value="inputNumberLabel(minutes)" data-testid="exercise-duration" type="number" min="1" max="600" step="0.01" inputmode="decimal" :disabled="exerciseBusy" required @input="minutes = inputNumber($event)" /></label><label v-if="exerciseMethod === 'met'">本次体重（kg）<input :value="inputNumberLabel(weight)" data-testid="exercise-weight" type="number" min="1" max="600" step="0.01" inputmode="decimal" :disabled="exerciseBusy" required placeholder="填写本次体重" @input="weight = inputNumber($event)" /></label><label v-else :class="{ 'daily-activity-value': isDailyActivity }">{{ isDailyActivity ? '手环当天活动热量（kcal）' : '活动消耗（kcal）' }}<input :value="inputNumberLabel(manualKcal)" data-testid="exercise-manual-kcal" type="number" min="0" max="20000" step="0.01" inputmode="decimal" :disabled="exerciseBusy" required @input="manualKcal = inputNumber($event)" /></label></div>
        <details v-if="byRepetitions" class="wellness-details repetition-timing"><summary>动作节奏 · 约 {{ numberLabel(secondsPerRep) }} 秒／个</summary><label>每个动作约（秒）<input :value="inputNumberLabel(secondsPerRep)" data-testid="exercise-seconds-per-rep" type="number" min="1" max="10" step="0.01" inputmode="decimal" :disabled="exerciseBusy" @input="secondsPerRep = inputNumber($event)" /></label><p class="tiny muted">默认3秒／个是可修改的估时假设，不是固定标准。不包含组间休息，实际时长约 {{ numberLabel(estimatedMinutes) }} 分钟。</p></details><div class="exercise-preview" data-testid="exercise-preview"><span>{{ isDailyActivity ? "手环活动热量" : "活动消耗估算" }}</span><strong>{{ numberLabel(exercisePreview) }} <small>kcal</small></strong><p>{{ exercisePreviewNote }}</p></div>
        <label class="exercise-budget-toggle"><span><strong>{{ isDailyActivity ? "仅高于常规时增加预算" : "计入额外热量预算" }}</strong><small>{{ isDailyActivity ? "只计超出的差额，不叠加全天读数" : "保存后更新当天热量预算" }}</small></span><input v-model="includeInBudget" data-testid="exercise-include-budget" type="checkbox" role="switch" :disabled="exerciseBusy" /></label>
        <details class="wellness-details"><summary>消耗是如何计算的？</summary><p class="tiny">MET 估算已扣除静息部分。<template v-if="byRepetitions">俯卧撑采用含俯卧撑的徒手体操强度，次数×每个动作秒数换算为活动时长；同样个数的实际消耗会有差异，不是固定kcal／个。</template>设备／手动模式可填单次或当天累计的活动热量，不要填包含静息的总消耗。开启计入时，使用当天累计活动热量，加上单独记录的俯卧撑；其他同日运动不再叠加。项目来自 <a href="https://pacompendium.com/" target="_blank" rel="noopener noreferrer">2024 Compendium</a>，个体差异较大。</p></details>
      </form>
      <template v-else><div class="sheet-summary"><Footprints :size="25" /><strong>{{ summaryOnly ? "—" : numberLabel(exerciseMinutes) }} <small>分钟</small></strong><span>活动消耗约 {{ numberLabel(exerciseEnergy) }} kcal</span></div><button class="button primary full" data-testid="sheet-add-exercise" @click="openExercise()"><Plus :size="17" />添加一条运动</button><p v-if="!dayExercises.length" class="sheet-empty">散步、骑行，都可以从一条记录开始。</p><div class="wellness-history"><div v-for="record in dayExercises" :key="record.id" class="wellness-row exercise-row" data-testid="exercise-record"><div><strong>{{ record.name }}</strong><p class="tiny muted">{{ record.manualScope === "day" ? "当天累计 · 未记时" : record.repetitionSnapshot ? numberLabel(record.repetitionSnapshot.count) + " 个" : numberLabel(record.minutes) + " 分钟" }} · 活动约 {{ numberLabel(record.activeKcal) }} kcal · {{ record.method !== 'manual' ? `按 ${numberLabel(record.weightKg)} kg 估算` : '设备输入' }}<span v-if="record.includeInBudget"> · {{ record.manualScope === "day" ? "超出常规计入 " + numberLabel(dailyCredit(record)) + " kcal" : "计入预算" }}</span></p><p v-if="record.repetitionSnapshot" class="tiny muted">按 {{ numberLabel(record.repetitionSnapshot.secondsPerRep) }} 秒／个估时约 {{ numberLabel(record.minutes) }} 分钟，不含组间休息</p></div><button class="icon-button" data-testid="edit-exercise" :disabled="exerciseBusy" aria-label="编辑运动记录" @click="openExercise(record)"><Pencil :size="17" /></button><button class="icon-button" data-testid="delete-exercise" :disabled="exerciseBusy" aria-label="删除运动记录" @click="removeExercise(record)"><Trash2 :size="17" /></button></div></div></template>
      <p v-if="exerciseError" class="notice danger" role="alert" data-testid="exercise-error">{{ exerciseError }}</p>
      <template v-if="exerciseOpen" #footer><button class="text-button" :disabled="exerciseBusy" @click="closeExercise">稍后继续</button><button class="button primary" form="exercise-entry-form" data-testid="save-exercise" :disabled="exerciseBusy">{{ exerciseBusy ? '正在保存…' : editingExercise ? '保存修改' : '保存运动' }}</button></template>
    </AppSheet>
  </div>
</template>
