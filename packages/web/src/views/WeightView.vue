<script setup lang="ts">
/**
 * 体重按日期存一条，put更新当日记录；趋势只用真实保存的称重，不把资料参考值插入曲线。
 * 当前体重与目标页/预算共用weightOnDate；目标体重共用settings，未编辑时跟随外部保存更新。
 * db.saveWeight/deleteWeight更新称重当天及今日的预算来源，旧运动体重/消耗快照独立保留。
 * 对照web/tests/profile-sync.test.ts与tests/e2e/profile-sync.spec.ts查看跨页更新案例。
 */
import { computed, ref, watch } from 'vue'
import { Scale, TrendingUp, Flag, Plus, Trash2, Pencil, Check, LoaderCircle } from '@lucide/vue'
import { weightOnDate, type WeightRecord, type Settings } from '@shike/shared'
import { deleteWeight, saveSettings, saveWeight } from '../lib/db'
import { inputNumberLabel, localDate, numberLabel } from '../lib/dates'
import { inputNumber } from '../lib/entries'
import DateField from '../components/DateField.vue'
const props = defineProps<{ weights: WeightRecord[]; settings: Settings }>()
const emit = defineEmits<{ changed: []; notify: [message: string] }>()
const date = ref(localDate())
const weight = ref<number | null>(null)
const target = ref<number | null>(props.settings.targetWeightKg)
watch(() => props.settings.targetWeightKg, (latest, previous) => {
  if (Object.is(target.value, previous)) target.value = latest
})
const error = ref('')
const busy = ref(false)
const targetBusy = ref(false), deleting = ref<string | null>(null)
// 与目标页、当日预算共用按日选重规则；没有称重记录时显示个人资料的参考值。
const current = computed(() => weightOnDate(localDate(), props.weights, props.settings.personalInfo))
const currentFromRecord = computed(() => props.weights.some(record => record.date === current.value.weightDate && record.weightKg === current.value.weightKg))
const chartRecords = computed(() => props.weights.slice(-30))
const domain = computed(() => {
  const values = chartRecords.value.map(item => item.weightKg)
  if (props.settings.targetWeightKg !== null) values.push(props.settings.targetWeightKg)
  if (!values.length) return { min: 0, max: 1 }
  const min = Math.min(...values), max = Math.max(...values), margin = Math.max(1, (max - min) * 0.2)
  return { min: Math.max(0, min - margin), max: max + margin }
})
const point = (record: WeightRecord, index: number) => {
  const records = chartRecords.value
  const first = new Date(`${records[0]?.date}T12:00:00`).getTime(), last = new Date(`${records.at(-1)?.date}T12:00:00`).getTime()
  const x = records.length === 1 ? 280 : 48 + (new Date(`${record.date}T12:00:00`).getTime() - first) / (last - first) * 474
  const y = 188 - (record.weightKg - domain.value.min) / (domain.value.max - domain.value.min) * 148
  return { x: Number.isFinite(x) ? x : 48 + index * 20, y }
}
const chartPath = computed(() => chartRecords.value.map((record, index) => `${index ? 'L' : 'M'} ${point(record, index).x} ${point(record, index).y}`).join(' '))
const targetY = computed(() => props.settings.targetWeightKg === null ? null : 188 - (props.settings.targetWeightKg - domain.value.min) / (domain.value.max - domain.value.min) * 148)
async function submitWeight() {
  if (busy.value) return
  error.value = ''; busy.value = true
  try {
    if (weight.value === null) throw new Error('请输入体重。')
    await saveWeight({ date: date.value, weightKg: Number(weight.value), updatedAt: new Date().toISOString() })
    emit('changed'); emit('notify', '体重已保存'); weight.value = null
  } catch (cause) { error.value = cause instanceof Error && cause.message === '请输入体重。' ? cause.message : '保存失败：请检查日期、体重（1–600 kg）与浏览器存储空间。' }
  finally { busy.value = false }
}
async function submitTarget() {
  if (targetBusy.value) return
  error.value = ''; targetBusy.value = true
  try { await saveSettings({ targetWeightKg: target.value === null || (target.value as unknown) === '' ? null : Number(target.value) }); emit('changed'); emit('notify', '目标体重已更新') }
  catch { error.value = '目标体重请输入 1–600 kg，留空可取消目标。' }
  finally { targetBusy.value = false }
}
function edit(record: WeightRecord) { date.value = record.date; weight.value = record.weightKg; document.querySelector('#weight-value')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
async function remove(record: WeightRecord) { if (deleting.value) return; if (!window.confirm(`删除 ${record.date} 的体重记录？`)) return; deleting.value = record.date; try { await deleteWeight(record.date); emit('changed'); emit('notify', '体重记录已删除') } catch { error.value = '删除失败，请检查浏览器存储状态。' } finally { deleting.value = null } }
</script>

<template>
  <section><div class="page-heading"><div><span class="eyebrow">一点点变化，慢慢看见</span><h1>身体的变化，<span>慢慢看见。</span></h1><p>关注趋势，给自己一点耐心。</p></div><span class="heading-symbol"><Scale :size="28" stroke-width="1.5" /></span></div>
    <div class="weight-stats"><div class="card stat-card"><span><Scale :size="16" /> 当前体重</span><strong data-testid="current-weight">{{ current.weightKg === null ? '—' : numberLabel(current.weightKg, 2) }} <small>kg</small></strong><p data-testid="current-weight-source">{{ current.weightKg === null ? '开始记录，了解变化' : `${current.weightDate} · ${currentFromRecord ? '体重记录' : '个人资料参考'}` }}</p></div><div class="card stat-card"><span><Flag :size="16" /> 目标体重</span><strong data-testid="weight-target-summary">{{ settings.targetWeightKg !== null ? numberLabel(settings.targetWeightKg, 2) : '—' }} <small>kg</small></strong><p>{{ settings.targetWeightKg === null ? '按自己的节奏设定目标' : '目标可以随时调整' }}</p></div><div class="card stat-card"><span><TrendingUp :size="16" /> 已记录</span><strong>{{ weights.length }} <small>天</small></strong><p>同一天可更新一条记录</p></div></div>
    <div class="weight-layout"><div class="card chart-card"><div class="section-heading"><h2>体重趋势</h2><span class="soft-tag">最近 30 条</span></div><div v-if="chartRecords.length" class="weight-chart"><svg viewBox="0 0 560 230" role="img" aria-label="历史体重趋势图"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#69a58d" stop-opacity=".22"/><stop offset="100%" stop-color="#69a58d" stop-opacity=".01"/></linearGradient></defs><g v-for="ratio in [0, .5, 1]" :key="ratio"><line x1="48" x2="522" :y1="40 + 148 * ratio" :y2="40 + 148 * ratio" stroke="#e8ece5" stroke-dasharray="4 5"/><text x="5" :y="44 + 148 * ratio" fill="#8a958c" font-size="11">{{ numberLabel(domain.max - (domain.max - domain.min) * ratio, 2) }}</text></g><path :d="`${chartPath} L ${point(chartRecords.at(-1)!, chartRecords.length - 1).x} 188 L ${point(chartRecords[0]!, 0).x} 188 Z`" fill="url(#chart-fill)"/><line v-if="targetY !== null" x1="48" x2="522" :y1="targetY" :y2="targetY" stroke="#c6a76b" stroke-dasharray="6 5"/><path :d="chartPath" fill="none" stroke="#40856d" stroke-width="3" stroke-linejoin="round"/><circle v-for="(record, index) in chartRecords" :key="record.date" :cx="point(record, index).x" :cy="point(record, index).y" r="4" fill="#40856d" stroke="#fff" stroke-width="2"><title>{{ record.date }}：{{ numberLabel(record.weightKg) }} kg</title></circle><text x="48" y="215" fill="#8a958c" font-size="11">{{ chartRecords[0]!.date.slice(5) }}</text><text x="522" y="215" fill="#8a958c" font-size="11" text-anchor="end">{{ chartRecords.at(-1)!.date.slice(5) }}</text></svg><p class="tiny muted"><i class="legend-dot"></i> 体重 <span v-if="settings.targetWeightKg !== null" class="target-legend">- - 目标体重</span> · 点击圆点可查看数值</p></div><div v-else class="chart-empty"><Scale :size="36" stroke-width="1.2" /><h3>给变化一个起点</h3><p>保存第一条体重，就能在这里看到趋势。</p></div></div>
      <div class="card weight-form"><h2>记录体重</h2><p class="muted small-text">尽量在相近时间、相同条件下称重。</p><form @submit.prevent="submitWeight"><label>日期<DateField v-model="date" data-testid="weight-date" :disabled="busy" required /></label><label>体重 <span class="muted">kg</span><input id="weight-value" :value="inputNumberLabel(weight)" @input="weight = inputNumber($event)" data-testid="weight-input" :disabled="busy" type="number" min="1" max="600" step="0.01" placeholder="例如 65.5" required /></label><button class="button primary full" data-testid="save-weight" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="17" /><Plus v-else :size="17" /> {{ busy ? '保存中' : '保存体重' }}</button></form><div class="target-form"><h3>设定个人目标</h3><form @submit.prevent="submitTarget"><label class="sr-only" for="target-weight">目标体重 kg</label><input id="target-weight" :value="inputNumberLabel(target)" @input="target = inputNumber($event)" data-testid="target-weight" :disabled="targetBusy" type="number" min="1" max="600" step="0.01" placeholder="目标 kg（可留空）" /><button class="icon-button target-save" data-testid="save-target" aria-label="保存目标体重" :disabled="targetBusy" :aria-busy="targetBusy"><LoaderCircle v-if="targetBusy" class="spin" :size="19"/><Check v-else :size="19" /></button></form></div></div></div>
    <div v-if="error" class="notice danger" role="alert">{{ error }}</div>
    <div v-if="weights.length" class="card weight-history"><div class="section-heading"><h2>历史记录</h2><span class="muted tiny">按日期倒序</span></div><div v-for="record in [...weights].reverse()" :key="record.date" class="weight-history-row" data-testid="weight-record"><span>{{ record.date }}</span><strong>{{ numberLabel(record.weightKg, 2) }} <small>kg</small></strong><div><button class="icon-button small" aria-label="编辑体重" @click="edit(record)"><Pencil :size="15" /></button><button class="icon-button small" aria-label="删除体重" :disabled="!!deleting" :aria-busy="deleting === record.date" @click="remove(record)"><LoaderCircle v-if="deleting === record.date" class="spin" :size="15"/><Trash2 v-else :size="15" /></button></div></div></div>
  </section>
</template>
