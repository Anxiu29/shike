<script setup lang="ts">
/**
 * 三组表单共用一个draft：个人资料→热量计划→日常目标，保存前统一Zod校验并定位错误。
 * App用KeepAlive保存切页时的实例；rebaseDraft仅同步未改字段，changedSettings仅交变化补丁。
 * save捕获submitted，避免等待写入时继续输入的新内容被标成已保存；db事务再按最新设置合并。
 * 当前体重统一用weightOnDate；参考体重是起点，不为它伪造每日称重记录。
 * 安卓返回先回上一组；失活后useBackLayer暂停拦截。草稿不跨刷新/进程回收持久化。
 */
import { useBackLayer } from '../lib/use-back-layer'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Target, UserRound, Save, LoaderCircle, Droplets, Footprints, Flame, ChevronRight, Check } from '@lucide/vue'
import { activityLevels, calorieBudget, defaultDailyGoals, makeDailyPlan, settingsSchema, weightOnDate, type Settings, type WeightRecord, type DailyGoals } from '@shike/shared'
import { saveSettings, type SettingsPatch } from '../lib/db'
import { rebaseDraft } from '../lib/synced-draft'
import { inputNumber } from '../lib/entries'
import { inputNumberLabel, localDate, numberLabel } from '../lib/dates'

