<script setup lang="ts">
/**
 * 饮食历史、餐食编辑、体重共用的日期字段；系统 date 弹窗不属于页面DOM，故自建日历。
 * modelValue 是已提交日期；selected 是弹窗临时值，只有 confirm 发出 update:modelValue。
 * 回到今天也只改临时值；取消/Escape/安卓返回不提交，不允许清空必填日期。
 * 日期保存为本地 YYYY-MM-DD；dateAt 用 setFullYear 避开0～99年的1900偏移。
 * AppSheet 负责焦点恢复和返回层；网格支持方向键、Home/End、PageUp/PageDown。
 * 回归：web/tests/DateField.test.ts、tests/e2e/calendar.spec.ts（闰年、跨月、确认/取消）。
 */
import { computed, nextTick, ref, useAttrs, watch } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'
import { dateSchema } from '@shike/shared'
import { localDate } from '../lib/dates'
import AppSheet from './AppSheet.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const attrs = useAttrs(), field = ref<HTMLInputElement | null>(null), calendar = ref<HTMLElement | null>(null)
const opened = ref(false), selected = ref(localDate()), year = ref(new Date().getFullYear()), month = ref(new Date().getMonth() + 1), focusDate = ref('')
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
// setFullYear避开JavaScript对0～99年额外加1900的日期构造规则。
function dateAt(y: number, m: number, d: number) { const value = new Date(0); value.setHours(12, 0, 0, 0); value.setFullYear(y, m - 1, d); return value }
const daysInMonth = (y: number, m: number) => dateAt(y, m + 1, 0).getDate()
const weeks = computed(() => {
  const offset = (dateAt(year.value, month.value, 1).getDay() + 6) % 7
  const days = daysInMonth(year.value, month.value), rows = Math.ceil((offset + days) / 7)
  return Array.from({ length: rows }, (_, week) => Array.from({ length: 7 }, (_, column) => {
    const day = week * 7 + column - offset + 1
    return day < 1 || day > days ? null : { day, value: iso(year.value, month.value, day) }
  }))
})
const chosenLabel = computed(() => { const [y, m, d] = selected.value.split('-').map(Number); return `${y}年${m}月${d}日` })
function showMonth(value: string) { const [y, m] = value.split('-').map(Number); year.value = y!; month.value = m!; focusDate.value = value }
function reset(value: string) { selected.value = dateSchema.safeParse(value).success ? value : localDate(); showMonth(selected.value) }
function open() { if (field.value?.disabled) return; reset(props.modelValue); opened.value = true }
function close() { opened.value = false }
function confirm() {
  // 只有确认合法日期才提交；取消、返回、删除键都不会产生空字符串。
  if (!dateSchema.safeParse(selected.value).success) return
  emit('update:modelValue', selected.value); close()
}
function choose(value: string) { selected.value = value; focusDate.value = value }
function moveMonth(amount: number) {
  const next = dateAt(year.value, month.value + amount, 1)
  if (next.getFullYear() < 1 || next.getFullYear() > 9999) return
  year.value = next.getFullYear(); month.value = next.getMonth() + 1
  focusDate.value = iso(year.value, month.value, Math.min(Number(focusDate.value.slice(8)) || 1, daysInMonth(year.value, month.value)))
}
function changeYear(event: Event) {
  const input = event.target as HTMLInputElement, value = Number(input.value)
  if (!Number.isInteger(value) || value < 1 || value > 9999) { input.value = String(year.value); return }
  year.value = value; updateFocus()
}
function updateFocus() { focusDate.value = iso(year.value, month.value, Math.min(Number(focusDate.value.slice(8)) || 1, daysInMonth(year.value, month.value))) }
function openKey(event: KeyboardEvent) { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); open() } }
async function dayKey(event: KeyboardEvent, value: string) {
  let target: string | undefined
  const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  const [y, m, d] = value.split('-').map(Number)
  if (event.key in moves) target = localDate(dateAt(y!, m!, d! + moves[event.key]!))
  else if (event.key === 'Home') target = iso(y!, m!, 1)
  else if (event.key === 'End') target = iso(y!, m!, daysInMonth(y!, m!))
  else if (event.key === 'PageUp' || event.key === 'PageDown') {
    moveMonth(event.key === 'PageUp' ? -1 : 1); target = focusDate.value
  }
  if (!target || !dateSchema.safeParse(target).success || Number(target.slice(0, 4)) < 1) return
  event.preventDefault(); showMonth(target); await nextTick()
  calendar.value?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus()
}
watch(() => props.modelValue, value => { if (opened.value) reset(value) })
</script>

