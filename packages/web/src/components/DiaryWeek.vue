<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { diaryMonth, diaryWeek } from '../lib/diary-shortcuts'
import { diaryIntake, type DiaryIntakeData } from '../lib/diary-intake'
import { dateLabel, localDate, numberLabel, shiftDate } from '../lib/dates'
import { useBackLayer } from '../lib/use-back-layer'

const props = defineProps<DiaryIntakeData & { date: string }>()
const emit = defineEmits<{ select: [date: string] }>()
const expanded = ref(false), month = ref(props.date.slice(0, 7)), calendar = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null), weekGrid = ref<HTMLElement | null>(null), monthPanel = ref<HTMLElement | null>(null)
const dragging = ref(false), settling = ref(false), dragHeight = ref<number | null>(null)
let weekHeight = 0, monthHeight = 0, startHeight = 0, startProgress = 0, dragDistance = 0, animation: number | undefined
const progress = computed(() => dragHeight.value !== null && monthHeight > weekHeight
  ? Math.max(0, Math.min(1, (dragHeight.value - weekHeight) / (monthHeight - weekHeight))) : expanded.value ? 1 : 0)
const monthVisible = computed(() => expanded.value || dragging.value || settling.value)
useBackLayer(() => expanded.value || (monthVisible.value && progress.value > 0), () => hideMonth(false))
watch(() => props.date, value => { month.value = value.slice(0, 7) })
const weekDays = computed(() => diaryWeek(props.date).map(day => ({ ...day, column: 0, intake: diaryIntake(day.date, props) })))
const monthDays = computed(() => diaryMonth(`${month.value}-01`)
  .map(day => ({ ...day, intake: diaryIntake(day.date, props) })))
