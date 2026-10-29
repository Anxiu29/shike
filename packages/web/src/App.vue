<script setup lang="ts">
/**
 * 应用协调层：tab 切换四个主页面，props 向下传数据，子组件 emit 事件请求刷新或保存。
 * 没有 Vue Router/Pinia：这里的 ref 是当前会话状态，IndexedDB 才是已保存记录的来源。
 * 仅目标页用 KeepAlive 保留表单实例；草稿和滚动位置不跨刷新或进程回收保存。
 * 安卓返回顺序：最上层弹窗 → 目标上一组 → 主页面访问历史（最多50步）→ 饮食首页。
 * 首页2秒内再次返回调用 minimizeApp；其它操作、子层返回、前后台切换取消确认。
 * 不依赖 WebView canGoBack，也没有接管普通浏览器的后退历史。
 * 阅读 androidBack/navigate、refresh/persist，再对照模板中的 props 与 @事件。
 */
import { nextTick, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { Utensils, Scale, SlidersHorizontal, Camera, Check, X, LoaderCircle, Target, ChevronRight } from '@lucide/vue'
import type { FoodEntry, LibraryFood, PackagedFood, MealRecord, MealType, WeightRecord, Settings, EstimatedFood, WaterRecord, ExerciseRecord, DailyPlan } from '@shike/shared'
import { liveQuery } from 'dexie'
import DiaryView from './views/DiaryView.vue'
import WeightView from './views/WeightView.vue'
import SettingsView from './views/SettingsView.vue'
import GoalsView from './views/GoalsView.vue'
import FoodEditor from './components/FoodEditor.vue'
import PersonalFoodLibrary from './components/PersonalFoodLibrary.vue'
import ManualFoodSheet from './components/ManualFoodSheet.vue'
import MealAssistant from './components/MealAssistant.vue'
import CapturePhoto from './components/CapturePhoto.vue'
import AppToast from './components/AppToast.vue'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { backLayers } from './lib/use-back-layer'
import { useAndroidBack } from './lib/use-android-back'
import { db, loadData, saveMeal, deleteMeal, saveLibraryFood } from './lib/db'
import { getHealth, type Health } from './lib/api'
import { dateLabel, localDate, suggestedMealType } from './lib/dates'
import { duplicateMealDraft } from './lib/diary-shortcuts'
import type { ToastAction } from './lib/toast'
import { notifyKey } from './lib/toast'
// Android部分WebView在沉浸模式下的env安全区为0，用有限的CSS留白回退保护状态栏。
document.documentElement.classList.toggle('native-app', Capacitor.isNativePlatform())
const tab = ref<'diary' | 'weight' | 'goals' | 'settings'>('diary')
const date = ref(localDate())
const meals = ref<MealRecord[]>([])
const weights = ref<WeightRecord[]>([])
const estimatedFoods = ref<EstimatedFood[]>([])
const libraryFoods = ref<LibraryFood[]>([]), personalLibraryOpen = ref(false)
const photoMealIds = ref<string[]>([]), deletingMeal = ref<string | null>(null)
const personalCreateOpen = ref(false), personalCreateRef = ref<InstanceType<typeof ManualFoodSheet> | null>(null), personalPackages = ref<PackagedFood[]>([])
let librarySubscription: { unsubscribe: () => void } | undefined
onMounted(() => { librarySubscription = liveQuery(async () => ({ foods: await db.libraryFoods.toArray(), photos: await db.mealPhotos.orderBy('mealId').uniqueKeys() })).subscribe({ next: data => { libraryFoods.value = data.foods; photoMealIds.value = data.photos as string[] }, error: () => { notify('常用食物读取失败，请重新打开应用') } }) })
onBeforeUnmount(() => librarySubscription?.unsubscribe())
const water = ref<WaterRecord[]>([])
const exercises = ref<ExerciseRecord[]>([])
const dailyPlans = ref<DailyPlan[]>([])
const settings = ref<Settings>({ targetWeightKg: null })
const health = ref<Health | null>(null)
const healthError = ref(''), checkingHealth = ref(false)
const storageError = ref('')
const loading = ref(true)
const toast = ref('')
const toastAction = ref<ToastAction | null>(null), undoBusy = ref(false)
const editor = ref<{ record?: MealRecord; date?: string; mealType: MealType; start: 'photo' | 'manual' | 'edit'; initialItems?: FoodEntry[]; initialMode?: MealRecord['mode']; reuseSource?: string; initialPhoto?: File; initialPhotos?: string[]; photoKind?: 'food' | 'label'; initialBarcode?: string } | null>(null)
const editorRef = ref<InstanceType<typeof FoodEditor> | null>(null)
let toastTimeout: ReturnType<typeof setTimeout>
const tabs = [{ value: 'diary' as const, label: '饮食', icon: Utensils }, { value: 'weight' as const, label: '体重', icon: Scale }, { value: 'goals' as const, label: '目标', icon: Target }, { value: 'settings' as const, label: '设置', icon: SlidersHorizontal }]
function notify(message: string, action?: ToastAction) { toast.value = message; toastAction.value = action ?? null; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { toast.value = ''; toastAction.value = null }, action ? 6500 : 3800) }
provide(notifyKey, notify)
async function undoToast() {
  if (!toastAction.value || undoBusy.value) return
  const action = toastAction.value
  undoBusy.value = true; clearTimeout(toastTimeout)
  try { await action.run(); if (toastAction.value === action) notify('已撤销') }
  catch { if (toastAction.value === action) notify('撤销失败，请重试', action) }
  finally { undoBusy.value = false }
}
const scrollPositions = new Map<string, number>()
const tabHistory: Array<typeof tab.value> = []
let leaveArmedUntil = 0
function resetBackConfirmation() { leaveArmedUntil = 0 }
async function navigate(next: typeof tab.value, remember = true) {
  if (tab.value === next) return
  resetBackConfirmation()
  if (remember) { tabHistory.push(tab.value); if (tabHistory.length > 50) tabHistory.shift() }
  scrollPositions.set(tab.value, window.scrollY); tab.value = next
  await nextTick()
  if (tab.value === next) window.scrollTo({ top: scrollPositions.get(next) ?? 0, behavior: 'instant' })
}
async function androidBack() {
  if (backLayers.hasActive) resetBackConfirmation()
  await backLayers.back(async () => {
    const previous = tabHistory.pop()
    if (previous) { await navigate(previous, false); return }
    if (tab.value !== 'diary') { await navigate('diary', false); return }
    if (performance.now() < leaveArmedUntil) {
      resetBackConfirmation()
      await App.minimizeApp()
    } else {
      leaveArmedUntil = performance.now() + 2000
      notify('再返回一次退到后台')
    }
  })
}
useAndroidBack(androidBack, resetBackConfirmation, () => notify('返回操作未完成，请使用页面返回按钮重试'))
// 点击其它操作即取消退到后台的确认，避免打开、关掉弹窗后意外离开。
onMounted(() => { window.addEventListener('pointerdown', resetBackConfirmation, true); window.addEventListener('keydown', resetBackConfirmation, true) })
onBeforeUnmount(() => { clearTimeout(toastTimeout); window.removeEventListener('pointerdown', resetBackConfirmation, true); window.removeEventListener('keydown', resetBackConfirmation, true) })

