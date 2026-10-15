<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Utensils, Scale, SlidersHorizontal, Camera, Leaf, Check, X, LoaderCircle } from '@lucide/vue'
import type { MealRecord, MealType, WeightRecord, Settings, EstimatedFood } from '@shike/shared'
import DiaryView from './views/DiaryView.vue'
import WeightView from './views/WeightView.vue'
import SettingsView from './views/SettingsView.vue'
import FoodEditor from './components/FoodEditor.vue'
import { db, loadData, saveMeal } from './lib/db'
import { getHealth, type Health } from './lib/api'
import { localDate } from './lib/dates'
const tab = ref<'diary' | 'weight' | 'settings'>('diary')
const date = ref(localDate())
const meals = ref<MealRecord[]>([])
const weights = ref<WeightRecord[]>([])
const estimatedFoods = ref<EstimatedFood[]>([])
const settings = ref<Settings>({ targetWeightKg: null })
const health = ref<Health | null>(null)
const healthError = ref('')
const storageError = ref('')
const loading = ref(true)
const toast = ref('')
const editor = ref<{ record?: MealRecord; mealType: MealType; start: 'photo' | 'manual' | 'edit' } | null>(null)
const editorRef = ref<InstanceType<typeof FoodEditor> | null>(null)
let toastTimeout: ReturnType<typeof setTimeout>
const tabs = [{ value: 'diary' as const, label: '饮食', icon: Utensils }, { value: 'weight' as const, label: '体重', icon: Scale }, { value: 'settings' as const, label: '设置', icon: SlidersHorizontal }]
function notify(message: string) { toast.value = message; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { toast.value = '' }, 3800) }
async function refresh() { try { const data = await loadData(); meals.value = data.meals; weights.value = data.weights; estimatedFoods.value = data.estimatedFoods; settings.value = data.settings; storageError.value = '' } catch { storageError.value = '无法读取浏览器存储。请允许本站使用本地存储，并检查磁盘空间。' } }
async function checkHealth() { try { health.value = await getHealth(); healthError.value = '' } catch { health.value = null; healthError.value = 'AI 服务暂时无法连接，请确认后端已启动' } }
onMounted(async () => { await Promise.all([refresh(), checkHealth()]); loading.value = false })
function add(mealType: MealType, start: 'photo' | 'manual') { editor.value = { mealType, start } }
function edit(record: MealRecord) { editor.value = { record, mealType: record.mealType, start: 'edit' } }
async function persist(record: MealRecord) { try { await saveMeal(record); date.value = record.date; await refresh(); editor.value = null; notify('这一餐已保存') } catch { editorRef.value?.saveFailed('保存失败，草稿已保留。请检查浏览器存储权限与剩余空间。') } }
async function remove(record: MealRecord) { if (!window.confirm('确定删除这条饮食记录？')) return; try { await db.meals.delete(record.id); await refresh(); notify('饮食记录已删除') } catch { notify('删除失败，请检查浏览器存储状态') } }
</script>

<template>
  <div class="app-shell">
    <header class="app-header"><a class="brand" href="#" aria-label="食刻首页" @click.prevent="tab = 'diary'"><span class="brand-icon"><Leaf :size="23" stroke-width="1.7" /></span><span class="brand-name">食刻<small>SHIKE</small></span></a><nav class="desktop-nav" aria-label="主导航"><button v-for="item in tabs" :key="item.value" :class="{ active: tab === item.value }" :data-testid="`desktop-tab-${item.value}`" @click="tab = item.value"><component :is="item.icon" :size="17" /> {{ item.label }}{{ item.value === 'diary' ? '记录' : item.value === 'weight' ? '管理' : '' }}</button></nav><div class="header-trailing"><span class="local-chip"><span class="status-dot"></span> 本地保存</span><span v-if="health?.mode === 'mock'" class="header-mock" data-testid="header-mock">模拟模式</span><button class="button primary header-add" data-testid="header-camera" @click="add('lunch', 'photo')"><Camera :size="17" /> 记录一餐</button></div></header>
    <main class="main-container"><div v-if="storageError" class="notice danger" role="alert">{{ storageError }}</div><div v-if="healthError && tab === 'diary'" class="notice warning">{{ healthError }} · 可以先手动记录。</div><div v-if="loading" class="loading-page"><LoaderCircle class="spin" :size="30" /><p>正在打开你的记录…</p></div><template v-else><DiaryView v-if="tab === 'diary'" :date="date" :meals="meals" @date="date = $event" @add="add" @edit="edit" @remove="remove" /><WeightView v-else-if="tab === 'weight'" :weights="weights" :settings="settings" @changed="refresh" @notify="notify" /><SettingsView v-else :health="health" :health-error="healthError" :estimated-foods="estimatedFoods" @changed="refresh" @notify="notify" @check-health="checkHealth" /></template></main>
    <nav class="mobile-nav" aria-label="手机主导航"><button v-for="item in tabs.slice(0, 2)" :key="item.value" :class="{ active: tab === item.value }" :data-testid="`tab-${item.value}`" @click="tab = item.value"><component :is="item.icon" :size="21" stroke-width="1.7"/><span>{{ item.label }}</span></button><button class="mobile-capture" data-testid="mobile-camera" aria-label="拍照记录" @click="add('lunch', 'photo')"><Camera :size="25" /><span>记录</span></button><button :class="{ active: tab === 'settings' }" data-testid="tab-settings" @click="tab = 'settings'"><SlidersHorizontal :size="21" stroke-width="1.7"/><span>设置</span></button></nav>
    <FoodEditor v-if="editor" ref="editorRef" :date="date" :record="editor.record" :meal-type="editor.mealType" :start="editor.start" :health="health" :estimated-foods="estimatedFoods" @close="editor = null" @save="persist" />
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status" data-testid="toast"><Check :size="18" /> {{ toast }}<button aria-label="关闭提示" @click="toast = ''"><X :size="15" /></button></div></Transition>
  </div>
</template>
