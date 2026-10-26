<script setup lang="ts">
import { ref } from 'vue'
import { Download, Upload, ShieldCheck, Database, ArrowUpRight, Info, Check, LoaderCircle, HardDrive, Sparkles, BookOpen, Bookmark, Package, ChevronRight, SlidersHorizontal } from '@lucide/vue'
import { foods, catalogFoods, recipes, personalProviderName, type Backup, type EstimatedFood } from '@shike/shared'
import { db, exportBackup, parseBackup, restoreBackup } from '../lib/db'
import type { Health } from '../lib/api'
import { personalVisionSupported } from '../lib/personal-vision'
import { saveBackupFile } from '../lib/backup-file'
import AIConnection from '../components/AIConnection.vue'
import PackagedLibrary from '../components/PackagedLibrary.vue'
import AppUpdates from '../components/AppUpdates.vue'
import EstimatedFoodLibrary from '../components/EstimatedFoodLibrary.vue'
const libraryOpen = ref(false)
const props = defineProps<{ health: Health | null; healthError: string; estimatedFoods: EstimatedFood[]; checkingHealth?: boolean }>()
const emit = defineEmits<{ changed: []; notify: [message: string]; checkHealth: []; openFoodLibrary: [] }>()
const native = personalVisionSupported()
function jumpTo(id: string) {
  const section = document.getElementById(id)
  section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  section?.focus({ preventScroll: true })
}
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<Backup | null>(null)
const filename = ref('')
const error = ref('')
const busy = ref(false)
const basicFoodCount = foods.filter(food => food.source.dataset === 'USDA SR Legacy').length
const surveyFoodCount = foods.filter(food => food.source.dataset === 'USDA FNDDS').length
const chineseFoodCount = foods.filter(food => food.source.dataset === 'TFDA 食品营养成分').length
async function download() {
  busy.value = true; error.value = ''
  try {
    const backup = await exportBackup()
    await saveBackupFile(backup)
    emit('notify', '备份已导出，请妥善保存')
  } catch { error.value = '导出失败，请检查浏览器存储状态。' }
  finally { busy.value = false }
}
async function chooseBackup(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''; pending.value = null; error.value = ''
  if (!file) return
  try { if (file.size > 20 * 1024 * 1024) throw new Error('备份不能超过 20 MB。'); pending.value = parseBackup(await file.text()); filename.value = file.name }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取备份。' }
}
async function restore() {
  if (!pending.value) return
  busy.value = true; error.value = ''
  try { await restoreBackup(pending.value); pending.value = null; emit('changed'); emit('notify', '备份已完整恢复') }
  catch { error.value = '恢复失败，原有记录已保留。请检查存储空间后重试。' }
  finally { busy.value = false }
}
async function removeEstimate(food: EstimatedFood) {
  if (!window.confirm(`删除个人估算「${food.name}」？已保存的历史饮食快照不受影响。`)) return
  try { await db.estimatedFoods.delete(food.id); emit('changed'); emit('notify', '个人估算已删除，历史记录仍保留') }
  catch { error.value = '删除失败，请检查浏览器存储状态。' }
}
</script>