async function refresh() { try { const data = await loadData(); meals.value = data.meals; weights.value = data.weights; estimatedFoods.value = data.estimatedFoods; settings.value = data.settings; water.value = data.water; exercises.value = data.exercises; dailyPlans.value = data.dailyPlans; storageError.value = '' } catch { storageError.value = '无法读取浏览器存储。请允许本站使用本地存储，并检查磁盘空间。' } }
let healthRequest = 0
async function checkHealth() {
  const current = ++healthRequest
  checkingHealth.value = true
  try { const result = await getHealth(); if (current === healthRequest) { health.value = result; healthError.value = '' } }
  catch (error) { if (current === healthRequest) { health.value = null; healthError.value = error instanceof Error ? error.message : 'AI 服务暂时无法连接，请检查网络和设置中的服务地址' } }
  finally { if (current === healthRequest) checkingHealth.value = false }
}
// 打开本地记录不等待网络探测；断网时也能立即进入饮食和体重页面。
onMounted(async () => { await refresh(); loading.value = false; void checkHealth() })
const cameraMeal = ref<MealType | null>(null)
let cameraReturnFocus: HTMLElement | null = null
function add(mealType: MealType, start: 'photo' | 'manual') { if (start === 'photo' && (Capacitor.isNativePlatform() || window.matchMedia('(max-width: 767px)').matches)) { cameraReturnFocus = document.activeElement as HTMLElement; cameraMeal.value = mealType } else editor.value = { mealType, start } }
async function closeCamera() { cameraMeal.value = null; await nextTick(); cameraReturnFocus?.focus({ preventScroll: true }) }
function captured(file: File, kind: 'food' | 'label', mealType: MealType) { cameraMeal.value = null; editor.value = { mealType, start: 'photo', initialPhoto: file, photoKind: kind } }
function capturedBarcode(value: string, mealType: MealType) { cameraMeal.value = null; editor.value = { mealType, start: 'photo', initialBarcode: value } }
function skipCamera(mealType: MealType, kind: string) { cameraMeal.value = null; editor.value = { mealType, start: 'photo', ...(kind === 'barcode' ? { initialBarcode: '' } : {}) } }
function edit(record: MealRecord) { editor.value = { record, mealType: record.mealType, start: 'edit' } }
function reuse(record: MealRecord, targetDate: string) {
  const draft = duplicateMealDraft(record, targetDate)
  editor.value = { date: draft.date, mealType: draft.mealType, start: 'edit', initialItems: draft.items, initialMode: draft.mode, reuseSource: dateLabel(record.date) + ' · ' + ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[record.mealType]) }
}
async function quickAdd(entry: FoodEntry) { personalLibraryOpen.value = false; await nextTick(); editor.value = { mealType: suggestedMealType(), start: 'edit', initialItems: [entry] } }
async function createLibraryFood() {
  personalLibraryOpen.value = false
  try { personalPackages.value = await db.packagedFoods.toArray() } catch { personalPackages.value = []; notify('包装标签暂时无法读取，仍可手动添加常用食物') }
  await nextTick(); personalCreateOpen.value = true
}
async function closeLibraryCreate() { personalCreateOpen.value = false; await nextTick(); personalLibraryOpen.value = true }
async function savePersonalFood(entry: FoodEntry) {
  try { await saveLibraryFood(entry, 'manual'); await closeLibraryCreate(); notify('已存为常用食物') }
  catch { personalCreateRef.value?.saveFailed('常用食物保存失败，填写内容已保留，请重试。') }
}
async function persist(record: MealRecord, photos?: string[]) { try { await saveMeal(record, db, photos); date.value = record.date; await refresh(); editor.value = null; notify('这一餐已保存') } catch { editorRef.value?.saveFailed('保存失败，草稿与照片已保留。请检查浏览器存储权限与剩余空间。') } }
async function remove(record: MealRecord) {
  if (deletingMeal.value || !window.confirm('确定删除这条饮食记录及其照片？')) return
  deletingMeal.value = record.id
  try {
    const photos = await db.mealPhotos.where('mealId').equals(record.id).toArray()
    await deleteMeal(record.id); await refresh()
    notify('饮食记录已删除', { label: '撤销', run: async () => {
      await db.transaction('rw', [db.meals, db.mealPhotos], async () => {
        if (await db.meals.get(record.id)) throw new Error('记录已存在')
        await db.meals.add(JSON.parse(JSON.stringify(record))); await db.mealPhotos.bulkAdd(photos)
      }); await refresh()
    } })
  } catch { notify('删除失败，请检查浏览器存储状态') }
  finally { deletingMeal.value = null }
}
async function assistantSaved(record: MealRecord) { date.value = record.date; await refresh(); notify('这一餐已保存') }
function assistantReview(record: MealRecord, photos: string[]) { editor.value = { record, mealType: record.mealType, start: 'edit', initialPhotos: photos } }
</script>

