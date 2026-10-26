<script setup lang="ts">
/**
 * 能量卡“额外活动”旁加号打开独立表单，按已完成个数记录；不是自动生成补偿运动目标。
 * 10/20/30/50是输入快捷键；默认中等强度与3秒/个，预览复用shared公式，不设固定每个热量。
 * 草稿独立于普通运动，同日连续新增可复用体重；切日期清空临时体重，保存成功才加预算。
 * 次数/MET/节奏/体重作为快照保存；有手环累计仍独立计入，可关开关避免同动作重复。
 * 取消只收起弹窗；刷新或离开导致组件销毁后草稿丢失。回归见tests/e2e/pushups.spec.ts。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Check, Plus } from '@lucide/vue'
import { createExercise, exerciseActivities, metEnergy, repetitionMinutes } from '@shike/shared'
import { saveExercise } from '../lib/db'
import { inputNumber } from '../lib/entries'
import { dateLabel, inputNumberLabel, numberLabel } from '../lib/dates'
import AppSheet from './AppSheet.vue'

const props = defineProps<{ date: string; weightKg: number | null }>()
const emit = defineEmits<{ changed: []; notify: [message: string] }>()
const open = ref(false), busy = ref(false), error = ref(''), draft = ref(false)
const count = ref<number | null>(null), weight = ref<number | null>(null), seconds = ref<number | null>(3)
const activityCode = ref('02022'), includeInBudget = ref(true)
const activities = exerciseActivities.filter(activity => activity.unit === 'repetitions')
const preview = computed(() => {
  try {
    const activity = activities.find(item => item.code === activityCode.value)
    return activity && weight.value !== null ? metEnergy(activity.met, weight.value, repetitionMinutes(count.value ?? 0, seconds.value ?? 0)).activeKcal : null
  } catch { return null }
})
function begin() {
  // 快捷入口拥有独立草稿，不覆盖普通运动表单中尚未保存的内容。
  if (!draft.value) { weight.value = props.weightKg ?? weight.value; count.value = null; seconds.value = 3; activityCode.value = '02022'; includeInBudget.value = true }
  draft.value = true; error.value = ''; open.value = true
}
watch(() => props.date, () => { open.value = false; draft.value = false; weight.value = null; error.value = '' })
watch([count, weight, seconds, activityCode], () => { error.value = '' })
async function save() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const record = createExercise({ date: props.date, activityCode: activityCode.value, count: count.value ?? 0, secondsPerRep: seconds.value ?? 0,
      ...(weight.value === null ? {} : { weightKg: weight.value }), includeInBudget: includeInBudget.value })
    await saveExercise(record)
    open.value = false; draft.value = false; emit('changed'); emit('notify', `已记录俯卧撑 ${numberLabel(record.repetitionSnapshot!.count)} 个`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败，输入已保留，请重试。'
    void nextTick(() => {
      const field = !Number.isInteger(count.value) || (count.value ?? 0) < 1 || (count.value ?? 0) > 2000 ? 'pushup-quick-count' : weight.value === null || weight.value <= 0 || weight.value > 600 ? 'pushup-quick-weight' : 'pushup-quick-seconds'
      if (field === 'pushup-quick-seconds') { const details = document.querySelector<HTMLDetailsElement>('[data-testid="pushup-quick-sheet"] details'); if (details) details.open = true }
      document.querySelector<HTMLInputElement>(`[data-testid="${field}"]`)?.focus()
    })
  } finally { busy.value = false }
}
</script>

<template>
  <button type="button" class="energy-extra-add" data-testid="add-pushups" :disabled="busy" aria-label="添加俯卧撑" title="添加俯卧撑" @click="begin"><Plus :size="18" aria-hidden="true" /></button>
  <AppSheet :open="open" title="记录俯卧撑" :subtitle="dateLabel(date)" :busy="busy" test-id="pushup-quick-sheet" @close="open = false">
    <form id="pushup-quick-form" novalidate data-testid="pushup-quick-form" @submit.prevent="save">
      <p class="small-text muted">按已完成个数记录，单独算入额外活动。</p>
      <fieldset class="duration-fieldset"><legend>选个数</legend><div class="duration-presets"><button v-for="amount in [10, 20, 30, 50]" :key="amount" type="button" :class="{ active: count === amount }" :aria-pressed="count === amount" :data-testid="`pushup-quick-${amount}`" :disabled="busy" @click="count = amount">{{ amount }} 个</button></div></fieldset>
      <div class="wellness-form-grid"><label>完成个数<input :value="inputNumberLabel(count)" data-testid="pushup-quick-count" type="number" min="1" max="2000" step="1" inputmode="numeric" :disabled="busy" placeholder="也可自己填写" @input="count = inputNumber($event)" /></label><label>本次体重（kg）<input :value="inputNumberLabel(weight)" data-testid="pushup-quick-weight" type="number" min="1" max="600" step="0.01" inputmode="decimal" :disabled="busy" placeholder="自动带入体重" @input="weight = inputNumber($event)" /></label></div>
      <div class="exercise-preview" data-testid="pushup-quick-preview"><span>活动消耗估算</span><strong>{{ numberLabel(preview) }} <small>kcal</small></strong><p>手环累计之外单独记录</p></div>
      <label class="exercise-budget-toggle"><span><strong>计入额外活动预算</strong><small>保存后更新剩余热量估算</small></span><input v-model="includeInBudget" data-testid="pushup-quick-include-budget" type="checkbox" role="switch" :disabled="busy" /></label>
      <details class="wellness-details"><summary>调整强度与动作节奏</summary><label>运动强度<select v-model="activityCode" data-testid="pushup-quick-intensity" :disabled="busy"><option v-for="activity in activities" :key="activity.code" :value="activity.code">{{ activity.name }}</option></select></label><label>每个动作约（秒）<input :value="inputNumberLabel(seconds)" data-testid="pushup-quick-seconds" type="number" min="1" max="10" step="0.01" inputmode="decimal" :disabled="busy" @input="seconds = inputNumber($event)" /></label><p class="tiny muted">默认3秒／个用于估算动作时长，不含组间休息，可按实际节奏修改。消耗仍是粗估。</p></details>
      <p v-if="error" class="notice danger" role="alert" data-testid="pushup-quick-error">{{ error }}</p>
    </form>
    <template #footer><button type="button" class="text-button" :disabled="busy" @click="open = false">稍后继续</button><button class="button primary" form="pushup-quick-form" data-testid="save-pushups" :disabled="busy"><Check :size="17" />{{ busy ? '正在保存…' : '保存俯卧撑' }}</button></template>
  </AppSheet>
</template>