<template>
  <section class="settings-page" data-testid="settings-page">
    <header class="settings-page-heading">
      <div><span class="eyebrow">按自己的习惯，好好记录</span><h1>设置<span class="settings-heading-dot">.</span></h1><p>把模型、食物和数据，整理到顺手的位置。</p></div>
      <span class="settings-heading-icon"><SlidersHorizontal :size="29" stroke-width="1.5" /></span>
    </header>
    <nav class="settings-section-nav" aria-label="设置分类"><button type="button" @click="jumpTo('settings-ai')"><Sparkles :size="15" />AI 与模型</button><button type="button" @click="jumpTo('settings-data')"><Database :size="15" />数据与食物</button><button type="button" @click="jumpTo('settings-about')"><ShieldCheck :size="15" />隐私与说明</button></nav>

    <section id="settings-ai" class="settings-group" tabindex="-1" aria-labelledby="settings-ai-title">
      <div class="settings-group-heading"><span>01</span><div><h2 id="settings-ai-title">AI 与模型</h2><p>{{ native ? '你的 Key、可用型号和识别方式。' : '先确认服务状态，再选择这台浏览器使用的模型。' }}</p></div></div>
      <AIConnection :health="health" :health-error="healthError" :checking-health="checkingHealth" @changed="emit('checkHealth')" @check-health="emit('checkHealth')" />
      <article v-if="native" class="card settings-card settings-native-status"><div class="settings-card-title"><span class="settings-feature-icon"><Sparkles :size="21" /></span><div><h2>AI 识别服务</h2><p>状态只表示配置，实际可用性以调用为准。</p></div></div><div class="service-status"><span class="status-dot" :class="{ offline: !health, mock: health?.mode === 'mock' }"></span><strong>{{ health ? health.mode === 'mock' ? '模拟模式' : '真实模式已配置' : '服务未连接' }}</strong><button class="text-button" data-testid="refresh-health" @click="emit('checkHealth')">重新检查</button></div><dl v-if="health" class="service-details"><div><dt>提供商</dt><dd>{{ personalProviderName(health.provider) }}</dd></div><div><dt>当前模型</dt><dd>{{ health.model }}</dd></div></dl><p v-if="healthError" class="notice danger">{{ healthError }} · 手动记录仍可使用。</p></article>
    </section>

    <section id="settings-data" class="settings-group" tabindex="-1" aria-labelledby="settings-data-title">
      <div class="settings-group-heading"><span>02</span><div><h2 id="settings-data-title">数据与食物</h2><p>管理常用食物，给本地记录留一份备份。</p></div></div>
      <div class="settings-data-grid">
        <article class="card settings-card settings-backup-card" data-testid="settings-backup-card">
          <div class="settings-card-title"><span class="settings-feature-icon"><Database :size="22" stroke-width="1.6" /></span><div><h2>备份与恢复</h2><p>记录保存在此设备，建议定期导出。</p></div></div>
          <div class="backup-buttons"><button class="button primary" data-testid="export-backup" :disabled="busy" @click="download"><Download :size="17" />导出备份</button><button class="button secondary" data-testid="import-backup" :disabled="busy" @click="fileInput?.click()"><Upload :size="17" />恢复备份</button></div>
          <input ref="fileInput" data-testid="backup-input" class="sr-only" type="file" accept="application/json,.json" @change="chooseBackup" />
          <p class="settings-backup-note"><ShieldCheck :size="15" /><span>包含饮食、体重、目标、活动和个人食物，照片与 API Key 不进入备份。</span></p>
          <details class="settings-inline-details"><summary>备份包含什么？</summary><p>JSON 备份包含饮食、体重、个人资料、目标、个人食品与收藏、包装食品、个人估算、饮水、运动、份量与每日预算快照。清理浏览器数据、无痕模式或换设备后，本地记录可能无法保留。</p></details>
          <div v-if="pending" class="backup-preview" data-testid="backup-preview"><h3>备份检查通过</h3><p class="small-text">{{ filename }}</p><div class="preview-counts"><span><strong>{{ pending.libraryFoods.length }}</strong> 项个人食品／收藏</span><span><strong>{{ pending.packagedFoods.length }}</strong> 项包装食品</span><span><strong>{{ pending.meals.length }}</strong> 条饮食</span><span><strong>{{ pending.weights.length }}</strong> 条体重</span><span><strong>{{ pending.estimatedFoods.length }}</strong> 项个人估算</span><span><strong>{{ pending.water.length }}</strong> 条饮水</span><span><strong>{{ pending.exercises.length }}</strong> 条运动</span></div><p class="amber-text small-text">恢复会完整替换当前设备的所有记录、个人资料、目标、个人食品与收藏。建议先导出当前备份。</p><div class="backup-buttons"><button class="button primary" data-testid="confirm-restore" :disabled="busy" @click="restore"><LoaderCircle v-if="busy" class="spin" :size="17" /><Check v-else :size="17" />确认替换并恢复</button><button class="text-button" :disabled="busy" @click="pending = null">取消</button></div></div>
        </article>
        <article class="card settings-card settings-food-tools"><div class="settings-card-title"><span class="settings-feature-icon"><Bookmark :size="22" stroke-width="1.6" /></span><div><h2>我的食物</h2><p>把常吃的留下，下次记录更快。</p></div></div><button type="button" class="settings-tool-row" data-testid="settings-food-library" @click="emit('openFoodLibrary')"><span class="settings-tool-icon"><Bookmark :size="19" /></span><span><strong>常用食物库</strong><small>管理个人食物与收藏，快速加入一餐</small></span><ChevronRight :size="18" /></button><button type="button" class="settings-tool-row" data-testid="manage-packaged-foods" @click="libraryOpen = true"><span class="settings-tool-icon"><Package :size="19" /></span><span><strong>包装食品库</strong><small>已存营养标签、商品条码与免费查询</small></span><ChevronRight :size="18" /></button></article>
      </div>
      <EstimatedFoodLibrary :foods="estimatedFoods" @remove="removeEstimate" />
    </section>

    <section id="settings-about" class="settings-group" tabindex="-1" aria-labelledby="settings-about-title">
      <div class="settings-group-heading"><span>03</span><div><h2 id="settings-about-title">隐私与说明</h2><p>了解数据留在哪里，以及营养数字从何而来。</p></div></div>
      <div class="settings-about-grid"><article class="card settings-card"><div class="settings-card-title"><span class="settings-feature-icon"><HardDrive :size="21" /></span><div><h2>本地保存，由你掌握</h2><p>记录不会自动同步到其他设备。</p></div></div><ul class="settings-privacy-list"><li><ShieldCheck :size="16" /><span>饮食、体重和个人食物保存在当前设备的本地数据库。</span></li><li><Sparkles :size="16" /><span>使用 AI 时，照片发送给所选提供商，受其数据政策约束。</span></li><li><Info :size="16" /><span>热量和营养均为估算，记录前请核对份量与做法。</span></li></ul><a class="text-button" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Gemini 使用条款<ArrowUpRight :size="14" /></a></article><article class="card settings-card"><div class="settings-card-title"><span class="settings-feature-icon"><BookOpen :size="21" /></span><div><h2>食物数据来源</h2><p>参考数据帮助估算，具体做法仍需核对。</p></div></div><div class="settings-source-stats"><div><strong>{{ catalogFoods.length.toLocaleString('zh-CN') }}</strong><span>合并后的可选食物</span></div><div><strong>{{ recipes.length }}</strong><span>可调参考配方</span></div></div><details class="settings-inline-details"><summary>查看来源、许可与使用建议</summary><p>内置 {{ foods.length }} 条参考：USDA 基础食物 {{ basicFoodCount }} 条、膳食调查 {{ surveyFoodCount }} 条，TFDA 成品参考 {{ chineseFoodCount }} 条。USDA 采用 CC0，TFDA 采用政府资料开放授权条款第 1 版，快照日期为 2026-10-19。</p><ul class="plain-list"><li>同一食物可能有不同做法、含糖量和配料版本，数量不等于不同菜品数量。</li><li>参考配方不代表具体品牌或门店，请核对皮馅、肥瘦、糖油与生熟重量。</li><li>未匹配时使用标注的 AI 粗估；无法估计时保留缺失。</li><li>包装食品保留标签基准，核对后记录实际摄入量。</li></ul><div class="settings-source-links"><a href="https://fdc.nal.usda.gov/api-guide/" target="_blank" rel="noopener noreferrer">USDA 数据与许可<ArrowUpRight :size="13" /></a><a href="https://data.gov.tw/dataset/8543" target="_blank" rel="noopener noreferrer">TFDA 数据集<ArrowUpRight :size="13" /></a><a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">开放授权条款<ArrowUpRight :size="13" /></a></div></details></article></div>
    </section>
    <AppUpdates />
    <PackagedLibrary v-if="libraryOpen" :selection="false" @close="libraryOpen = false" />
    <div v-if="error" class="notice danger" role="alert" data-testid="backup-error">{{ error }}</div>
    <footer class="settings-page-footer"><span>食刻 <b>SHIKE</b></span><p>给好好吃饭，留一点空间。</p><small>本地保存 · 主动备份 · 随时掌握</small></footer>
  </section>
</template>
