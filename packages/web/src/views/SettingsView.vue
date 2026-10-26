<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Download, Upload, ShieldCheck, Database, ArrowUpRight, Info, Check, LoaderCircle, HardDrive, Sparkles, BookOpen, Bookmark, Package, ChevronRight, SlidersHorizontal, Smartphone } from '@lucide/vue'
import { foods, catalogFoods, recipes, personalProviders, personalProviderName, type Backup, type EstimatedFood } from '@shike/shared'
import { db, exportBackup, parseBackup, restoreBackup, MAX_BACKUP_BYTES } from '../lib/db'
import type { Health } from '../lib/api'
import { personalVisionSupported } from '../lib/personal-vision'
import { readConnection } from '../lib/connection'
import { selectedLocalModel } from '../lib/model-selection'
import { appUpdateInfo, buildUpdateInfo } from '../lib/app-updates'
import { saveBackupFile } from '../lib/backup-file'
import AIConnection from '../components/AIConnection.vue'
import PackagedLibrary from '../components/PackagedLibrary.vue'
import AppUpdates from '../components/AppUpdates.vue'
import EstimatedFoodLibrary from '../components/EstimatedFoodLibrary.vue'
import AppSheet from '../components/AppSheet.vue'
const libraryOpen = ref(false)
const props = defineProps<{ health: Health | null; healthError: string; estimatedFoods: EstimatedFood[]; checkingHealth?: boolean }>()
const emit = defineEmits<{ changed: []; notify: [message: string]; checkHealth: []; openFoodLibrary: [] }>()
const native = personalVisionSupported()
type SettingsPanel = 'ai' | 'backup' | 'privacy' | 'sources' | 'updates'
const panel = ref<SettingsPanel | null>(null), aiBusy = ref(false), modelRevision = ref(0)
const panelTitles = { ai: 'AI 与模型', backup: '备份与恢复', privacy: '使用与隐私', sources: '食物数据来源', updates: '版本与更新' }
const version = ref(buildUpdateInfo().versionName)
onMounted(async () => { try { version.value = (await appUpdateInfo()).versionName } catch { /* 安装信息暂不可读时使用构建版本。 */ } })
const currentModel = computed(() => {
  void modelRevision.value
  if (!props.health || native || readConnection().baseUrl) return props.health
  const selected = selectedLocalModel()
  for (const provider of personalProviders) for (const model of provider.models) if (selected === `${provider.id}:${model}`) return { ...props.health, provider: provider.id, model }
  return props.health
})
const modelStatus = computed(() => props.checkingHealth ? '检查中' : !currentModel.value ? '待配置' : currentModel.value.mode === 'mock' ? '模拟模式' : '已配置')
function closePanel() { if (busy.value || aiBusy.value) return; panel.value = null; modelRevision.value++ }
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<Backup | null>(null)
const filename = ref('')
const error = ref('')
const busy = ref(false)
const backupAction = ref<'export' | 'import' | 'restore' | null>(null)
const deletingEstimate = ref<string | null>(null)
const basicFoodCount = foods.filter(food => food.source.dataset === 'USDA SR Legacy').length
const surveyFoodCount = foods.filter(food => food.source.dataset === 'USDA FNDDS').length
const chineseFoodCount = foods.filter(food => food.source.dataset === 'TFDA 食品营养成分').length
async function download() {
  if (busy.value) return
  busy.value = true; backupAction.value = 'export'; error.value = ''
  try {
    const backup = await exportBackup()
    await saveBackupFile(backup)
    emit('notify', '备份已导出，请妥善保存')
  } catch (cause) { error.value = cause instanceof Error && cause.message.includes('100 MB') ? cause.message : '导出失败，请检查浏览器存储状态。' }
  finally { busy.value = false; backupAction.value = null }
}
async function chooseBackup(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''; pending.value = null; error.value = ''
  if (!file || busy.value) return
  busy.value = true; backupAction.value = 'import'
  try { if (file.size > MAX_BACKUP_BYTES) throw new Error('备份不能超过 100 MB。'); pending.value = parseBackup(await file.text()); filename.value = file.name }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取备份。' }
  finally { busy.value = false; backupAction.value = null }
}
async function restore() {
  if (!pending.value || busy.value) return
  busy.value = true; backupAction.value = 'restore'; error.value = ''
  try { await restoreBackup(pending.value); pending.value = null; emit('changed'); emit('notify', '备份已完整恢复') }
  catch { error.value = '恢复失败，原有记录已保留。请检查存储空间后重试。' }
  finally { busy.value = false; backupAction.value = null }
}
async function removeEstimate(food: EstimatedFood) {
  if (deletingEstimate.value) return
  if (!window.confirm(`删除个人估算「${food.name}」？已保存的历史饮食快照不受影响。`)) return
  deletingEstimate.value = food.id
  try { await db.estimatedFoods.delete(food.id); emit('changed'); emit('notify', '个人估算已删除，历史记录仍保留') }
  catch { error.value = '删除失败，请检查浏览器存储状态。'; emit('notify', error.value) }
  finally { deletingEstimate.value = null }
}
</script>