const days = computed(() => monthVisible.value ? monthDays.value : weekDays.value)
const monthLabel = computed(() => `${Number(month.value.slice(0, 4))}年${Number(month.value.slice(5))}月`)
const hasMock = computed(() => days.value.some(day => day.intake.hasMock))
function stopAnimation() { if (animation !== undefined) cancelAnimationFrame(animation); animation = undefined }
onBeforeUnmount(stopAnimation)
function measure() { weekHeight = weekGrid.value?.getBoundingClientRect().height ?? 0; monthHeight = monthPanel.value?.getBoundingClientRect().height ?? weekHeight }
function updateDrag() { dragHeight.value = Math.max(weekHeight, Math.min(monthHeight, startHeight + dragDistance)) }
function canDrag(distance: number) {
  // 首页先正常滚回顶部，再下拉月历；阅读下方记录时不抢占页面滚动。
  return window.scrollY <= 2 && (distance > 0 ? progress.value < 1 : progress.value > 0)
}
function beginDrag() {
  startHeight = viewport.value?.getBoundingClientRect().height ?? 0; startProgress = progress.value
  stopAnimation(); settling.value = false; dragging.value = true; dragDistance = 0
  if (startProgress === 0) month.value = props.date.slice(0, 7)
  dragHeight.value = startHeight
  void nextTick(() => { if (dragging.value) { measure(); updateDrag() } })
}
function dragBy(distance: number) { if (dragging.value) { dragDistance = distance; if (monthHeight > weekHeight) updateDrag() } }
function finishDrag(cancelled = false) {
  if (!dragging.value) return
  dragging.value = false; settling.value = true
  // 松手仅补齐剩余行程，拖动中的高度一直由手指控制；取消则回到起始状态。
  const open = (cancelled || Math.abs(dragDistance) < 48) ? startProgress >= .5 : dragDistance > 0
  const from = dragHeight.value ?? startHeight, to = open ? monthHeight : weekHeight
  const done = () => { expanded.value = open; settling.value = false; dragHeight.value = null; animation = undefined }
  if (Math.abs(from - to) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return }
  const started = performance.now()
  const frame = (time: number) => {
    const fraction = Math.min(1, (time - started) / 180)
    dragHeight.value = from + (to - from) * (1 - (1 - fraction) ** 3)
    if (fraction === 1) done(); else animation = requestAnimationFrame(frame)
  }
  animation = requestAnimationFrame(frame)
}
async function revealCalendar() {
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  calendar.value?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
}
function resetDrag() { stopAnimation(); dragging.value = false; settling.value = false; dragHeight.value = null }
async function showMonth() { resetDrag(); month.value = props.date.slice(0, 7); expanded.value = true; await revealCalendar() }
async function hideMonth(reveal = true) { resetDrag(); expanded.value = false; if (reveal) await revealCalendar() }
defineExpose({ expanded, showMonth, hideMonth, canDrag, beginDrag, dragBy, finishDrag })
function moveMonth(amount: number) {
  const next = new Date(`${month.value}-01T12:00:00`); next.setMonth(next.getMonth() + amount)
  if (next.getFullYear() >= 1 && next.getFullYear() <= 9999) month.value = `${String(next.getFullYear()).padStart(4, '0')}-${String(next.getMonth() + 1).padStart(2, '0')}`
}
let gesture: { id: number; x: number; y: number } | null = null, suppressClick = false
function pointerdown(event: PointerEvent) {
  suppressClick = false
  if (!event.isPrimary) { gesture = null; return }
  if (event.pointerType === 'touch' || event.pointerType === 'pen') gesture = { id: event.pointerId, x: event.clientX, y: event.clientY }
}
function pointerup(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return
  const dy = event.clientY - gesture.y, dx = event.clientX - gesture.x; gesture = null
  // 触摸滑动后可能缺少紧接着的兼容 click；轻点在 pointerup 确认，并去重后续 click。
  if (Math.abs(dy) < 10 && Math.abs(dx) < 10) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (button?.dataset.date) { suppressClick = true; emit('select', button.dataset.date) }
    return
  }
}
function clicked(event: MouseEvent, date: string) {
  if (suppressClick && event.detail > 0) { suppressClick = false; return }
  emit('select', date)
}
function description(day: typeof days.value[number]) {
  const intake = day.intake
  const parts = [dateLabel(day.date), intake.hasRecords ? '已有饮食记录' : '尚无饮食记录']
  if (intake.hasRecords) parts.push(`已知摄入估算 ${numberLabel(intake.consumedKcal)} kcal`)
  if (intake.budgetKcal !== null) parts.push(`当日预算 ${numberLabel(intake.budgetKcal)} kcal`)
  if (intake.percent !== null) parts.push(`已摄入占预算约 ${intake.label}`, ...(intake.state === 'over' ? ['超出预算'] : []))
  if (intake.state === 'no-budget') parts.push('未设置可用热量预算，暂不计算百分比')
  if (intake.missingCalories) parts.push(`${intake.missingCalories} 项食物热量待补全`)
  if (intake.incompleteActivity) parts.push('计入预算的活动热量待确认')
  if (intake.hasMock) parts.push('包含模拟记录')
  return parts.join('，')
}
// 跟手每帧只更新高度和透明度，日期的读屏文案不重复进行日期／数字格式化。
const labeledWeekDays = computed(() => weekDays.value.map(day => ({ ...day, description: description(day) })))
const labeledMonthDays = computed(() => monthDays.value.map(day => ({ ...day, description: description(day) })))
function focusDate(date: string) { (monthVisible.value ? monthPanel.value : weekGrid.value)?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus({ preventScroll: true }) }
async function keydown(event: KeyboardEvent) {
  if (event.key === 'PageDown' && !expanded.value) { event.preventDefault(); await showMonth(); focusDate(props.date); return }
  if (['Escape', 'PageUp'].includes(event.key) && expanded.value) { event.preventDefault(); await hideMonth(); focusDate(props.date); return }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const focusedDate = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.date ?? props.date
  const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  const value = event.key === 'Home' ? days.value[0]!.date : event.key === 'End' ? days.value.at(-1)!.date : shiftDate(focusedDate, moves[event.key]!)
  if (Number(value.slice(0, 4)) < 1 || Number(value.slice(0, 4)) > 9999) return
  emit('select', value); await nextTick()
  focusDate(value)
}
</script>

