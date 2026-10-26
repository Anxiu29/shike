<script setup lang="ts">
/**
 * 文字记餐状态机：描述→请求草稿→本地匹配/份量预览→继续修改或确认保存/转详细编辑。
 * 模型只负责语言解析，营养与快照由lib/meal-assistant和shared建立，失败保留原草稿。
 * 餐次仅首次发送按本地时段建议，明确描述/手选优先，不用定时器改已存在的草稿或历史。
 * 服务路由与原生路由共用api.describeMeal；流程与请求实例保留在docs/meal-assistant.md。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { MessageCircle, Send, LoaderCircle, Plus, Check, Pencil, Trash2, BookHeart } from '@lucide/vue'
import { assistantDraftSchema, aggregateNutrients, mealRecordSchema, type AssistantDraft, type MealRecord, type EstimatedFood, type FoodEntry, type PackagedFood } from '@shike/shared'
import AppSheet from './AppSheet.vue'
import DateField from './DateField.vue'
import ModelPicker from './ModelPicker.vue'
import { describeMeal, type Health } from '../lib/api'
import { db, saveMeal, saveLibraryFood } from '../lib/db'
import { assistantEntry, assistantMeal, type AssistantFood } from '../lib/meal-assistant'
import { numberLabel, portionLabel, suggestedMealType } from '../lib/dates'
const props = defineProps<{ date: string; available: boolean; health: Health | null; personalFoods: EstimatedFood[] }>()
const emit = defineEmits<{ saved: [record: MealRecord]; review: [record: MealRecord] }>()
const open = ref(false), input = ref(''), error = ref(''), busy = ref(false), saving = ref(false), modelChanging = ref(false)
const log = ref<HTMLElement | null>(null), draftPanel = ref<HTMLElement | null>(null), messages = ref<Array<{ role: 'user' | 'assistant'; text: string }>>([])
const draft = ref<AssistantDraft | null>(null), entries = ref<FoodEntry[]>([]), packages = ref<PackagedFood[]>([]), mode = ref<'live' | 'mock'>('live')
const libraryBusy = ref(false), storedEntries = ref<Record<string, boolean>>({})
const total = computed(() => aggregateNutrients(entries.value)), pending = computed(() => busy.value || saving.value || modelChanging.value || libraryBusy.value)
async function storeFood(entry: FoodEntry) {
  if (pending.value || libraryBusy.value || mode.value === 'mock') return
  libraryBusy.value = true; error.value = ''
  try { await saveLibraryFood(entry, 'ai'); storedEntries.value[entry.id] = true }
  catch { error.value = '常用食物保存失败，请检查本机存储后重试。' }
  finally { libraryBusy.value = false }
}
const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }
function message(role: 'user' | 'assistant', text: string) { messages.value.push({ role, text }); messages.value = messages.value.slice(-12); void nextTick(() => log.value?.scrollTo({ top: log.value.scrollHeight })) }
async function show() { open.value = true; try { packages.value = await db.packagedFoods.toArray() } catch { error.value = '个人包装库暂时不可读，仍可查基础食品库。' } }
watch(() => props.available, value => { if (!value) open.value = false })
async function send() {
  if (pending.value || !input.value.trim()) return
  const text = input.value.trim(); error.value = ''; busy.value = true
  if (messages.value.at(-1)?.role !== 'user' || messages.value.at(-1)?.text !== text) message('user', text)
  try {
    // 首次发送时按本地时间建议餐次；跨时段继续修改时仍保留草稿中已选的餐次。
    const response = await describeMeal({ text, date: props.date, mealType: draft.value?.mealType ?? suggestedMealType(), ...(draft.value ? { previous: draft.value } : {}) })
    const next = response.draft
    if (next.intent === 'clear') { draft.value = null; entries.value = [] }
    else if (next.intent === 'update' && next.foods.length) {
      // 全部转换成功后才替换，模型异常或份量超限时保留原草稿。
      const foods = next.foods.map(food => assistantEntry(food, props.personalFoods, packages.value))
      draft.value = { ...next, foods: next.foods.map((food, index) => food.amount === null && foods[index]?.portionSnapshot ? { ...food, amount: 1, unit: foods[index]!.portionSnapshot!.unit } : food) }; entries.value = foods; mode.value = response.mode
    }
    message('assistant', `${response.mode === 'mock' ? '【模拟模式】' : ''}${next.message}`)
    input.value = ''
    await nextTick(); draftPanel.value?.scrollIntoView({ block: 'end', behavior: 'instant' })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '助手暂时不可用，输入与草稿已保留。' }
  finally { busy.value = false }
}
function newMeal() { if (pending.value) return; draft.value = null; entries.value = []; messages.value = []; input.value = ''; error.value = '' }
function remove(index: number) { draft.value?.foods.splice(index, 1); entries.value.splice(index, 1); if (!entries.value.length) draft.value = null }
function changeAmount(index: number, event: Event) {
  const food = draft.value?.foods[index]
  if (!food) return
  const value = (event.target as HTMLInputElement).value, amount = value === '' ? null : Math.round(Number(value) * 100) / 100
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > 20000)) { error.value = '份量需大于0且不超过20000。'; return }
  const next: AssistantFood = { ...food, amount }
  try { const entry = assistantEntry(next, props.personalFoods, packages.value); entries.value[index] = entry; draft.value!.foods[index] = next; error.value = '' } catch (cause) { error.value = (cause as Error).message }
}
function record(): MealRecord { if (!draft.value) throw new Error('请先描述这一餐。'); assistantDraftSchema.parse(draft.value); return mealRecordSchema.parse(assistantMeal(draft.value, entries.value, mode.value)) }
async function confirm() {
  if (pending.value || !entries.value.length) return
  error.value = ''; saving.value = true
  try { const meal = record(); await saveMeal(meal); draft.value = null; entries.value = []; message('assistant', `${mealNames[meal.mealType]}已保存。继续描述会创建新记录。`); emit('saved', meal) }
  catch { error.value = '保存未成功，草稿已保留。请检查份量和本地存储。' }
  finally { saving.value = false }
}
async function review() {
  if (pending.value) return
  try { const meal = record(); open.value = false; await nextTick(); await nextTick(); draft.value = null; entries.value = []; emit('review', meal) }
  catch { error.value = '草稿格式不完整，请检查份量。' }
}
</script>
<template>
  <button v-if="available && !open" class="assistant-fab" data-testid="assistant-open" aria-label="打开AI记餐助手" @click="show"><LoaderCircle v-if="busy" class="spin" :size="21"/><MessageCircle v-else :size="21"/><span>AI记餐</span></button>
  <AppSheet :open="open" title="AI记餐助手" subtitle="说说吃了什么，核对后存入饮食记录" :busy="saving" test-id="meal-assistant" class-name="meal-assistant-sheet" @close="open = false">
    <ModelPicker :busy="busy || saving" compact label="助手模型" @switching="modelChanging = $event" />
    <div ref="log" class="assistant-messages" role="log" aria-live="polite" data-testid="assistant-messages">
      <p v-if="!messages.length" class="assistant-intro">例如“吃了两个肉包和一个鸡蛋”。没说餐次时按发送时的本地时间预选；明确说“早餐”或手动选择时优先采用。没说份量时先用常见份量，可继续补充修改。</p>
      <div v-for="(item, index) in messages" :key="index" :class="['assistant-bubble', item.role]">{{ item.text }}</div>
      <div v-if="busy" class="assistant-bubble assistant"><LoaderCircle :size="15" class="spin"/> 正在整理这一餐…</div>
    </div>
    <div v-if="draft && entries.length" ref="draftPanel" class="assistant-draft" data-testid="assistant-draft">
      <div class="assistant-draft-title"><strong>待保存的一餐</strong><span v-if="mode === 'mock'" class="soft-tag">模拟数据</span><span>{{ entries.length > total.energyKcal.missing ? `约 ${numberLabel(total.energyKcal.known)} kcal` : '热量待补充' }}</span></div>
      <div class="assistant-fields"><label>记录日期<DateField v-model="draft.date"/></label><label>餐次<select v-model="draft.mealType" :disabled="pending" data-testid="assistant-meal-type"><option v-for="(name, value) in mealNames" :key="value" :value="value">{{ name }}</option></select></label></div>
      <div v-for="(entry, index) in entries" :key="entry.id" class="assistant-food" :data-testid="`assistant-food-${index}`"><div><strong>{{ entry.name }}</strong><small>{{ portionLabel(entry) }}<span v-if="entry.portionSnapshot"> · 份量估算</span></small><small v-if="entry.volumeSnapshot || entry.kind === 'unknown'" class="amber-text">营养待补充，可详细编辑</small><button type="button" class="assistant-save-food" :disabled="pending || libraryBusy || mode === 'mock'" :data-testid="`assistant-store-food-${index}`" @click="storeFood(entry)"><Check v-if="storedEntries[entry.id]" :size="12" /><BookHeart v-else :size="12" />{{ mode === 'mock' ? '模拟食物不可存库' : storedEntries[entry.id] ? '已存为常用' : '存为常用' }}</button></div><label><span class="sr-only">{{ entry.name }}数量</span><input :value="draft.foods[index]?.amount" type="number" min="0.01" max="20000" step="0.01" :placeholder="'常见份量'" :disabled="pending" :data-testid="`assistant-amount-${index}`" @change="changeAmount(index, $event)"/><span>{{ draft.foods[index]?.unit === 'ml' ? 'mL' : draft.foods[index]?.unit }}</span></label><button class="icon-button" :disabled="pending" :aria-label="`移除${entry.name}`" @click="remove(index)"><Trash2 :size="16"/></button></div>
      <p class="tiny muted">热量为已知部分估算。份量可改，缺失营养不当作0；保存前可进入详细编辑。</p>
      <div class="assistant-draft-actions"><button class="button secondary" :disabled="pending" data-testid="assistant-review" @click="review"><Pencil :size="15"/>详细编辑</button><button class="button primary" :disabled="pending" data-testid="assistant-save" @click="confirm"><Check :size="16"/>{{ saving ? '保存中…' : '确认保存' }}</button></div>
    </div>
    <p v-if="error" class="notice danger" role="alert" data-testid="assistant-error">{{ error }}</p>
    <template #footer><form class="assistant-composer" @submit.prevent="send"><textarea v-model="input" aria-label="饮食描述" data-testid="assistant-input" maxlength="1000" rows="2" :disabled="pending" placeholder="吃了什么？也可以说“包子改成三个”" @keydown.ctrl.enter.prevent="send"/><div><button type="button" class="text-button" :disabled="pending" data-testid="assistant-new" @click="newMeal"><Plus :size="15"/>新的一餐</button><small>{{ input.length }}/1000</small><button class="button primary" type="submit" :disabled="pending || !input.trim()" data-testid="assistant-send"><Send :size="16"/>发送</button></div><p class="tiny muted">只发送当前描述和未保存草稿；使用所选模型，可能消耗额度。文字可用手机键盘语音输入。</p></form></template>
  </AppSheet>
</template>