<template>
  <section class="settings-page settings-hub" data-testid="settings-page">
    <header class="settings-hub-heading"><div><h1>设置</h1><p>模型、食物与本地数据</p></div><span class="settings-hub-symbol"><SlidersHorizontal :size="24" stroke-width="1.6"/></span></header>
    <button type="button" class="settings-ai-entry" data-testid="settings-open-ai" @click="panel = 'ai'">
      <span class="settings-ai-symbol"><Sparkles :size="24" stroke-width="1.7"/></span>
      <span class="settings-ai-content"><span class="settings-ai-heading"><strong>AI 与模型</strong><span class="settings-ai-badge" :class="{ warning: !currentModel || currentModel.mode === 'mock' || healthError }" data-testid="settings-model-status">{{ modelStatus }}</span></span><span class="settings-ai-model" data-testid="settings-current-model">{{ currentModel ? currentModel.model : '添加模型，开始拍照和聊天' }}</span><small>{{ healthError ? '连接暂不可用，点此查看与处理' : native ? '管理 Key 与可用型号' : '切换模型 · API Key 申请教程' }}</small></span><ChevronRight :size="19"/>
    </button>
    <div class="settings-hub-grid">
      <section class="settings-hub-group" aria-labelledby="settings-food-title"><h2 id="settings-food-title">食物与数据</h2><div class="settings-list-card">
        <button type="button" class="settings-list-row" data-testid="settings-food-library" @click="emit('openFoodLibrary')"><span class="settings-row-icon"><Bookmark :size="19"/></span><span><strong>常用食物库</strong><small>收藏与保存的食物，快速加入一餐</small></span><ChevronRight :size="17"/></button>
        <button type="button" class="settings-list-row" data-testid="manage-packaged-foods" @click="libraryOpen = true"><span class="settings-row-icon"><Package :size="19"/></span><span><strong>包装食品库</strong><small>管理条码与营养标签</small></span><ChevronRight :size="17"/></button>
        <EstimatedFoodLibrary :foods="estimatedFoods" :deleting-id="deletingEstimate" compact @remove="removeEstimate"/>
        <button type="button" class="settings-list-row" data-testid="settings-open-backup" @click="panel = 'backup'"><span class="settings-row-icon"><Database :size="19"/></span><span><strong>备份与恢复</strong><small>导出本地记录，或从文件恢复</small></span><ChevronRight :size="17"/></button>
      </div></section>
      <section class="settings-hub-group" aria-labelledby="settings-more-title"><h2 id="settings-more-title">应用与说明</h2><div class="settings-list-card">
        <button type="button" class="settings-list-row" data-testid="settings-open-updates" @click="panel = 'updates'"><span class="settings-row-icon"><Smartphone :size="19"/></span><span><strong>版本与更新</strong><small>Gitee 国内源优先</small></span><span class="settings-row-version" data-testid="settings-version">{{ version }}</span><ChevronRight :size="17"/></button>
        <button type="button" class="settings-list-row" data-testid="settings-open-privacy" @click="panel = 'privacy'"><span class="settings-row-icon"><ShieldCheck :size="19"/></span><span><strong>使用与隐私</strong><small>了解记录与照片的保存方式</small></span><ChevronRight :size="17"/></button>
        <button type="button" class="settings-list-row" data-testid="settings-open-sources" @click="panel = 'sources'"><span class="settings-row-icon"><BookOpen :size="19"/></span><span><strong>食物数据来源</strong><small>参考数据、许可与估算说明</small></span><ChevronRight :size="17"/></button>
      </div><p class="settings-local-note"><HardDrive :size="13"/>记录保存在当前设备，建议定期备份</p></section>
    </div>
    <p v-if="error && !panel" class="notice danger" role="alert">{{ error }}</p>
    <footer class="settings-hub-footer">食刻 <span>·</span> 好好吃饭，慢慢记录</footer>
    <PackagedLibrary v-if="libraryOpen" :selection="false" @close="libraryOpen = false"/>
    <AppSheet :open="panel !== null" :title="panel ? panelTitles[panel] : '设置'" :busy="busy || aiBusy" test-id="settings-detail" class-name="settings-detail-sheet" @close="closePanel">
      <div class="settings-page settings-detail-content">
        <template v-if="panel === 'ai'">
          <div v-if="native" class="settings-native-summary"><span>{{ currentModel ? personalProviderName(currentModel.provider) : '尚未选用模型' }}</span><button type="button" class="text-button" data-testid="refresh-health" :disabled="checkingHealth || aiBusy" @click="emit('checkHealth')"><LoaderCircle v-if="checkingHealth" :size="14" class="spin"/>{{ checkingHealth ? '检查中…' : '刷新状态' }}</button></div>
          <p v-if="native && healthError" class="notice danger">{{ healthError }}</p>
          <AIConnection :health="health" :health-error="healthError" :checking-health="checkingHealth" @busy="aiBusy = $event" @changed="emit('checkHealth'); modelRevision++" @check-health="emit('checkHealth')"/>
        </template>
        <template v-else-if="panel === 'backup'"><article class="card settings-card settings-backup-card" data-testid="settings-backup-card">
          <div class="settings-card-title"><span class="settings-feature-icon"><Database :size="22" stroke-width="1.6" /></span><div><h2>备份与恢复</h2><p>记录保存在此设备，建议定期导出。</p></div></div>
          <div class="backup-buttons"><button class="button primary" data-testid="export-backup" :disabled="busy" @click="download"><LoaderCircle v-if="backupAction === 'export'" class="spin" :size="17"/><Download v-else :size="17" />{{ backupAction === 'export' ? '正在导出…' : '导出备份' }}</button><button class="button secondary" data-testid="import-backup" :disabled="busy" @click="fileInput?.click()"><LoaderCircle v-if="backupAction === 'import'" class="spin" :size="17"/><Upload v-else :size="17" />{{ backupAction === 'import' ? '正在读取…' : '恢复备份' }}</button></div>
          <input ref="fileInput" data-testid="backup-input" class="sr-only" type="file" accept="application/json,.json" @change="chooseBackup" />
          <p class="settings-backup-note"><ShieldCheck :size="15" /><span>包含饮食、体重、目标、活动和个人食物，餐次照片随备份保存，API Key 不进入备份。</span></p>
          <details class="settings-inline-details"><summary>备份包含什么？</summary><p>JSON 备份包含餐次照片、饮食、体重、个人资料、目标、个人食品与收藏、包装食品、个人估算、饮水、运动、份量与每日预算快照。清理浏览器数据、无痕模式或换设备后，本地记录可能无法保留。</p></details>
          <div v-if="pending" class="backup-preview" data-testid="backup-preview"><h3>备份检查通过</h3><p class="small-text">{{ filename }}</p><div class="preview-counts"><span><strong>{{ pending.libraryFoods.length }}</strong> 项个人食品／收藏</span><span><strong>{{ pending.packagedFoods.length }}</strong> 项包装食品</span><span><strong>{{ pending.meals.length }}</strong> 条饮食</span><span><strong>{{ pending.mealPhotos.length }}</strong> 张餐次照片</span><span><strong>{{ pending.weights.length }}</strong> 条体重</span><span><strong>{{ pending.estimatedFoods.length }}</strong> 项个人估算</span><span><strong>{{ pending.water.length }}</strong> 条饮水</span><span><strong>{{ pending.exercises.length }}</strong> 条运动</span></div><p class="amber-text small-text">恢复会完整替换当前设备的所有记录、个人资料、目标、个人食品与收藏。照片也会被整体替换；旧备份不含照片时会清空现有照片。建议先导出当前备份。</p><div class="backup-buttons"><button class="button primary" data-testid="confirm-restore" :disabled="busy" @click="restore"><LoaderCircle v-if="busy" class="spin" :size="17" /><Check v-else :size="17" />{{ backupAction === 'restore' ? '正在恢复…' : '确认替换并恢复' }}</button><button class="text-button" :disabled="busy" @click="pending = null">取消</button></div></div>
        </article></template>
        <template v-else-if="panel === 'privacy'"><article class="card settings-card"><div class="settings-card-title"><span class="settings-feature-icon"><HardDrive :size="21" /></span><div><h2>本地保存，由你掌握</h2><p>记录不会自动同步到其他设备。</p></div></div><ul class="settings-privacy-list"><li><ShieldCheck :size="16" /><span>饮食、体重、个人食物与已保存餐次的压缩照片保存在当前设备。照片已去除 EXIF/GPS 元数据，不会自动同步或保存到系统相册。</span></li><li><Sparkles :size="16" /><span>使用 AI 时，照片发送给所选提供商，受其数据政策约束。</span></li><li><Info :size="16" /><span>热量和营养均为估算，记录前请核对份量与做法。</span></li></ul><a class="text-button" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Gemini 使用条款<ArrowUpRight :size="14" /></a></article></template>
        <template v-else-if="panel === 'sources'"><article class="card settings-card"><div class="settings-card-title"><span class="settings-feature-icon"><BookOpen :size="21" /></span><div><h2>食物数据来源</h2><p>参考数据帮助估算，具体做法仍需核对。</p></div></div><div class="settings-source-stats"><div><strong>{{ catalogFoods.length.toLocaleString('zh-CN') }}</strong><span>合并后的可选食物</span></div><div><strong>{{ recipes.length }}</strong><span>可调参考配方</span></div></div><details class="settings-inline-details"><summary>查看来源、许可与使用建议</summary><p>内置 {{ foods.length }} 条参考：USDA 基础食物 {{ basicFoodCount }} 条、膳食调查 {{ surveyFoodCount }} 条，TFDA 成品参考 {{ chineseFoodCount }} 条。USDA 采用 CC0，TFDA 采用政府资料开放授权条款第 1 版，快照日期为 2026-10-19。</p><ul class="plain-list"><li>同一食物可能有不同做法、含糖量和配料版本，数量不等于不同菜品数量。</li><li>参考配方不代表具体品牌或门店，请核对皮馅、肥瘦、糖油与生熟重量。</li><li>未匹配时使用标注的 AI 粗估；无法估计时保留缺失。</li><li>包装食品保留标签基准，核对后记录实际摄入量。</li></ul><div class="settings-source-links"><a href="https://fdc.nal.usda.gov/api-guide/" target="_blank" rel="noopener noreferrer">USDA 数据与许可<ArrowUpRight :size="13" /></a><a href="https://data.gov.tw/dataset/8543" target="_blank" rel="noopener noreferrer">TFDA 数据集<ArrowUpRight :size="13" /></a><a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">开放授权条款<ArrowUpRight :size="13" /></a></div></details></article></template>
        <AppUpdates v-else-if="panel === 'updates'"/>
        <p v-if="error" class="notice danger" role="alert" data-testid="backup-error">{{ error }}</p>
      </div>
    </AppSheet>
  </section>
</template>
