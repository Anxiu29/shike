<script setup lang="ts">
/**
 * 餐食编辑器只改独立 items 草稿，submit 校验后 emit('save')，由 App.persist 调用事务。
 * 拍照链：processFile 压缩 → runRecognition 请求 → prepareRecognition 转本地条目。
 * 来源选择/改名/份量变更委托 lib/entries.ts；总营养委托 shared，避免组件另写公式。
 * 子弹窗取消只回到上一层；识别或保存中阻止关闭；换图/卸载释放 Object URL。
 * “存入食品库”是独立本地写入，与“保存这一餐”分开；模拟条目不允许存入个人食品库。
 * 参照 docs/frontend-guide.md，再读 tests/FoodEditor.test.ts 和 tests/e2e/food-library.spec.ts。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, ImagePlus, X, Plus, Trash2, Check, LoaderCircle, RotateCcw, ChevronDown, ChevronRight, Sparkles, Info, Scale, PackageOpen, BookHeart, Copy } from '@lucide/vue'
import { createId, createPackageEntry, emptyPackageLabel, syncPackageEntry, packageSnapshotSchema, type PackageSnapshot, type PackagedFood, foods, recipes, normalizeFoodName, createFoodEntry, createRecipeEntry, createEstimatedFoodEntry, calculateNutrients, aggregateNutrients, applyEstimateLevel, calculateEnergyRange, selectedEstimateOption, mealRecordSchema, type MealRecord, type MealType, type FoodEntry, type Nutrients, type EstimatedFood, type EstimateLevel } from '@shike/shared'
import FoodPicker from './FoodPicker.vue'
import CapturePhoto from './CapturePhoto.vue'
import { db, saveLibraryFood, saveLibraryFoods } from '../lib/db'
import { entryForFoodChoice } from '../lib/food-picker'
import PackageLabelEditor from './PackageLabelEditor.vue'
import PackagedLibrary from './PackagedLibrary.vue'
import PhotoModelPicker from './PhotoModelPicker.vue'
import ManualFoodSheet from './ManualFoodSheet.vue'
import AppSheet from './AppSheet.vue'
import PhotoViewer from './PhotoViewer.vue'
import type { FoodMatchContext } from '../lib/food-picker'
import { compressImage, compressedImageBase64 } from '../lib/image'
import { recognizeImage, type Health } from '../lib/api'
import { manualEntry, rematchRenamedEntry, discardEstimateContext, entryBasis, resizeEntry, recalculateRecipe, inputNumber } from '../lib/entries'
import { prepareRecognition } from '../lib/recognition'
import { offlinePhotoEnabled, recognizeOfflineImage, prepareOfflineImage } from '../lib/offline-photo'
import { inputNumberLabel, numberLabel, rangeLabel, portionLabel } from '../lib/dates'
import { useBackLayer } from '../lib/use-back-layer'
import DateField from './DateField.vue'
import PortionAmountInput from './PortionAmountInput.vue'
import type { PortionSnapshot } from '@shike/shared'

const props = defineProps<{ date: string; mealType: MealType; record?: MealRecord; health: Health | null; estimatedFoods: EstimatedFood[]; start: 'photo' | 'manual' | 'edit'; initialItems?: FoodEntry[]; initialMode?: MealRecord['mode']; reuseSource?: string; initialPhoto?: File; initialPhotos?: string[]; photoKind?: 'food' | 'label'; initialBarcode?: string }>()
const emit = defineEmits<{ close: []; save: [record: MealRecord, photos?: string[]] }>()
const retainedPhotos = ref<string[] | undefined>(props.initialPhotos)
const storedPhotos = ref<string[]>([])
const previewPhotos = computed(() => retainedPhotos.value ?? storedPhotos.value)
const modelChanging = ref(false), libraryOpen = ref(false), libraryCandidate = ref<FoodEntry | undefined>()
const selectedAiMode = ref(props.health?.mode)
const cameraOpen = ref(false), photoPreviewOpen = ref(false), photoKind = ref(props.photoKind), barcodeFromCamera = ref(props.initialBarcode)
function captured(file: File, kind: 'food' | 'label', meal: MealType) { cameraOpen.value = false; photoKind.value = kind; mealType.value = meal; void processFile(file) }
function scanned(value: string, meal: MealType) { cameraOpen.value = false; mealType.value = meal; barcodeFromCamera.value = value; libraryOpen.value = true }
function skipCamera(meal: MealType, kind: string) { cameraOpen.value = false; mealType.value = meal; if (kind === 'barcode') { barcodeFromCamera.value = ''; openLibrary() } }
const manualFoodOpen = ref(false), packagedFoods = ref<PackagedFood[]>([])
async function reloadPackages() { try { packagedFoods.value = await db.packagedFoods.toArray() } catch { notice.value = '包装库读取失败，请检查本机存储。' } }
function closeLibrary() { libraryOpen.value = false; void reloadPackages() }
function openLibrary(entry?: FoodEntry) { libraryCandidate.value = entry; libraryOpen.value = true }
function usePackage(entry: FoodEntry) { if (items.value.length === 1 && !items.value[0]!.name.trim()) items.value = []; items.value.push(entry); previousNames.value[entry.id] = entry.name }
const items = ref<FoodEntry[]>(JSON.parse(JSON.stringify(props.record?.items ?? props.initialItems ?? [])))
const previousNames = ref<Record<string, string>>(Object.fromEntries(items.value.map(item => [item.id, item.name])))
// 候选仅留在面板内存。可靠库优先，用户仍可主动改选本次模型粗估。
const aiCandidates = ref<Record<string, FoodEntry>>(Object.fromEntries(items.value.filter(item => item.kind === 'ai').map(item => [item.id, JSON.parse(JSON.stringify(item))])))
const sourceSelections = ref<Record<string, string>>(Object.fromEntries(items.value.filter(item => item.kind === 'ai').map(item => [item.id, 'ai-current'])))
const recognitionWarnings = ref<Record<string, string[]>>(Object.fromEntries(items.value.map(item => [item.id, item.warnings.filter(warning => warning !== '此数据对应生食／生重；熟食需选择相符的数据或配方。' && !warning.startsWith('AI 粗估，不是实测数据') && !item.aiEstimateSnapshot?.assumptions.includes(warning) && !item.recipeSnapshot?.warnings.includes(warning) && !item.estimateProfile?.options.some(option => option.assumptions.includes(warning)))])))
const personalFoods = computed(() => props.estimatedFoods.filter(food => food.provider !== 'mock' && Object.values(food.nutrientsPer100g).some(value => value !== null)))
const mealType = ref<MealType>(props.record?.mealType ?? props.mealType)
const date = ref(props.record?.date ?? props.date)
const mode = ref<MealRecord['mode']>(props.record?.mode ?? props.initialMode ?? 'manual')
const phase = ref<'idle' | 'compressing' | 'recognizing' | 'done' | 'error'>('idle')
const error = ref('')
const notice = ref('')
const globalWarnings = ref<string[]>([])
const recognitionOffline = ref(false), recognitionProgress = ref(''), offlineActive = ref(false)
let offlineController: AbortController | null = null
const imageUrl = ref(props.initialPhotos?.[0] ?? '')
async function loadSavedPhotos() {
  if (!props.record || props.initialPhotos !== undefined) return
  try {
    const photos = await db.mealPhotos.where('mealId').equals(props.record.id).sortBy('position')
    storedPhotos.value = photos.map(photo => photo.dataUrl)
    if (retainedPhotos.value === undefined) imageUrl.value = storedPhotos.value[0] ?? ''
  } catch { notice.value = '原照片暂时无法读取，修改餐食仍会保留原照片。' }
}
function removePhotos() {
  if (busy.value || saveBusy.value) return
  if (imageUrl.value.startsWith('blob:')) URL.revokeObjectURL(imageUrl.value)
  retainedPhotos.value = []; imageUrl.value = ''; photoFile.value = null; phase.value = 'idle'
  notice.value = '照片将在保存这餐后移除，食物清单保持不变。'
}
const editorViewport = ref(window.visualViewport?.height ?? window.innerHeight), editorOffset = ref(window.visualViewport?.offsetTop ?? 0)
function updateEditorViewport() { editorViewport.value = window.visualViewport?.height ?? window.innerHeight; editorOffset.value = window.visualViewport?.offsetTop ?? 0 }
const photoFile = ref<File | null>(null)
const camera = ref<HTMLInputElement | null>(null)
const gallery = ref<HTMLInputElement | null>(null)
const saveBusy = ref(false)
const pickerEntryId = ref<string | null>(null)
const pickerEntry = computed(() => items.value.find(entry => entry.id === pickerEntryId.value))
const childDialogOpen = computed(() => !!pickerEntry.value || manualFoodOpen.value || libraryOpen.value || cameraOpen.value || photoPreviewOpen.value)
const recognitionContexts = ref<Record<string, FoodMatchContext>>({})
const recognitionWeights = ref<Record<string, number | null>>({})
const photoItems = computed(() => items.value.filter(entry => recognitionContexts.value[entry.id]))
const photoMatches = computed(() => photoItems.value.filter(entry => ['database', 'recipe', 'label'].includes(entry.kind) || (entry.kind === 'ai' && entry.provenance.startsWith('个人估算库'))).length)
const photoWeights = computed(() => photoItems.value.filter(entry => recognitionWeights.value[entry.id] !== null).length)
const photoFilledAmounts = computed(() => photoItems.value.filter(entry => entry.packageSnapshot ? entry.packageSnapshot.consumedAmount !== null : entry.volumeSnapshot ? entry.volumeSnapshot.amountMl !== null : entry.weightG !== null).length)
const offlinePhotoSummary = computed(() => `已匹配 ${photoMatches.value} 项${photoWeights.value ? ` · ${photoWeights.value} 项照片估重（试验）` : ''} · ${photoFilledAmounts.value ? `已填 ${photoFilledAmounts.value}/${photoItems.value.length} 项份量` : '重量与份量待填写'}`)
let pickerReturnFocus: HTMLElement | null = null
let previousFocus: HTMLElement | null = null
let manualReturnFocus: HTMLElement | null = null
const totals = computed(() => aggregateNutrients(items.value))
const busy = computed(() => modelChanging.value || ['compressing', 'recognizing'].includes(phase.value))
const containsMockEstimate = computed(() => items.value.some(item => item.aiEstimateSnapshot?.provider === 'mock' || item.packageSnapshot?.provider === 'mock'))
const mealTypes: { value: MealType; label: string }[] = [{ value: 'breakfast', label: '早餐' }, { value: 'lunch', label: '午餐' }, { value: 'dinner', label: '晚餐' }, { value: 'snack', label: '加餐' }]
const nutrientFields: { key: keyof Nutrients; label: string; unit: string }[] = [{ key: 'energyKcal', label: '热量', unit: 'kcal' }, { key: 'proteinG', label: '蛋白质', unit: 'g' }, { key: 'fatG', label: '脂肪', unit: 'g' }, { key: 'carbsG', label: '碳水', unit: 'g' }]
function openFoodPicker(entry: FoodEntry, event: MouseEvent) { pickerReturnFocus = event.currentTarget as HTMLElement; pickerEntryId.value = entry.id }
function closeFoodPicker() { pickerEntryId.value = null; nextTick(() => { if (pickerReturnFocus?.isConnected) pickerReturnFocus.focus() }) }
function openManualFields(entry: FoodEntry) {
  nextTick(() => {
    const index = items.value.findIndex(item => item.id === entry.id)
    if (entry.name.trim()) showKnownEnergy(index)
    else document.querySelector<HTMLInputElement>(`[data-testid="food-name-${index}"]`)?.focus()
  })
}

onMounted(() => { previousFocus = document.activeElement as HTMLElement; document.body.style.overflow = 'hidden'; window.visualViewport?.addEventListener('resize', updateEditorViewport); window.visualViewport?.addEventListener('scroll', updateEditorViewport); void reloadPackages(); void loadSavedPhotos(); if (props.initialPhoto) void processFile(props.initialPhoto); if (props.initialBarcode !== undefined) libraryOpen.value = true; if (props.start === 'manual') addItem(); document.querySelector<HTMLElement>('.modal-header .icon-button')?.focus() })
onBeforeUnmount(() => { offlineController?.abort(); window.visualViewport?.removeEventListener('resize', updateEditorViewport); window.visualViewport?.removeEventListener('scroll', updateEditorViewport); document.body.style.overflow = ''; if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); previousFocus?.focus() })

function keydown(event: KeyboardEvent) {
  if (childDialogOpen.value) return
  if (event.key === 'Escape') { close(); return }
  if (event.key !== 'Tab') return
  const focusable = [...document.querySelectorAll<HTMLElement>('.editor-modal button:not(:disabled), .editor-modal input:not(.sr-only):not(:disabled), .editor-modal select, .editor-modal summary')].filter(element => element.getClientRects().length > 0)
  const first = focusable[0], last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

function close() { if (pickerEntry.value) closeFoodPicker(); else if (manualFoodOpen.value) void cancelManualFood(); else if (!busy.value && !saveBusy.value) emit('close') }
useBackLayer(() => true, close)
function addItem() { if (!busy.value && !saveBusy.value) { manualReturnFocus = document.activeElement as HTMLElement; manualFoodOpen.value = true } }
function changeAmount(entry: FoodEntry, value: { amount: number | null; basis: 'g' | 'ml'; portion?: PortionSnapshot }) {
  if (entry.volumeSnapshot) entry.volumeSnapshot.amountMl = value.amount
  else resizeEntry(entry, value.amount)
  if (value.portion) entry.portionSnapshot = value.portion
  else delete entry.portionSnapshot
}
async function cancelManualFood() {
  manualFoodOpen.value = false
  // 先卸载子弹窗、恢复父面板的滚动锁，再关闭初次手动记录，避免留下body滚动锁。
  await nextTick()
  if (props.start === 'manual' && !props.record && !items.value.length && !imageUrl.value) emit('close')
  else if (manualReturnFocus?.isConnected) manualReturnFocus.focus({ preventScroll: true })
}
async function confirmManualFood(entry: FoodEntry) {
  items.value.push(entry); previousNames.value[entry.id] = entry.name; notice.value = ''; manualFoodOpen.value = false
  await nextTick(); scrollToFood(entry)
}
function removeItem(entry: FoodEntry) {
  items.value = items.value.filter(item => item.id !== entry.id)
  delete recognitionContexts.value[entry.id]; delete recognitionWeights.value[entry.id]
}
function addPackage() { const entry = createPackageEntry('包装食品', emptyPackageLabel(), 'manual', '手动填写'); items.value.push(entry); previousNames.value[entry.id] = entry.name }
function updatePackage(entry: FoodEntry, snapshot: PackageSnapshot) { entry.packageSnapshot = snapshot; syncPackageEntry(entry); if (snapshot.manuallyEdited) entry.provenance = '包装营养表 · 用户修正标注，按实际摄入量换算；原字段可能来自AI读取，需核对。' }
function photoWeightLabel(entry: FoodEntry): string {
  if (entry.packageSnapshot) return `${portionLabel(entry)} · 包装净含量不会自动计作摄入量。`
  const estimated = recognitionWeights.value[entry.id]
  if (estimated == null && entry.portionSnapshot) return entry.portionSnapshot.assumption
  if (estimated == null) return entry.weightG == null ? `${mode.value === 'mock' ? '示例未提供重量' : '照片无法可靠估重'}，请填写这一项的可食重量。` : `已手动填写 ${numberLabel(entry.weightG)} g`
  return `${mode.value === 'mock' ? '示例重量' : '照片估重'}约 ${numberLabel(estimated)} g${entry.weightG !== estimated ? ' · 已手动调整' : ' · 可按称重结果修改'}`
}
function scrollToFood(entry: FoodEntry) {
  const index = items.value.findIndex(item => item.id === entry.id)
  document.querySelector<HTMLElement>(`[data-testid="food-item-${index}"]`)?.scrollIntoView({ block: 'start' })
}
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await processFile(file)
}
async function processFile(file: File) {
  error.value = ''; phase.value = 'compressing'
  try {
    const compressed = await compressImage(file)
    const dataUrl = `data:image/jpeg;base64,${await compressedImageBase64(compressed)}`
    photoFile.value = compressed
    retainedPhotos.value = [dataUrl]
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
    imageUrl.value = URL.createObjectURL(photoFile.value)
    await runRecognition()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '图片处理失败。'; phase.value = 'error' }
}
async function runRecognition() {
  if (!photoFile.value || modelChanging.value || phase.value === 'recognizing' || saveBusy.value) return
  if (items.value.length && !window.confirm('重新识别会替换当前编辑的食物列表，继续吗？')) { phase.value = 'idle'; return }
  phase.value = 'recognizing'; error.value = ''; notice.value = ''
  recognitionProgress.value = ''
  const local = offlinePhotoEnabled()
  const controller = local ? new AbortController() : null
  offlineController = controller
  offlineActive.value = local
  try {
    const response = local ? null : await recognizeImage(photoFile.value)
    const offlineResult = local ? await recognizeOfflineImage(photoFile.value, photoKind.value === 'label' ? 'label' : 'food', { signal: controller!.signal, onProgress: value => { recognitionProgress.value = value } }) : null
    if (controller?.signal.aborted) throw new Error('本机识图已停止，原草稿保留。')
    if (response && photoKind.value === 'label' && !response.result.foods.some(food => food.packageLabel)) throw new Error('没有读清包装营养表。请拍清单位和数值后重试，或手动填写标签。')
    const drafts = response ? prepareRecognition(response, personalFoods.value) : prepareOfflineImage(offlineResult!, personalFoods.value)
    mode.value = response?.mode ?? 'live'
    recognitionOffline.value = local
    globalWarnings.value = response?.result.uncertainties ?? offlineResult!.warnings
    aiCandidates.value = {}; sourceSelections.value = {}; recognitionWarnings.value = {}; previousNames.value = {}; recognitionContexts.value = {}; recognitionWeights.value = {}
    items.value = drafts.map(draft => {
      const { entry, candidate, context, estimatedWeightG, warnings } = draft
      previousNames.value[entry.id] = entry.name
      recognitionContexts.value[entry.id] = context
      recognitionWeights.value[entry.id] = estimatedWeightG
      if (candidate) aiCandidates.value[entry.id] = candidate
      if (entry.kind === 'ai') sourceSelections.value[entry.id] = entry.provenance.startsWith('个人估算库') ? `personal:${entry.referenceId}` : 'ai-current'
      recognitionWarnings.value[entry.id] = warnings
      return entry
    })
    notice.value = !items.value.length ? '没有可靠识别到食物。你可以换一张照片，或手动添加食物。' : local ? '本机识图已生成待核对清单。请对照照片核对食物、克数或标签原值，并填写实际摄入量，确认后才保存。' : '已识别并估算这一餐。核对份量，也可以打开食物库，更换更符合实际的食物或做法。'
    phase.value = 'done'
    await nextTick()
    document.querySelector<HTMLElement>('[data-testid="recognition-summary"]')?.scrollIntoView({ block: 'start' })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '识别失败，请稍后再试。'; phase.value = 'error' }
  finally { if (offlineController === controller) { offlineController = null; offlineActive.value = false } }
}
function stopRecognition() { offlineController?.abort(); recognitionProgress.value = '已请求停止，正在保留照片与草稿…' }
async function selectFood(id: string) {
  const entry = pickerEntry.value
  if (!entry) return
  // 再次选中当前条目仅关闭弹窗，不重置已编辑的配方、油量或档位。
  if (id === selectedSource(entry)) { closeFoodPicker(); if (!id) openManualFields(entry); return }
  const weight = entry.weightG
  let savedChoice: FoodEntry | null = null
  if (id.startsWith('saved:')) {
    try { savedChoice = entryForFoodChoice(id, weight, personalFoods.value, packagedFoods.value, await db.libraryFoods.toArray()) }
    catch { notice.value = '个人食品读取失败，当前草稿保留。'; return }
    if (!savedChoice) { notice.value = '此食物已删除，请重新选择。'; return }
  }
  let next: FoodEntry
  const food = foods.find(item => item.id === id)
  const recipe = recipes.find(item => item.id === id)
  const personal = id.startsWith('personal:') ? personalFoods.value.find(item => item.id === id.slice(9)) : undefined
  const packaged = id.startsWith('package:') ? entryForFoodChoice(id, null, personalFoods.value, packagedFoods.value) : null
  if (savedChoice) next = savedChoice
  else if (packaged) next = packaged
  else if (food) next = createFoodEntry(food, weight)
  else if (recipe) { next = createRecipeEntry(recipe, weight && weight > 0 ? weight : recipe.referenceWeightG); next.weightG = weight }
  else if (personal) {
    next = createEstimatedFoodEntry({ ...personal, provenance: `个人估算库 · ${personal.provenance}` }, weight)
    if (personal.estimateProfile) next = applyEstimateLevel(next, 'medium')
  }
  else if (id === 'ai-current' && aiCandidates.value[entry.id]) { next = JSON.parse(JSON.stringify(aiCandidates.value[entry.id])); resizeEntry(next, weight) }
  else next = manualEntry(entry.name, weight)
  next.id = entry.id
  if (entry.portionSnapshot && !next.packageSnapshot && !next.volumeSnapshot && normalizeFoodName(next.name) === normalizeFoodName(entry.name)) next.portionSnapshot = { ...entry.portionSnapshot }
  previousNames.value[entry.id] = next.name
  if (normalizeFoodName(next.name) !== normalizeFoodName(entry.name)) {
    delete recognitionContexts.value[entry.id]
    delete recognitionWeights.value[entry.id]
    recognitionWarnings.value[entry.id] = (recognitionWarnings.value[entry.id] ?? []).filter(warning => !warning.startsWith('可见成分：'))
  }
  // 更换营养来源不应抹掉模型对隐藏配料、重量和拍摄角度的提醒。
  // 保留视觉识别的不确定提示；切换后的营养假设应跟随新依据，不能混用旧配方。
  next.warnings = [...new Set([...next.warnings, ...recognitionWarnings.value[entry.id] ?? []])].slice(0, 30)
  sourceSelections.value[entry.id] = id
  items.value[items.value.findIndex(item => item.id === entry.id)] = next
  closeFoodPicker()
  if (!id) openManualFields(next)
}
const storedFoodMessages = ref<Record<string, string>>({}), storingFood = ref(false)
async function storeFood(entry: FoodEntry) {
  if (storingFood.value) return
  const trigger = document.activeElement as HTMLElement | null
  storingFood.value = true
  try {
    await saveLibraryFood(entry, recognitionContexts.value[entry.id] || entry.kind === 'ai' ? 'ai' : 'manual')
    storedFoodMessages.value[entry.id] = '已存入食品库，可从首页「我的常用食物」快速添加'
  } catch { storedFoodMessages.value[entry.id] = '存入失败，请核对食物数据和本机存储后重试' }
  finally { storingFood.value = false; await nextTick(); if (document.activeElement === document.body && trigger?.isConnected) trigger.focus({ preventScroll: true }) }
}
async function storeAllFoods() {
  if (storingFood.value) return
  const trigger = document.activeElement as HTMLElement | null
  storingFood.value = true
  try {
    await saveLibraryFoods(items.value.map(entry => ({ entry, origin: recognitionContexts.value[entry.id] || entry.kind === 'ai' ? 'ai' : 'manual' })))
    for (const entry of items.value) storedFoodMessages.value[entry.id] = '已存入食品库，可从首页「我的常用食物」快速添加'
    notice.value = `已将 ${items.value.length} 项食物存为常用，下次可直接添加`
  } catch { error.value = '存入常用食物失败，请核对数据和本机存储后重试。' }
  finally { storingFood.value = false; await nextTick(); if (document.activeElement === document.body && trigger?.isConnected) trigger.focus({ preventScroll: true }) }
}
function selectedSource(entry: FoodEntry): string { return entry.kind === 'label' ? 'package-label' : entry.kind === 'ai' ? sourceSelections.value[entry.id] ?? 'ai-current' : entry.referenceId ?? '' }
function matchManualName(entry: FoodEntry) {
  const result = rematchRenamedEntry(entry, previousNames.value[entry.id] ?? '', personalFoods.value)
  if (!result.changed) return
  delete aiCandidates.value[entry.id]; delete sourceSelections.value[entry.id]
  delete recognitionContexts.value[entry.id]
  delete recognitionWeights.value[entry.id]
  const next = result.entry
  delete next.portionSnapshot
  previousNames.value[entry.id] = next.name
  if (entry.kind === 'manual' || entry.kind === 'label') return
  // 食物种类已纠正：保留泛用拍摄提醒，去掉原种类的可见配料描述。
  recognitionWarnings.value[entry.id] = (recognitionWarnings.value[entry.id] ?? []).filter(warning => !warning.startsWith('可见成分：'))
  next.warnings = [...new Set([...next.warnings, ...recognitionWarnings.value[entry.id]!])].slice(0, 30)
  if (next.kind === 'ai') sourceSelections.value[entry.id] = `personal:${next.referenceId}`
  items.value[items.value.findIndex(item => item.id === entry.id)] = next
  if (next.kind === 'unknown' && next.name.trim()) notice.value = '名称已修改，原食物估值已清除。可补充营养数据，或重新识别。'
  else if (next.name.trim()) notice.value = '名称已修改，已重新匹配食物。请核对份量后保存。'
}
function nutrientChanged(entry: FoodEntry, key: keyof Nutrients, event: Event) {
  if (entry.volumeSnapshot) { entry.volumeSnapshot.nutrientsPer100ml[key] = inputNumber(event); entry.kind = 'manual'; return }
  entry.nutrientsPer100g[key] = inputNumber(event)
  discardEstimateContext(entry, true)
  entry.warnings = [...new Set([...entry.warnings, ...recognitionWarnings.value[entry.id] ?? []])].slice(0, 30)
  entry.kind = 'manual'; entry.provenance = '用户手动修改的每 100 g 营养数据；未修改字段保留原显示值，可能仍为估算。'
  delete entry.referenceId; delete entry.recipeSnapshot
}
function chooseEstimateLevel(entry: FoodEntry, level: EstimateLevel) {
  // 配方油克数依赖整份重量，缺失或零重量时不能更新油量快照。
  if (entry.kind === 'recipe' && (entry.weightG === null || entry.weightG <= 0)) return
  // 切档使用独立的普通数据快照，避免误改编辑器保存的原始候选。
  const next = applyEstimateLevel(JSON.parse(JSON.stringify(entry)), level)
  next.warnings = [...new Set([...next.warnings, ...recognitionWarnings.value[entry.id] ?? []])].slice(0, 30)
  items.value[items.value.findIndex(item => item.id === entry.id)] = next
  if (sourceSelections.value[entry.id] === 'ai-current') aiCandidates.value[entry.id] = JSON.parse(JSON.stringify(next))
}
function showKnownEnergy(index: number) {
  const details = document.querySelector<HTMLDetailsElement>(`[data-testid="nutrition-details-${index}"]`)
  if (details) details.open = true
  document.querySelector<HTMLInputElement>(`[data-testid="food-energyKcal-${index}"]`)?.focus()
}
function ingredientChanged(entry: FoodEntry, id: string, event: Event) {
  const ingredient = entry.recipeSnapshot?.ingredients.find(item => item.id === id)
  if (!ingredient) return
  ingredient.weightG = inputNumber(event) ?? 0
  recalculateRecipe(entry)
}
async function submit() {
  error.value = ''
  if (busy.value || saveBusy.value || !items.value.length) return
  const now = new Date().toISOString()
  const record: MealRecord = { id: props.record?.id ?? createId(), date: date.value, mealType: mealType.value, items: JSON.parse(JSON.stringify(items.value)), mode: mode.value, createdAt: props.record?.createdAt ?? now, updatedAt: now }
  if (items.value.some(item => item.packageSnapshot && !packageSnapshotSchema.safeParse(item.packageSnapshot).success)) { error.value = '请核对包装标签：营养表单位、每份大小和净含量需匹配；实际摄入最多100份／包或20000g／mL。'; return }
  const parsed = mealRecordSchema.safeParse(record)
  if (!parsed.success) { error.value = '请填写食物名称并检查数值：食物重量 0–20,000 g，每 100 g 热量 0–1,000 kcal，蛋白质、脂肪与碳水各 0–100 g。不确定的数据可留空。'; return }
  // 父组件在 IndexedDB 事务成功后关闭面板；失败时原草稿仍在。
  saveBusy.value = true
  emit('save', parsed.data, retainedPhotos.value)
}
defineExpose({ saveFailed: (message: string) => { saveBusy.value = false; error.value = message } })
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" :style="{ '--editor-viewport': `${editorViewport}px`, height: `${editorViewport}px`, top: `${editorOffset}px`, bottom: 'auto' }" @click.self="close">
      <section class="editor-modal" role="dialog" :aria-modal="!childDialogOpen" :inert="childDialogOpen" :aria-hidden="childDialogOpen ? 'true' : undefined" aria-labelledby="editor-title" data-testid="food-editor" @keydown="keydown">
        <header class="modal-header">
          <div><span class="eyebrow">记录每一口的美好</span><h2 id="editor-title">{{ record ? '编辑饮食记录' : reuseSource ? '复用这一餐' : '记录这一餐' }}</h2></div>
          <button class="icon-button" aria-label="关闭记录面板" :disabled="busy || saveBusy" @click="close"><X :size="22" /></button>
        </header>
        <div class="editor-scroll"><div v-if="reuseSource" class="reuse-source-note" data-testid="reuse-source-note"><Copy :size="19" /><div><strong>来自 {{ reuseSource }}</strong><p>已带入完整清单。这是一份新记录，核对日期和份量后保存。</p></div></div>
          <div v-if="mode === 'mock' || containsMockEstimate || (!record && selectedAiMode === 'mock')" class="notice warning" data-testid="mock-editor"><Info :size="17" /><span>{{ mode === 'mock' || containsMockEstimate ? '当前餐食包含模拟数据，保存后也会保留模拟标识。' : 'AI 当前为模拟模式：拍照识别使用示例食物，手动添加仍按你填写的数据记录。' }}</span></div>
          <PhotoModelPicker collapsible :kind="photoKind" :busy="busy || saveBusy" @switching="modelChanging = $event" @mode="selectedAiMode = $event" />
          <div v-if="!initialItems?.length || imageUrl" class="capture-area" :class="{ 'has-photo': imageUrl }">
            <button v-if="imageUrl" type="button" class="photo-preview-button" data-testid="enlarge-photo" aria-label="查看识别照片大图" @click="photoPreviewOpen = true"><img :src="imageUrl" alt="本餐识别照片" class="photo-preview" /><span>查看大图{{ previewPhotos.length > 1 ? ` · ${previewPhotos.length}张` : '' }}</span></button>
            <div class="capture-content">
              <span class="camera-orbit"><Camera :size="26" stroke-width="1.6" /></span>
              <h3>{{ imageUrl ? '照片已就绪' : '拍一张，记下这一餐' }}</h3>
              <p>一张照片，识别食物或包装标签<br />餐食核对重量，包装核对营养表</p>
              <div class="capture-buttons"><button class="button primary compact" :disabled="busy" @click="cameraOpen = true"><Camera :size="17" /> 拍照</button><button class="button white compact" :disabled="busy" @click="gallery?.click()"><ImagePlus :size="17" /> 选照片</button></div>
              <template v-if="photoFile"><button type="button" class="button secondary compact" :disabled="busy || saveBusy" data-testid="reanalyze-photo" @click="runRecognition"><RotateCcw :size="16"/>用当前模型重新分析</button><p class="tiny muted">可在上方切换模型，再分析同一张照片；替换食物清单前会确认。</p></template>
              <p class="tiny muted">JPEG / PNG / WebP · 原图最多 20 MB · 保存这餐时保留压缩照片到本机</p>
              <button v-if="imageUrl" type="button" class="text-button" :disabled="busy || saveBusy" data-testid="remove-meal-photo" @click="removePhotos">移除照片</button>
            </div>
          </div>
          <input ref="camera" data-testid="camera-input" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" @change="chooseFile" />
          <input ref="gallery" data-testid="gallery-input" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" @change="chooseFile" />
          <div v-if="busy" class="notice" role="status" data-testid="photo-recognition-progress"><LoaderCircle class="spin" :size="18" /><span>{{ phase === 'compressing' ? '正在压缩照片…' : recognitionProgress || '正在识别食物，请稍等…' }}</span><button v-if="offlineActive" type="button" class="text-button" data-testid="offline-photo-stop" @click="stopRecognition">停止识图</button></div>
          <div v-if="error" class="notice danger" role="alert" data-testid="editor-error"><Info :size="18" /><div>{{ error }}<button v-if="photoFile && phase === 'error'" class="text-button" @click="runRecognition"><RotateCcw :size="14" /> 重试识别</button></div></div>
          <div v-if="notice" class="notice"><Check :size="18" /><span>{{ notice }}</span></div>
          <div v-if="phase === 'done' && photoItems.length" class="recognition-summary" data-testid="recognition-summary"><div><span class="recognition-summary-icon"><Sparkles :size="19" /></span><div><h3>{{ recognitionOffline ? '本机离线识图' : mode === 'mock' ? '模拟识别' : '照片识别' }} {{ photoItems.length }} 项食物</h3><p>{{ recognitionOffline ? offlinePhotoSummary : `已自动匹配 ${photoMatches} 项 · ${photoWeights} 项已带入${mode === 'mock' ? '示例重量' : '照片估重'}` }}</p></div></div><ul class="recognition-overview"><li v-for="(entry, index) in photoItems" :key="entry.id"><button type="button" :data-testid="`recognized-row-${index}`" @click="scrollToFood(entry)"><span><strong>{{ entry.name }}</strong><small>{{ entryBasis(entry) }}</small></span><span :class="{ 'amber-text': entry.packageSnapshot ? entry.packageSnapshot.consumedAmount === null : entry.weightG === null }">{{ portionLabel(entry) }}<ChevronRight :size="14" /></span></button></li></ul><span>点击某项可修改，核对后一起保存</span></div>
          <div v-if="globalWarnings.length" class="notice warning"><Info :size="18" /><span>{{ globalWarnings.join(' ') }}</span></div>
          <div class="form-row meal-meta"><label>记录日期<DateField v-model="date" data-testid="editor-date" required /></label><label>餐次<select v-model="mealType" data-testid="editor-meal-type"><option v-for="type in mealTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label></div>
          <button class="button secondary full package-library-entry" data-testid="open-package-library" :disabled="busy || saveBusy" @click="openLibrary()"><PackageOpen :size="17" />包装食品库 · 搜索／扫码</button>
          <div class="section-heading"><h3>食物清单 <span class="count-pill">{{ items.length }}</span></h3><div class="editor-add-actions"><button class="text-button" data-testid="add-package" :disabled="busy" @click="addPackage"><PackageOpen :size="16" /> 包装食品</button><button class="text-button" data-testid="add-food" :disabled="busy" @click="addItem"><Plus :size="16" /> 添加食物</button></div></div>
          <div v-if="!items.length" class="editor-empty">拍照识别，或点「添加食物」从食品库选择。<br /><span class="tiny">无法匹配的数据会保留为待补充，不会当作零。</span></div>
          <article v-for="(entry, index) in items" :key="entry.id" class="food-edit-card" :data-testid="`food-item-${index}`">
            <div class="food-edit-heading"><span class="number-dot">{{ String(index + 1).padStart(2, '0') }}</span><label class="name-field"><span class="sr-only">食物名称</span><input v-model="entry.name" :data-testid="`food-name-${index}`" placeholder="食物名称，如：米饭" maxlength="200" @blur="matchManualName(entry)" /></label><button class="icon-button small" :aria-label="`删除食物 ${index + 1}`" @click="removeItem(entry)"><Trash2 :size="17" /></button></div>
            <div v-if="recognitionContexts[entry.id]" class="recognition-item-match" :data-testid="`recognition-match-${index}`"><span>{{ mode === 'mock' ? '示例' : '识别' }}：{{ recognitionContexts[entry.id]!.name }}</span><strong>{{ entry.kind === 'database' ? '已匹配食物库' : entry.kind === 'recipe' ? '已匹配参考配方' : entry.kind === 'label' ? '已读取包装 · 请填摄入量' : entry.kind === 'ai' ? entry.provenance.startsWith('个人估算库') ? '已匹配个人食物' : mode === 'mock' ? '模拟 AI 估算' : '采用 AI 估算' : entry.kind === 'manual' ? '手动营养数据' : '营养待补充' }}</strong></div>
            <PortionAmountInput v-if="!entry.packageSnapshot" :name="entry.name" :amount="entry.volumeSnapshot ? entry.volumeSnapshot.amountMl : entry.weightG" :basis="entry.volumeSnapshot ? 'ml' : 'g'" :portion="entry.portionSnapshot" :prefix="`food-portion-${index}`" :amount-test-id="entry.volumeSnapshot ? `food-volume-${index}` : `food-weight-${index}`" :disabled="busy || saveBusy" @change="changeAmount(entry, $event)" />
            <div class="food-picker-field"><span>选择食物</span><button type="button" :data-testid="`food-source-${index}`" :data-source-id="selectedSource(entry)" :value="selectedSource(entry)" aria-haspopup="dialog" :disabled="busy || saveBusy" @click="openFoodPicker(entry, $event)"><span>{{ entry.name || '打开食物库' }}<small>{{ entryBasis(entry) }} · 点击更换</small></span><ChevronRight :size="17" /></button></div>
            <p v-if="recognitionContexts[entry.id]" class="recognition-weight-note" :data-testid="`recognition-weight-${index}`"><Scale :size="13" /><span>{{ photoWeightLabel(entry) }}</span></p>
            <div class="basis-row"><span class="basis-tag" :class="{ 'basis-ai': entry.kind === 'ai' }" :data-testid="`food-basis-${index}`"><Sparkles v-if="entry.kind === 'ai'" :size="12" />{{ entryBasis(entry) }}</span><span v-if="entry.kind === 'ai'" class="tiny muted">非实测 · 可能有较大误差</span></div>
            <div class="food-store-action"><button type="button" class="food-store-button" :data-testid="`save-library-food-${index}`" :disabled="busy || saveBusy || storingFood || !entry.name.trim() || mode === 'mock' || containsMockEstimate" @click="storeFood(entry)"><BookHeart :size="16" /> 存为常用</button><span v-if="mode === 'mock' || containsMockEstimate" class="tiny muted">模拟识别不能存入个人库</span><span v-if="storedFoodMessages[entry.id]" class="tiny" role="status" :data-testid="`stored-food-message-${index}`">{{ storedFoodMessages[entry.id] }}</span></div>
            <PackageLabelEditor v-if="entry.packageSnapshot" :snapshot="entry.packageSnapshot" :index="index" @change="updatePackage(entry, $event)" />
            <button v-if="entry.packageSnapshot" class="text-button" :data-testid="`save-package-library-${index}`" :disabled="busy || saveBusy || entry.packageSnapshot.provider === 'mock'" @click="openLibrary(entry)">保存标签到我的包装库</button>
            <div v-if="entry.estimateProfile" class="estimate-profile">
              <div class="estimate-profile-heading"><span>{{ entry.estimateProfile.factor === 'sweetness' ? '按甜度与稠度调整' : entry.estimateProfile.factor === 'oil' ? '按用油量调整' : '选择估算档位' }}</span><span>默认中档 · 中值记账</span></div>
              <div class="estimate-levels" role="group" aria-label="选择估算档位"><button v-for="option in entry.estimateProfile.options" :key="option.level" type="button" :disabled="entry.kind === 'recipe' && (entry.weightG === null || entry.weightG <= 0)" :class="{ selected: (entry.estimateLevel ?? 'medium') === option.level }" :aria-pressed="(entry.estimateLevel ?? 'medium') === option.level" :data-testid="`estimate-${option.level}-${index}`" @click="chooseEstimateLevel(entry, option.level)">{{ option.label }}</button></div>
              <p v-if="entry.kind === 'recipe' && (entry.weightG === null || entry.weightG <= 0)" class="tiny amber-text">先填写成品重量再调整油量</p>
              <div class="estimate-range-summary"><strong>{{ rangeLabel(selectedEstimateOption(entry.estimateProfile, entry.estimateLevel ?? 'medium').rangesPer100g.energyKcal) }} <small>kcal / 100 g</small></strong><span>记账中值 {{ numberLabel(entry.nutrientsPer100g.energyKcal, 2) }} kcal / 100 g</span></div>
              <p :data-testid="`food-range-${index}`" class="portion-range">这一份{{ entry.weightG === null ? '重量待补充' : ` ${numberLabel(entry.weightG, 2)} g` }} · {{ calculateEnergyRange(entry) ? `约 ${rangeLabel(calculateEnergyRange(entry))} kcal` : '整份区间待补充' }}</p>
              <button class="text-button" :data-testid="`use-known-energy-${index}`" @click="showKnownEnergy(index)">知道确定热量？填写每 100 g 数值</button>
            </div>
            <details v-if="entry.aiEstimateSnapshot" class="ai-assumptions" :data-testid="`ai-assumptions-${index}`"><summary>查看估算假设 <ChevronDown :size="15" /></summary><p>{{ entry.aiEstimateSnapshot.assumptions.length ? entry.aiEstimateSnapshot.assumptions.join(' ') : '模型未提供具体配比。请特别核对食用油、糖、酱料与含水量。' }}</p><span class="tiny muted">{{ entry.aiEstimateSnapshot.provider }} / {{ entry.aiEstimateSnapshot.model }} · 仅作为饮食记录的粗略参考</span></details>
            <div v-if="entry.recipeSnapshot" class="recipe-details"><div class="recipe-title"><Sparkles :size="15" /> 参考配方 · 调整这一份的配料与油量</div><div class="ingredient-grid"><label v-for="ingredient in entry.recipeSnapshot.ingredients" :key="ingredient.id">{{ ingredient.name }}<div class="unit-input"><input :value="inputNumberLabel(ingredient.weightG)" :data-testid="`recipe-ingredient-${ingredient.id}-${index}`" type="number" min="0" max="20000" step="0.01" @input="ingredientChanged(entry, ingredient.id, $event)" /><span>g</span></div></label></div><p class="tiny muted">配料重量按当前份量缩放。请以实际摄入量为准；调整配料时，成品总重仍按上方可食重量计算。</p></div>
            <div v-if="entry.warnings.length" class="food-warnings"><Info :size="14" /><span>{{ entry.warnings.join(' ') }}</span></div>
            <details v-if="!entry.packageSnapshot" class="nutrition-details" :data-testid="`nutrition-details-${index}`"><summary>{{ entry.volumeSnapshot ? '每100 mL营养 · 可手动修改' : entry.estimateProfile ? '输入确定值／修改每 100 g 营养' : '每 100 g 营养 · 可手动修改' }} <ChevronDown :size="16" /></summary><div class="nutrient-inputs"><label v-for="field in nutrientFields" :key="field.key">{{ field.key === 'energyKcal' ? '确定热量' : field.label }} <span class="muted">{{ field.unit }}</span><input :value="inputNumberLabel((entry.volumeSnapshot?.nutrientsPer100ml ?? entry.nutrientsPer100g)[field.key])" :data-testid="`food-${field.key}-${index}`" type="number" min="0" :max="(field.key === 'energyKcal' ? 1000 : 100) * (entry.volumeSnapshot ? 2 : 1)" step="0.01" placeholder="待补充" @input="nutrientChanged(entry, field.key, $event)" /><span v-if="entry.estimateProfile" class="nutrient-range-hint">范围 {{ rangeLabel(selectedEstimateOption(entry.estimateProfile, entry.estimateLevel ?? 'medium').rangesPer100g[field.key]) }}</span></label></div><p class="tiny source-note">来源：{{ entry.provenance }}</p><p v-if="entry.estimateProfile" class="tiny muted">填写确定值会撤销此食物的估算区间；未修改的营养字段保留当前值。</p></details>
            <div class="food-estimate"><span>{{ entryBasis(entry) }}</span><strong :data-testid="`food-calories-${index}`">{{ calculateNutrients(entry).energyKcal === null ? '待补充' : `约 ${numberLabel(calculateNutrients(entry).energyKcal)} kcal` }}</strong></div>
          </article>
          <p class="editor-footnote">照片无法准确判断份量、烹饪方式和隐藏配料。称重与包装营养表能帮助你记录得更准确。</p>
        </div>
        <div v-if="items.length > 1" class="editor-store-all"><BookHeart :size="18" /><div><strong>这几样，经常吃？</strong><span>存下当前份量和营养，下次直接选</span></div><button type="button" class="button secondary compact" data-testid="save-all-library-foods" :disabled="busy || saveBusy || storingFood || mode === 'mock' || containsMockEstimate" @click="storeAllFoods">{{ storingFood ? '存入中…' : '全部存为常用' }}</button></div>
        <footer class="editor-footer"><div><span class="tiny muted">{{ !items.length ? '添加食物后汇总' : totals.incompleteEntries ? '已知部分估算' : '这一餐估算' }}</span><div class="footer-calories">{{ items.length ? "约 " + numberLabel(totals.energyKcal.known) : "—" }} <span>kcal</span></div><span v-if="totals.incompleteEntries" class="tiny amber-text">{{ totals.incompleteEntries }} 项营养待补充</span></div><button class="button primary" data-testid="save-meal" :disabled="busy || saveBusy || !items.length" @click="submit"><LoaderCircle v-if="saveBusy" class="spin" :size="18" /><Check v-else :size="18" /> {{ saveBusy ? '保存中' : '保存记录' }}</button></footer>
      </section>
    </div>
  </Teleport>
  <CapturePhoto v-if="cameraOpen" :meal-type="mealType" @close="cameraOpen = false" @capture="captured" @barcode="scanned" @skip="skipCamera" />
  <PhotoViewer v-if="photoPreviewOpen" :photos="previewPhotos" title="查看照片" test-id="photo-preview-sheet" @close="photoPreviewOpen = false"/>
  <PackagedLibrary v-if="libraryOpen" :candidate="libraryCandidate" :initial-barcode="barcodeFromCamera" @close="closeLibrary" @select="usePackage" />
  <ManualFoodSheet v-if="manualFoodOpen" initial-stage="foods" :personal-foods="personalFoods" :packaged-foods="packagedFoods" @changed="reloadPackages" @close="cancelManualFood" @add="confirmManualFood" />
  <FoodPicker v-if="pickerEntry" :entry="pickerEntry" :selected-id="selectedSource(pickerEntry)" :personal-foods="personalFoods" :packaged-foods="packagedFoods" @packages="closeFoodPicker(); openLibrary()" :ai-candidate="aiCandidates[pickerEntry.id]" :recognition="recognitionContexts[pickerEntry.id]" :mock="mode === 'mock' || containsMockEstimate" @close="closeFoodPicker" @select="selectFood" />
</template>
