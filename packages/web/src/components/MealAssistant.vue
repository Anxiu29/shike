<script setup lang="ts">
/**
 * 文字记餐状态机：描述→请求草稿→本地匹配/份量预览→继续修改或确认保存/转详细编辑。
 * 模型只负责语言解析，营养与快照由lib/meal-assistant和shared建立，失败保留原草稿。
 * 餐次仅首次发送按本地时段建议，明确描述/手选优先，不用定时器改已存在的草稿或历史。
 * 服务路由与原生路由共用api.describeMeal；流程与请求实例保留在docs/meal-assistant.md。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MessageCircle, Send, LoaderCircle, Plus, Check, Pencil, Trash2, BookHeart, ImagePlus, Camera, X } from '@lucide/vue'
import { assistantDraftSchema, aggregateNutrients, mealRecordSchema, type AssistantDraft, type AssistantTurn, type MealRecord, type EstimatedFood, type FoodEntry, type PackagedFood } from '@shike/shared'
import AppSheet from './AppSheet.vue'
import DateField from './DateField.vue'
import AssistantModelPicker from './AssistantModelPicker.vue'
import { offlineAi, offlineAssistantEnabled } from '../lib/offline-ai'
import { describeMeal, type Health } from '../lib/api'
import { db, saveMeal, saveLibraryFood } from '../lib/db'
import { assistantEntry, assistantMeal, type AssistantFood } from '../lib/meal-assistant'
import { numberLabel, portionLabel, suggestedMealType } from '../lib/dates'
import { compressImage, compressedImageBase64 } from '../lib/image'
import { systemPhotoAvailable, takeSystemPhoto } from '../lib/system-photo'
const props = defineProps<{ date: string; available: boolean; health: Health | null; personalFoods: EstimatedFood[] }>()
const emit = defineEmits<{ saved: [record: MealRecord]; review: [record: MealRecord, photos: string[]] }>()
const draftPhotos = ref<string[]>([])
const open = ref(false), input = ref(''), error = ref(''), busy = ref(false), saving = ref(false), modelChanging = ref(false)
const log = ref<HTMLElement | null>(null), draftPanel = ref<HTMLElement | null>(null), messages = ref<AssistantTurn[]>([]), history = ref<AssistantTurn[]>([])
const photo = ref(''), photoBusy = ref(false), gallery = ref<HTMLInputElement | null>(null), camera = ref<HTMLInputElement | null>(null), preview = ref('')
const draft = ref<AssistantDraft | null>(null), entries = ref<FoodEntry[]>([]), packages = ref<PackagedFood[]>([]), mode = ref<'live' | 'mock'>('live')
// 一个对话只处理一种输入，避免订单截图被后续当成餐食照片存入餐次。
const inputKind = ref<'meal' | 'order'>('meal'), orderReviewed = ref(false)
const libraryBusy = ref(false), storedEntries = ref<Record<string, boolean>>({})
const usingOffline = ref(offlineAssistantEnabled()), localRequest = ref(false), offlineProgress = ref('')
let progressTimer: ReturnType<typeof setInterval> | undefined
function updateOfflineProgress() { void offlineAi.getState().then(state => { offlineProgress.value = state.stage === 'loading' ? '正在加载本机模型，首次可能需要较久…' : '正在本机整理并检查记餐草稿…' }).catch(() => {}) }
async function stopOffline() { try { await offlineAi.cancel(); offlineProgress.value = '正在停止本机操作，原草稿会保留…' } catch { error.value = '暂时无法停止，请稍后重试。' } }
watch(open, value => { if (!value && localRequest.value) void stopOffline() })
onBeforeUnmount(() => { clearInterval(progressTimer); if (localRequest.value) void stopOffline() })
const total = computed(() => aggregateNutrients(entries.value)), pending = computed(() => busy.value || saving.value || modelChanging.value || libraryBusy.value || photoBusy.value)
const imageUrl = (data: string) => `data:image/jpeg;base64,${data}`
const lastImage = computed(() => history.value.slice().reverse().find(turn => turn.role === 'user' && turn.imageBase64)?.imageBase64)
async function reanalyzeImage() {
  if (pending.value || usingOffline.value || photo.value || input.value.trim() || !lastImage.value) return
  photo.value = lastImage.value
  input.value = inputKind.value === 'order' ? '请用当前模型重新识读这张订单截图，更新完整草稿，同一商品不要重复累计。' : '请用当前模型重新分析这张图片，更新完整草稿，同一食物不要重复累计。'
  await send()
}
async function choosePhoto(event: Event) {
  const target = event.target as HTMLInputElement, file = target.files?.[0]; target.value = ''
  if (!file || pending.value) return
  if (usingOffline.value) { error.value = '本机模型目前只支持文字，请手动切换在线模型后发送图片。'; return }
  photoBusy.value = true; error.value = ''
  try { photo.value = await compressedImageBase64(await compressImage(file)) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '照片读取失败，请重新选择。' }
  finally { photoBusy.value = false }
}
async function takePhoto() {
  if (pending.value || usingOffline.value) return
  if (!systemPhotoAvailable()) { camera.value?.click(); return }
  photoBusy.value = true; error.value = ''
  try {
    const file = await takeSystemPhoto()
    if (file && open.value) photo.value = await compressedImageBase64(await compressImage(file))
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '拍照失败，请重试或选照片。' }
  finally { photoBusy.value = false }
}
async function storeFood(entry: FoodEntry) {
  if (pending.value || libraryBusy.value || mode.value === 'mock') return
  libraryBusy.value = true; error.value = ''
  try { await saveLibraryFood(entry, 'ai'); storedEntries.value[entry.id] = true }
  catch { error.value = '常用食物保存失败，请检查本机存储后重试。' }
  finally { libraryBusy.value = false }
}
const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }
function message(role: 'user' | 'assistant', text: string, imageBase64?: string) { messages.value.push({ role, text, ...(imageBase64 ? { imageBase64 } : {}) }); messages.value = messages.value.slice(-12); void nextTick(() => log.value?.scrollTo({ top: log.value.scrollHeight })) }
function scrollPanel(target: HTMLElement | null, end = false) {
  const body = target?.closest<HTMLElement>('.sheet-body')
  if (!body || !target) return
  const top = body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top
  // 只滚动内容区。scrollIntoView会连overflow:hidden的dialog也滚走，导致标题/关闭按钮消失。
  body.scrollTo({ top: end ? top + target.offsetHeight - body.clientHeight + 16 : top - 14, behavior: 'instant' })
}
async function show() { open.value = true; try { packages.value = await db.packagedFoods.toArray() } catch { error.value = '个人包装库暂时不可读，仍可查基础食品库。' } }
watch(() => props.available, value => { if (!value) open.value = false })
async function send() {
  if (pending.value || (!input.value.trim() && !photo.value)) return
  if (inputKind.value === 'order' && offlineAssistantEnabled()) { error.value = '订单识别需要在线模型，请手动切换后发送。'; return }
  const text = input.value.trim(), imageBase64 = photo.value; error.value = ''; busy.value = true
  localRequest.value = offlineAssistantEnabled()
  if (localRequest.value) { offlineProgress.value = '正在检查本机模型状态…'; updateOfflineProgress(); progressTimer = setInterval(updateOfflineProgress, 500) }
  const last = messages.value.at(-1)
  if (last?.role !== 'user' || last.text !== text || (last.imageBase64 ?? '') !== imageBase64) message('user', text, imageBase64)
  try {
    // 首次发送时按本地时间建议餐次；跨时段继续修改时仍保留草稿中已选的餐次。
    const response = await describeMeal({ text, ...(inputKind.value === 'order' ? { inputKind: 'order' as const } : {}), ...(imageBase64 ? { imageBase64 } : {}), history: history.value.slice(imageBase64 ? -4 : -6), date: props.date, mealType: draft.value?.mealType ?? suggestedMealType(), ...(draft.value ? { previous: draft.value } : {}) })
    const next = response.draft
    if (next.intent === 'clear') { draft.value = null; entries.value = []; draftPhotos.value = []; orderReviewed.value = false }
    else if (next.intent === 'update' && next.foods.length) {
      // 全部转换成功后才替换，模型异常或份量超限时保留原草稿。
      const foods = next.foods.map(food => assistantEntry(food, props.personalFoods, packages.value, inputKind.value))
      const previousPhotos = draft.value ? draftPhotos.value : []
      draftPhotos.value = inputKind.value === 'order' ? [] : [...new Set([...previousPhotos, ...(imageBase64 ? [imageUrl(imageBase64)] : [])])].slice(-3)
      draft.value = { ...next, foods: next.foods.map((food, index) => food.amount === null && foods[index]?.portionSnapshot ? { ...food, amount: 1, unit: foods[index]!.portionSnapshot!.unit } : food) }; entries.value = foods; mode.value = response.mode
      orderReviewed.value = false
    }
    message('assistant', `${response.mode === 'mock' ? '【模拟模式】' : ''}${next.message}`)
    history.value = [...history.value, { role: 'user' as const, text, ...(imageBase64 ? { imageBase64 } : {}) }, { role: 'assistant' as const, text: next.message }].slice(-6)
    input.value = ''; photo.value = ''
    await nextTick()
    if (next.intent === 'update') scrollPanel(draftPanel.value, true)
    else scrollPanel(log.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '助手暂时不可用，输入与草稿已保留。' }
  finally { clearInterval(progressTimer); progressTimer = undefined; localRequest.value = false; offlineProgress.value = ''; busy.value = false }
}
function newMeal() { if (pending.value) return; draft.value = null; entries.value = []; draftPhotos.value = []; messages.value = []; history.value = []; photo.value = ''; preview.value = ''; storedEntries.value = {}; input.value = ''; error.value = ''; inputKind.value = 'meal'; orderReviewed.value = false }
function remove(index: number) { draft.value?.foods.splice(index, 1); entries.value.splice(index, 1); orderReviewed.value = false; if (!entries.value.length) { draft.value = null; draftPhotos.value = [] } }
function changeAmount(index: number, event: Event) {
  const food = draft.value?.foods[index]
  if (!food) return
  const value = (event.target as HTMLInputElement).value, amount = value === '' ? null : Math.round(Number(value) * 100) / 100
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > 20000)) { error.value = '份量需大于0且不超过20000。'; return }
  const next: AssistantFood = { ...food, amount }
  try { const entry = assistantEntry(next, props.personalFoods, packages.value, inputKind.value); entries.value[index] = entry; draft.value!.foods[index] = next; orderReviewed.value = false; error.value = '' } catch (cause) { error.value = (cause as Error).message }
}
function record(): MealRecord { if (!draft.value) throw new Error('请先描述这一餐。'); assistantDraftSchema.parse(draft.value); return mealRecordSchema.parse(assistantMeal(draft.value, entries.value, mode.value)) }
async function confirm() {
  if (pending.value || !entries.value.length) return
  if (inputKind.value === 'order' && !orderReviewed.value) { error.value = '请先按实际食用量核对订单，或进入详细编辑。'; return }
  error.value = ''; saving.value = true
  try { const meal = record(); await saveMeal(meal, db, draftPhotos.value); draft.value = null; entries.value = []; draftPhotos.value = []; orderReviewed.value = false; if (inputKind.value === 'order') history.value = []; message('assistant', `${mealNames[meal.mealType]}已保存。继续描述会创建新记录。`); emit('saved', meal) }
  catch { error.value = '保存未成功，草稿已保留。请检查份量和本地存储。' }
  finally { saving.value = false }
}
async function review() {
  if (pending.value) return
  try { const meal = record(), photos = [...draftPhotos.value]; open.value = false; await nextTick(); await nextTick(); draft.value = null; entries.value = []; draftPhotos.value = []; orderReviewed.value = false; if (inputKind.value === 'order') history.value = []; emit('review', meal, photos) }
  catch { error.value = '草稿格式不完整，请检查份量。' }
}
</script>
<template>
  <button v-if="available && !open" class="assistant-fab" data-testid="assistant-open" aria-label="打开AI记餐助手" @click="show"><LoaderCircle v-if="busy" class="spin" :size="21"/><MessageCircle v-else :size="21"/><span>AI记餐</span></button>
  <AppSheet :open="open" title="AI记餐助手" :subtitle="usingOffline ? '本机离线文字记餐 · 核对后保存' : '发照片、补充描述，也能聊聊这一餐'" :busy="saving" test-id="meal-assistant" class-name="meal-assistant-sheet" @close="open = false">
    <AssistantModelPicker :busy="busy || saving || libraryBusy || photoBusy" @switching="modelChanging = $event" @offline="usingOffline = $event"/>
    <label class="assistant-purpose">本次用途<select v-model="inputKind" :disabled="pending || !!messages.length || !!draft" data-testid="assistant-input-kind"><option value="meal">餐食聊天 / 记餐</option><option value="order" :disabled="usingOffline">外卖订单识别</option></select><small class="muted">更换用途请点击“新对话”</small></label>
    <p v-if="inputKind === 'order'" class="notice" data-testid="assistant-order-notice">选择订单截图、小票照片或粘贴订单文字，发送后核对菜品、套餐和实际食用量。建议只截商品区域，长订单分张发送；截图会交给所选在线模型识读，不自动保存到餐次照片。</p>
    <div ref="log" class="assistant-messages" role="log" aria-live="polite" data-testid="assistant-messages">
      <p v-if="!messages.length" class="assistant-intro">{{ inputKind === 'order' ? '例如订单里“肉包（2个装）×3”应整理成6个肉包；可继续说“只吃了两个”“饮料是别人的”。下单数量不等于实际摄入，克重和营养仍需核对。' : usingOffline ? '可以输入“午餐吃了两个鸡蛋、一碗米饭和一杯牛奶”，也可以接着改数量或移除某项。模型只整理文字，营养由本地食品库匹配，草稿需你核对后保存。' : '可以发照片并说明“这是午餐，米饭只吃了一半”，也可以问“这餐怎么搭配”。支持接着追问、补充份量；记餐草稿需你确认后才保存。' }}</p>
      <div v-for="(item, index) in messages" :key="index" :class="['assistant-bubble', item.role]"><button v-if="item.imageBase64" type="button" class="assistant-image-button" aria-label="查看聊天图片" @click="preview = item.imageBase64"><img :src="imageUrl(item.imageBase64)" alt="本条消息的图片" /></button><span>{{ item.text }}</span></div>
      <div v-if="busy" class="assistant-bubble assistant"><LoaderCircle :size="15" class="spin"/>{{ localRequest ? offlineProgress : '正在查看并回复…' }}<button v-if="localRequest" type="button" class="text-button" data-testid="assistant-offline-stop" @click="stopOffline">停止</button></div>
    </div>
    <div v-if="draft && entries.length" ref="draftPanel" class="assistant-draft" data-testid="assistant-draft">
      <div class="assistant-draft-title"><strong>{{ inputKind === 'order' ? '订单草稿 · 待核对摄入量' : '待保存的一餐' }}</strong><span v-if="mode === 'mock'" class="soft-tag">模拟数据</span><span>{{ entries.length > total.energyKcal.missing ? `约 ${numberLabel(total.energyKcal.known)} kcal` : '热量待补充' }}</span></div>
      <div class="assistant-fields"><label>记录日期<DateField v-model="draft.date"/></label><label>餐次<select v-model="draft.mealType" :disabled="pending" data-testid="assistant-meal-type"><option v-for="(name, value) in mealNames" :key="value" :value="value">{{ name }}</option></select></label></div>
      <div v-for="(entry, index) in entries" :key="entry.id" class="assistant-food" :data-testid="`assistant-food-${index}`"><div><strong>{{ entry.name }}</strong><small>{{ portionLabel(entry) }}<span v-if="entry.portionSnapshot"> · 份量估算</span></small><small v-if="entry.volumeSnapshot || entry.kind === 'unknown'" class="amber-text">营养待补充，可详细编辑</small><button type="button" class="assistant-save-food" :disabled="pending || libraryBusy || mode === 'mock'" :data-testid="`assistant-store-food-${index}`" @click="storeFood(entry)"><Check v-if="storedEntries[entry.id]" :size="12" /><BookHeart v-else :size="12" />{{ mode === 'mock' ? '模拟食物不可存库' : storedEntries[entry.id] ? '已存为常用' : '存为常用' }}</button></div><label><span class="sr-only">{{ entry.name }}数量</span><input :value="draft.foods[index]?.amount" type="number" min="0.01" max="20000" step="0.01" :placeholder="'常见份量'" :disabled="pending" :data-testid="`assistant-amount-${index}`" @change="changeAmount(index, $event)"/><span>{{ draft.foods[index]?.unit === 'ml' ? 'mL' : draft.foods[index]?.unit }}</span></label><button class="icon-button" :disabled="pending" :aria-label="`移除${entry.name}`" @click="remove(index)"><Trash2 :size="16"/></button></div>
      <p class="tiny muted">热量为已知部分估算。份量可改，缺失营养不当作0；保存前可进入详细编辑。</p>
      <label v-if="inputKind === 'order'" class="assistant-order-check"><input v-model="orderReviewed" type="checkbox" :disabled="pending" data-testid="assistant-order-reviewed"/><span>已按实际食用量核对，移除未吃及他人的食物。套餐、规格或克重可进入详细编辑。</span></label>
      <p v-if="draftPhotos.length" class="tiny muted" data-testid="assistant-retained-photos">保存后可从餐次查看 {{ draftPhotos.length }} 张照片，每餐最多保留最近3张。</p>
      <div class="assistant-draft-actions"><button class="button secondary" :disabled="pending" data-testid="assistant-review" @click="review"><Pencil :size="15"/>详细编辑</button><button class="button primary" :disabled="pending || (inputKind === 'order' && !orderReviewed)" data-testid="assistant-save" @click="confirm"><Check :size="16"/>{{ saving ? '保存中…' : '确认保存' }}</button></div>
    </div>
    <p v-if="error" class="notice danger" role="alert" data-testid="assistant-error">{{ error }}</p>
    <template #footer><form class="assistant-composer" @submit.prevent="send">
      <div v-if="photo" class="assistant-attachment" data-testid="assistant-attachment"><button type="button" class="assistant-image-button" aria-label="查看待发送图片" @click="preview = photo"><img :src="imageUrl(photo)" alt="待发送的图片" /></button><span>图片已就绪<small>可在下方补充描述</small></span><button type="button" class="icon-button" :disabled="pending" aria-label="移除待发送图片" data-testid="assistant-remove-photo" @click="photo = ''"><X :size="18"/></button></div>
      <p v-if="photoBusy" class="tiny muted" role="status">正在压缩图片…</p>
      <button v-if="lastImage && !photo" type="button" class="text-button" :disabled="pending || usingOffline || !!input.trim()" data-testid="assistant-reanalyze-image" @click="reanalyzeImage">用当前模型重新分析上一张图片</button>
      <textarea v-model="input" aria-label="饮食描述" data-testid="assistant-input" :maxlength="usingOffline ? 600 : 1000" rows="2" :disabled="pending" :placeholder="inputKind === 'order' ? '粘贴订单文字，或补充“只吃一半”“饮料是别人的”…' : usingOffline ? '描述吃了什么，或修改上一餐的数量…' : '描述照片、记录吃了什么，或继续追问…'" @keydown.ctrl.enter.prevent="send"/>
      <input ref="gallery" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-testid="assistant-image-input" @change="choosePhoto"/>
      <input ref="camera" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-testid="assistant-camera-input" @change="choosePhoto"/>
      <div class="assistant-photo-tools"><button type="button" class="text-button" :disabled="pending || usingOffline" data-testid="assistant-choose-photo" @click="gallery?.click()"><ImagePlus :size="17"/>选图</button><button type="button" class="text-button" :disabled="pending || usingOffline" data-testid="assistant-take-photo" @click="takePhoto"><Camera :size="17"/>拍照</button><button type="button" class="text-button assistant-new" :disabled="pending" data-testid="assistant-new" @click="newMeal"><Plus :size="15"/>新对话</button><button class="button primary" type="submit" :disabled="pending || (!input.trim() && !photo)" data-testid="assistant-send"><Send :size="16"/>发送</button></div>
      <p v-if="usingOffline" class="tiny muted" data-testid="assistant-offline-notice">仅在手机处理本次文字、当前草稿和最近一轮对话。先手动准备模型；退后台或空闲5分钟释放后需再次点击“准备模型”。图片需手动切换在线模型。</p>
      <p v-else-if="inputKind === 'order'" class="tiny muted">发送订单和最近3轮上下文，最多3张图片，可能消耗所选模型额度。截图仅留在本次会话；确认后只保存核对过的食物记录。新对话清空未保存的聊天与截图。</p>
      <p v-else class="tiny muted">发送描述、草稿及最近3轮上下文，最多3张图片；使用所选模型，可能消耗额度。保存这餐时，相关照片也保存在本机；新对话清空未保存的聊天与照片。</p>
    </form></template>
  </AppSheet>
  <AppSheet :open="!!preview && open" title="查看图片" test-id="assistant-image-preview" @close="preview = ''"><img v-if="preview" class="assistant-full-image" :src="imageUrl(preview)" alt="聊天图片大图" /></AppSheet>
</template>
<style scoped>
.assistant-purpose { display: grid; gap: 6px; margin-bottom: 12px; }
.assistant-order-check { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; font-size: 12px; line-height: 1.7; }
.assistant-order-check input { width: 18px; height: 18px; flex: 0 0 18px; margin-top: 2px; }
</style>