<template>
  <div ref="calendar" class="diary-week-section" :class="{ 'month-expanded': monthVisible, 'calendar-dragging': dragging }" :data-expansion="progress.toFixed(3)" :data-dragging="dragging" @pointerdown="pointerdown" @pointerup="pointerup" @pointercancel="gesture = null">
    <div ref="viewport" class="diary-calendar-viewport" :style="dragHeight === null ? undefined : { height: `${dragHeight}px` }">
      <nav ref="weekGrid" class="diary-week diary-week-pane" :style="{ opacity: 1 - Math.min(1, progress * 6), visibility: progress >= 1 / 6 ? 'hidden' : undefined }" :inert="monthVisible" :aria-hidden="monthVisible" aria-label="本周记录日期与摄入进度，PageDown查看整月" aria-keyshortcuts="PageDown" data-testid="diary-week" @keydown="keydown">
        <button v-for="day in labeledWeekDays" :key="day.date" :data-date="day.date" type="button"
          :class="{ selected: day.date === date, today: day.today }" :data-intake-state="day.intake.state" :data-intake-percent="day.intake.percent"
          :style="{ '--intake-fill': `${day.intake.fill}%` }" :aria-current="day.date === date ? 'date' : undefined"
          :aria-label="day.description" :title="day.description" :data-testid="`week-date-${day.date}`" @click="clicked($event, day.date)">
          <span>{{ day.today ? '今' : `周${day.label}` }}</span><strong>{{ day.day }}</strong><small class="diary-day-intake" aria-hidden="true">{{ day.intake.label }}</small>
        </button>
      </nav>
      <div v-if="monthVisible" ref="monthPanel" class="diary-month-panel" :style="{ opacity: Math.min(1, progress * 6), visibility: progress === 0 ? 'hidden' : undefined }" :inert="dragging || settling || progress === 0" :aria-hidden="progress === 0">
        <div class="diary-month-toolbar">
          <button type="button" class="icon-button" aria-label="查看上个月" data-testid="diary-previous-month" :disabled="month === '0001-01'" @click="moveMonth(-1)"><ChevronLeft :size="18" /></button>
          <strong aria-live="polite" data-testid="diary-month-title">{{ monthLabel }}</strong>
          <button type="button" class="text-button" data-testid="diary-month-today" @click="month = localDate().slice(0, 7); emit('select', localDate())">今天</button>
          <button type="button" class="icon-button" aria-label="查看下个月" data-testid="diary-next-month" :disabled="month === '9999-12'" @click="moveMonth(1)"><ChevronRight :size="18" /></button>
        </div>
        <div class="diary-month-weekdays" aria-hidden="true"><span v-for="label in ['一', '二', '三', '四', '五', '六', '日']" :key="label">{{ label }}</span></div>
        <nav id="diary-intake-dates" class="diary-week diary-month" :aria-label="`${monthLabel}记录日期与摄入进度`" aria-keyshortcuts="Escape PageUp" data-testid="diary-month" @keydown="keydown">
          <button v-for="day in labeledMonthDays" :key="day.date" :data-date="day.date" type="button"
            :class="{ selected: day.date === date, today: day.today }" :data-intake-state="day.intake.state" :data-intake-percent="day.intake.percent"
            :style="{ '--intake-fill': `${day.intake.fill}%`, gridColumn: day.day === 1 ? day.column : undefined }" :aria-current="day.date === date ? 'date' : undefined"
            :aria-label="day.description" :title="day.description" :data-testid="`month-date-${day.date}`" @click="clicked($event, day.date)">
            <strong>{{ day.day }}<sup v-if="day.today">今</sup></strong><small class="diary-day-intake" aria-hidden="true">{{ day.intake.label }}</small>
          </button>
        </nav>
      </div>
    </div>
    <div class="diary-week-caption"><span>已摄入 / 当日预算</span><span class="diary-week-legend"><i></i>摄入比例<i class="over"></i>超预算<span v-if="hasMock"> · 含模拟</span></span></div>
  </div>
</template>