const props = defineProps<{ settings: Settings; weights: WeightRecord[] }>()
const emit = defineEmits<{ changed: []; notify: [message: string] }>()
function makeDraft() {
  const profile = props.settings.personalInfo, existingGoals = props.settings.dailyGoals ?? defaultDailyGoals
  return {
    hasProfile: Boolean(profile), sex: profile?.sex ?? 'female', age: profile?.age ?? null,
    heightCm: profile?.heightCm ?? null, startingWeightKg: profile?.startingWeightKg ?? weightOnDate(localDate(), props.weights).weightKg,
    activityLevel: profile?.activityLevel ?? 'sedentary', autoEstimateAllowed: profile?.autoEstimateAllowed ?? true,
    calorieMode: existingGoals.calorieMode, manualCaloriesKcal: existingGoals.manualCaloriesKcal,
    purpose: existingGoals.purpose, adjustmentKcal: existingGoals.adjustmentKcal as number | null,
    waterMl: existingGoals.waterMl, exerciseMinutes: existingGoals.exerciseMinutes,
    cupMl: existingGoals.cupMl as number | null, targetWeightKg: props.settings.targetWeightKg,
  }
}
const draft = reactive(makeDraft()), savedDraft = ref(makeDraft()), step = ref(0)
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(savedDraft.value))
const steps = ['个人资料', '热量计划', '日常目标']
watch([() => props.settings, () => props.weights], () => {
  const latest = makeDraft()
  Object.assign(draft, rebaseDraft(draft, savedDraft.value, latest))
  savedDraft.value = latest
}, { deep: true })
const busy = ref(false), error = ref('')
function validate() {
  const profile = props.settings.personalInfo
  return settingsSchema.safeParse({
    targetWeightKg: draft.targetWeightKg,
    personalInfo: draft.hasProfile ? { sex: draft.sex, age: draft.age, heightCm: draft.heightCm,
      startingWeightKg: draft.startingWeightKg,
      startingDate: profile && profile.startingWeightKg === draft.startingWeightKg ? profile.startingDate : localDate(),
      activityLevel: draft.activityLevel, autoEstimateAllowed: draft.autoEstimateAllowed } : null,
    dailyGoals: { calorieMode: draft.calorieMode, manualCaloriesKcal: draft.calorieMode === 'manual' ? draft.manualCaloriesKcal : null,
      purpose: draft.purpose, adjustmentKcal: draft.purpose === 'maintain' ? draft.adjustmentKcal ?? 200 : draft.adjustmentKcal, waterMl: draft.waterMl,
      exerciseMinutes: draft.exerciseMinutes, cupMl: draft.cupMl },
  })
}
function candidate(): Settings | null { const result = validate(); return result.success ? result.data : null }
const preview = computed(() => { const value = candidate(); return value ? calorieBudget(makeDailyPlan(localDate(), value, props.weights), [], 0) : null })
const currentWeight = computed(() => weightOnDate(localDate(), props.weights, props.settings.personalInfo).weightKg)
const weightRemaining = computed(() => props.settings.targetWeightKg == null || currentWeight.value == null ? null : Math.abs(props.settings.targetWeightKg - currentWeight.value))
function changedSettings(value: Settings): SettingsPatch {
  const changed = (key: keyof typeof draft) => !Object.is(draft[key], savedDraft.value[key])
  const patch: SettingsPatch = {}
  if (changed('targetWeightKg')) patch.targetWeightKg = value.targetWeightKg
  if (changed('hasProfile')) patch.personalInfo = value.personalInfo
  else if (value.personalInfo && draft.hasProfile) {
    const keys = (['sex', 'age', 'heightCm', 'startingWeightKg', 'activityLevel', 'autoEstimateAllowed'] as const).filter(changed)
    if (keys.length) {
      patch.personalInfo = Object.fromEntries(keys.map(key => [key, value.personalInfo![key]]))
      if (keys.includes('startingWeightKg')) patch.personalInfo.startingDate = value.personalInfo.startingDate
    }
  }
  const keys = (['calorieMode', 'manualCaloriesKcal', 'purpose', 'adjustmentKcal', 'waterMl', 'exerciseMinutes', 'cupMl'] as const).filter(changed)
  if (keys.length) {
    patch.dailyGoals = Object.fromEntries(keys.map(key => [key, value.dailyGoals![key]]))
    if (changed('calorieMode')) patch.dailyGoals.manualCaloriesKcal = value.dailyGoals!.manualCaloriesKcal
  }
  return patch
}
async function save() {
  if (busy.value) return
  error.value = ''
  const result = validate()
  if (!result.success) {
    const path = result.error.issues[0]?.path.join('.') ?? ''
    const fields: Record<string, [number, string, string]> = {
      'personalInfo.age': [0, 'profile-age', '请填写 18–100 岁的整数年龄。'],
      'personalInfo.heightCm': [0, 'profile-height', '身高请输入 100–250 cm。'],
      'personalInfo.startingWeightKg': [0, 'profile-weight', '参考体重请输入 20–400 kg。'],
      'dailyGoals.manualCaloriesKcal': [1, 'manual-calorie-goal', '每日预算请输入 1000–6000 kcal。'],
      'dailyGoals.adjustmentKcal': [1, 'calorie-adjustment', '增减热量请输入 0–500 kcal。'],
      'dailyGoals.waterMl': [2, 'water-goal', '饮水目标请输入 250–6000 mL，留空可关闭。'],
      'dailyGoals.cupMl': [2, 'cup-size-goal', '常用杯子容量请输入 50–1500 mL。'],
      'dailyGoals.exerciseMinutes': [2, 'exercise-goal', '运动目标请输入 1–300 分钟，留空可关闭。'],
      'targetWeightKg': [2, 'goal-target-weight', '目标体重请输入 1–600 kg，留空可关闭。'],
    }
    const field = fields[path] ?? (draft.calorieMode === 'manual' && draft.manualCaloriesKcal === null ? fields['dailyGoals.manualCaloriesKcal'] : undefined)
    if (field) { step.value = field[0]; error.value = field[2]; await nextTick(); document.querySelector<HTMLElement>(`[data-testid="${field[1]}"]`)?.focus() }
    else error.value = '请检查填写内容后再保存。'
    return
  }
  const value = result.data
  const submitted = { ...draft }, patch = changedSettings(value)
  busy.value = true
  try { await saveSettings(patch); savedDraft.value = submitted; emit('changed'); emit('notify', '个人资料与目标已保存，今日预算已更新') }
  catch { error.value = '保存失败，原资料与目标保留，请检查本机存储空间。' }
  finally { busy.value = false }
}
function moveStep(value: number) { step.value = value; error.value = '' }
useBackLayer(() => step.value > 0, () => { if (!busy.value) moveStep(step.value - 1) })
function changePurpose(value: DailyGoals['purpose']) { draft.purpose = value }
</script>