<template>
  <span class="app-date-field" :class="{ 'compact-date-field': compact }">
    <input ref="field" v-bind="attrs" type="text" :value="modelValue" readonly inputmode="none" role="combobox" aria-haspopup="dialog" :aria-expanded="opened" autocomplete="off" @click="open" @keydown="openKey" />
    <CalendarDays v-if="!compact" class="date-field-icon" :size="17" aria-hidden="true" />
  </span>
  <AppSheet v-if="opened" :open="true" title="选择日期" :subtitle="chosenLabel" test-id="calendar-sheet" @close="close">
    <div ref="calendar" class="calendar-content">
      <div class="calendar-toolbar">
        <button type="button" class="icon-button" aria-label="上个月" data-testid="calendar-previous-month" :disabled="year === 1 && month === 1" @click="moveMonth(-1)"><ChevronLeft :size="20" /></button>
        <label><span class="sr-only">年份</span><input :value="year" type="number" min="1" max="9999" step="1" inputmode="numeric" aria-label="年份" data-testid="calendar-year" @change="changeYear" /></label>
        <label><span class="sr-only">月份</span><select v-model.number="month" aria-label="月份" data-testid="calendar-month" @change="updateFocus"><option v-for="m in 12" :key="m" :value="m">{{ m }}月</option></select></label>
        <button type="button" class="icon-button" aria-label="下个月" data-testid="calendar-next-month" :disabled="year === 9999 && month === 12" @click="moveMonth(1)"><ChevronRight :size="20" /></button>
      </div>
      <div class="calendar-grid" role="grid" :aria-label="`${year}年${month}月`">
        <div class="calendar-week calendar-weekdays" role="row"><span v-for="day in weekdays" :key="day" role="columnheader">{{ day }}</span></div>
        <div v-for="(week, row) in weeks" :key="row" class="calendar-week" role="row">
          <div v-for="(day, column) in week" :key="column" role="gridcell" :aria-selected="day ? day.value === selected : undefined">
            <button v-if="day" type="button" :data-date="day.value" :data-testid="`calendar-day-${day.value}`" :tabindex="day.value === focusDate ? 0 : -1" :aria-label="`${year}年${month}月${day.day}日`" :aria-current="day.value === localDate() ? 'date' : undefined" :class="{ selected: day.value === selected, today: day.value === localDate() }" @click="choose(day.value)" @keydown="dayKey($event, day.value)">{{ day.day }}</button>
          </div>
        </div>
      </div>
      <button type="button" class="text-button calendar-today" data-testid="calendar-today" @click="reset(localDate())">回到今天</button>
    </div>
    <template #footer><div class="calendar-actions"><button type="button" class="button secondary" data-testid="calendar-cancel" @click="close">取消</button><button type="button" class="button primary" data-testid="calendar-confirm" @click="confirm">确定</button></div></template>
  </AppSheet>
</template>

<style scoped>
.app-date-field { display: block; position: relative; width: 100%; }
.app-date-field input { cursor: pointer; padding-right: 36px; }
.date-field-icon { position: absolute; right: 12px; top: calc(50% + 3px); transform: translateY(-50%); pointer-events: none; color: #6a8171; }
.app-date-field.compact-date-field { position: absolute; inset: 0; }
.compact-date-field:focus-within { outline: 3px solid #89b89a; outline-offset: 2px; border-radius: 8px; }
.calendar-content { width: min(100%, 380px); margin: 0 auto; }
.calendar-toolbar { display: grid; grid-template-columns: 38px minmax(72px, 1fr) minmax(64px, .8fr) 38px; align-items: center; gap: 8px; margin-bottom: 16px; }
.calendar-toolbar input, .calendar-toolbar select { margin: 0; font-size: 15px; }
.calendar-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
.calendar-weekdays { padding-bottom: 8px; color: #7b8a7e; text-align: center; font-size: 12px; }
.calendar-week button { width: 100%; min-height: 42px; border: 0; border-radius: 10px; background: transparent; color: #354b3e; font-size: 15px; }
.calendar-week button:hover { background: #edf4ea; }
.calendar-week button.today { box-shadow: inset 0 0 0 1px #87ac94; }
.calendar-week button.selected { background: #367b62; color: #fff; }
.calendar-today { margin-top: 16px; min-height: 40px; }
.calendar-actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>