<template>
  <div class="app-shell" :inert="cameraMeal !== null" :aria-hidden="cameraMeal !== null ? 'true' : undefined">
    <header class="app-header">
      <nav class="desktop-nav" aria-label="主导航"><button v-for="item in tabs" :key="item.value" :class="{ active: tab === item.value }" :data-testid="`desktop-tab-${item.value}`" @click="navigate(item.value)"><component :is="item.icon" :size="17" /> {{ item.label }}{{ item.value === 'diary' ? '记录' : item.value === 'weight' ? '管理' : '' }}</button></nav>
      <div class="header-trailing"><span v-if="health?.mode === 'mock'" class="header-mock" data-testid="header-mock">模拟模式</span><button class="button primary header-add" data-testid="header-camera" @click="add(suggestedMealType(), 'photo')"><Camera :size="17" /> 记录一餐</button></div>
    </header>
    <main class="main-container"><div v-if="storageError" class="notice danger" role="alert">{{ storageError }}</div><button v-if="healthError && tab === 'diary'" class="connection-hint" data-testid="ai-connection-hint" @click="navigate('settings')"><span class="status-dot offline"></span>拍照 AI 暂未连接，手动记录照常使用<ChevronRight :size="14" /></button><div v-if="loading" class="loading-page"><LoaderCircle class="spin" :size="30" /><p>正在打开你的记录…</p></div><template v-else><DiaryView v-if="tab === 'diary'" :date="date" :meals="meals" :settings="settings" :weights="weights" :water="water" :exercises="exercises" :daily-plans="dailyPlans" :library-foods="libraryFoods" :photo-meal-ids="photoMealIds" :deleting-meal="deletingMeal" @library="personalLibraryOpen = true" @quick-add="quickAdd" @changed="refresh" @notify="notify" @goals="navigate('goals')" @date="date = $event" @add="add" @edit="edit" @reuse="reuse" @remove="remove" /><WeightView v-else-if="tab === 'weight'" :weights="weights" :settings="settings" @changed="refresh" @notify="notify" /><SettingsView v-else-if="tab === 'settings'" :health="health" :health-error="healthError" :checking-health="checkingHealth" :estimated-foods="estimatedFoods" @changed="refresh" @notify="notify" @check-health="checkHealth" @open-food-library="personalLibraryOpen = true" /><KeepAlive><GoalsView v-if="tab === 'goals'" :settings="settings" :weights="weights" @changed="refresh" @notify="notify" /></KeepAlive></template></main>
    <nav class="mobile-nav" aria-label="手机主导航"><button v-for="item in tabs.slice(0, 2)" :key="item.value" :class="{ active: tab === item.value }" :data-testid="`tab-${item.value}`" @click="navigate(item.value)"><component :is="item.icon" :size="21" stroke-width="1.7"/><span>{{ item.label }}</span></button><button class="mobile-capture" data-testid="mobile-camera" aria-label="拍照记录" @click="add(suggestedMealType(), 'photo')"><Camera :size="25" /><span>记录</span></button><button :class="{ active: tab === 'goals' }" data-testid="tab-goals" @click="navigate('goals')"><Target :size="21" stroke-width="1.7"/><span>目标</span></button><button :class="{ active: tab === 'settings' }" data-testid="tab-settings" @click="navigate('settings')"><SlidersHorizontal :size="21" stroke-width="1.7"/><span>设置</span></button></nav>
    <FoodEditor v-if="editor" ref="editorRef" :date="editor.date ?? date" :record="editor.record" :meal-type="editor.mealType" :start="editor.start" :initial-items="editor.initialItems" :initial-mode="editor.initialMode" :reuse-source="editor.reuseSource" :initial-photo="editor.initialPhoto" :initial-photos="editor.initialPhotos" :photo-kind="editor.photoKind" :initial-barcode="editor.initialBarcode" :health="health" :estimated-foods="estimatedFoods" @close="editor = null" @save="persist" />
  </div>
  <AppToast :message="toast" :action="toastAction" :busy="undoBusy" @undo="undoToast" @close="toast = ''; toastAction = null"/>
  <ManualFoodSheet v-if="personalCreateOpen" ref="personalCreateRef" purpose="library" :personal-foods="estimatedFoods" :packaged-foods="personalPackages" @close="closeLibraryCreate" @add="savePersonalFood" />
  <PersonalFoodLibrary v-if="personalLibraryOpen" :foods="libraryFoods" @close="personalLibraryOpen = false" @add="quickAdd" @create="createLibraryFood" @changed="refresh" @notify="notify" />
  <CapturePhoto v-if="cameraMeal" :meal-type="cameraMeal" @close="closeCamera" @capture="captured" @barcode="capturedBarcode" @skip="skipCamera" />
  <MealAssistant v-if="!loading" :date="date" :available="tab !== 'settings' && !editor && !cameraMeal && !personalLibraryOpen && !personalCreateOpen" :health="health" :personal-foods="estimatedFoods" @saved="assistantSaved" @review="assistantReview" />
</template>