<template>
  <section class="goals-view">
    <div class="page-heading"><div><span class="eyebrow">找到适合自己的节奏</span><h1>我的目标</h1><p>资料留在本机，随时可以调整。</p></div><span class="heading-symbol"><Target :size="29" stroke-width="1.5" /></span></div>
    <div class="goal-steps" role="group" aria-label="目标设置分组"><button v-for="(name, index) in steps" :key="name" type="button" :class="{ active: step === index }" :aria-pressed="step === index" :data-testid="`goal-step-${index}`" @click="moveStep(index)"><span>{{ index + 1 }}</span>{{ name }}</button></div>
    <form class="goal-step-form" data-testid="goals-form" novalidate @submit.prevent="save">
      <article v-show="step === 0" class="card wellness-card goal-panel">
        <h2><UserRound :size="21" /> 个人资料</h2>
        <label class="checkbox-label"><input v-model="draft.hasProfile" data-testid="enable-profile" type="checkbox" />填写个人资料，估算每日能量需求</label>
        <div v-if="draft.hasProfile" class="wellness-form-grid">
          <label>公式使用的生理性别<select v-model="draft.sex" data-testid="profile-sex"><option value="female">女</option><option value="male">男</option></select></label>
          <label>年龄（岁）<input :value="inputNumberLabel(draft.age)" data-testid="profile-age" type="number" min="18" max="100" step="1" inputmode="numeric" :required="draft.hasProfile" @input="draft.age = inputNumber($event)" /></label>
          <label>身高（cm）<input :value="inputNumberLabel(draft.heightCm)" data-testid="profile-height" type="number" min="100" max="250" step="0.01" inputmode="decimal" :required="draft.hasProfile" @input="draft.heightCm = inputNumber($event)" /></label>
          <label>初始参考体重（kg）<input :value="inputNumberLabel(draft.startingWeightKg)" data-testid="profile-weight" type="number" min="20" max="400" step="0.01" inputmode="decimal" :required="draft.hasProfile" @input="draft.startingWeightKg = inputNumber($event)" /></label>
          <label class="form-span">通常的全天活动水平<select v-model="draft.activityLevel" data-testid="profile-activity"><option v-for="level in activityLevels" :key="level.id" :value="level.id">{{ level.label }}（系数 {{ level.factor }}）</option></select></label>
          <label class="form-span">自动估算适用情况<select v-model="draft.autoEstimateAllowed" data-testid="profile-estimation"><option :value="true">一般成年人，使用公式参考</option><option :value="false">不使用自动估算，只做记录</option></select></label>
        </div>
        <p v-if="currentWeight !== null" class="tiny muted" data-testid="profile-current-weight">当前体重 {{ numberLabel(currentWeight) }} kg · 与体重页一致；新增称重后优先用于预算，初始参考值保留。</p>
        <p class="tiny muted">预算优先使用参考日期起、记录日当天或之前最近的体重。活动水平已包含平时的运动。自动估算不适用于未成年人、孕哺期或影响代谢的特殊身体状况。</p>
      </article>
      <article v-show="step === 1" class="card wellness-card goal-panel">
        <h2><Flame :size="21" /> 每日热量预算</h2>
        <label>预算方式<select v-model="draft.calorieMode" data-testid="calorie-mode"><option value="auto">根据个人资料估算</option><option value="manual">自己填写每日预算</option></select></label>
        <template v-if="draft.calorieMode === 'auto'">
          <div class="purpose-options" role="group" aria-label="记录目标"><button v-for="option in ([{ id: 'maintain', label: '维持' }, { id: 'lose', label: '减重' }, { id: 'gain', label: '增重' }] as const)" :key="option.id" type="button" class="button" :class="draft.purpose === option.id ? 'primary' : 'secondary'" :data-testid="`purpose-${option.id}`" :aria-pressed="draft.purpose === option.id" @click="changePurpose(option.id)">{{ option.label }}</button></div>
          <label v-if="draft.purpose !== 'maintain'">自己设定每日{{ draft.purpose === 'lose' ? '减少' : '增加' }}的热量（kcal）<input :value="inputNumberLabel(draft.adjustmentKcal)" data-testid="calorie-adjustment" type="number" min="0" max="500" step="0.01" inputmode="decimal" required @input="draft.adjustmentKcal = inputNumber($event)" /></label>
        </template>
        <label v-else>每日预算（kcal）<input :value="inputNumberLabel(draft.manualCaloriesKcal)" data-testid="manual-calorie-goal" type="number" min="1000" max="6000" step="0.01" inputmode="decimal" required @input="draft.manualCaloriesKcal = inputNumber($event)" /></label>
        <div class="budget-preview" data-testid="budget-preview"><span>待保存的预算预览</span><strong>{{ preview?.base == null ? '待补充' : `约 ${numberLabel(preview.base)} kcal` }}</strong><div v-if="preview?.resting != null" class="tiny">静息代谢约 {{ numberLabel(preview.resting) }} kcal · 全天维持约 {{ numberLabel(preview.maintenance) }} kcal（已含通常活动）</div><p v-if="preview?.reason" class="tiny">{{ preview.reason }}</p></div>
        <p class="tiny muted">静息代谢是安静休息时的能量，不能直接当作一天的饮食目标。这里是 Mifflin–St Jeor 公式与活动系数的粗估；调整值由你设定，不预测减重速度或达标日期。支持范围不是适合所有人的推荐范围。</p>
        <details class="wellness-details"><summary>查看计算方式</summary><p class="tiny">静息代谢 = 10 × 体重 kg + 6.25 × 身高 cm − 5 × 年龄 + 性别常数（男 +5，女 −161）。全天维持估算 = 静息代谢 × 活动系数。每日预算按所选目标调整。</p><a class="text-button tiny" href="https://pubmed.ncbi.nlm.nih.gov/2305711/" target="_blank" rel="noopener noreferrer">Mifflin 原研究</a><a class="text-button tiny" href="https://www.niddk.nih.gov/bwp" target="_blank" rel="noopener noreferrer">活动水平参考 · NIDDK</a></details>
      </article>
      <article v-show="step === 2" class="card wellness-card goal-panel">
        <h2><Droplets :size="21" /> 饮水与运动目标</h2>
        <div class="wellness-form-grid"><label>每日饮水目标（mL）<input :value="inputNumberLabel(draft.waterMl)" data-testid="water-goal" type="number" min="250" max="6000" step="0.01" inputmode="decimal" placeholder="按个人需要填写，留空关闭" @input="draft.waterMl = inputNumber($event)" /></label>
          <label>常用杯子容量（mL）<input :value="inputNumberLabel(draft.cupMl)" data-testid="cup-size-goal" type="number" min="50" max="1500" step="0.01" inputmode="decimal" required @input="draft.cupMl = inputNumber($event)" /></label>
          <label class="form-span">每日运动时长目标（分钟）<input :value="inputNumberLabel(draft.exerciseMinutes)" data-testid="exercise-goal" type="number" min="1" max="300" step="0.01" inputmode="decimal" placeholder="例如 30，留空关闭" @input="draft.exerciseMinutes = inputNumber($event)" /></label></div>
        <p class="tiny muted">记录的是喝下的水量，不自动计算食物中的水分；饮水目标由你设定，需限水时遵医嘱。新增运动默认计入额外热量预算，可在记录时关闭；按次数记录的时长包含估算。</p>
      </article>
      <article v-show="step === 2" class="card wellness-card goal-panel">
        <h2><Target :size="21" /> 目标体重</h2>
        <label>目标体重（kg）<input :value="inputNumberLabel(draft.targetWeightKg)" data-testid="goal-target-weight" type="number" min="1" max="600" step="0.01" inputmode="decimal" placeholder="留空关闭体重目标" @input="draft.targetWeightKg = inputNumber($event)" /></label>
        <p v-if="weightRemaining !== null" class="goal-weight-summary" data-testid="weight-goal-summary">当前 {{ numberLabel(currentWeight) }} kg，距已保存目标 {{ numberLabel(weightRemaining) }} kg</p>
        <p class="tiny muted">与体重页使用同一目标。目标仅用于记录对比，不代表医学上的理想体重。</p>
      </article>
      <p v-if="step !== 1 && preview?.reason && draft.hasProfile" class="notice warning" role="status">{{ preview.reason }}</p>
      <div v-if="error" class="notice danger" role="alert" data-testid="goals-error">{{ error }}</div>
      <div class="goal-save-bar"><div><span :class="{ 'has-changes': dirty }">{{ dirty ? '有修改未保存' : '设置已保存' }}</span><small>{{ preview?.base == null ? '可先设置日常目标' : `预算约 ${numberLabel(preview.base)} kcal` }}</small></div><button v-if="step < 2" type="button" class="button secondary goal-next" data-testid="goal-next" @click="moveStep(step + 1)">下一项<ChevronRight :size="16" /></button><button class="button primary" data-testid="save-goals" :disabled="busy || !dirty"><LoaderCircle v-if="busy" class="spin" :size="16" /><Save v-else-if="dirty" :size="16" /><Check v-else :size="16" />{{ busy ? '保存中…' : dirty ? '保存设置' : '已保存' }}</button></div>
      <p class="goal-save-note">保存后更新今日目标，历史日期保留原来的预算。切换页面时，未保存的输入会暂时保留。</p>
    </form>
  </section>
</template>
