<script setup lang="ts">
import { ref } from 'vue'
import { Download, Upload, ShieldCheck, Database, ArrowUpRight, Info, Check, LoaderCircle, HardDrive, Sparkles, BookOpen, Trash2 } from '@lucide/vue'
import { foods, recipes, selectedEstimateOption, type Backup, type EstimatedFood } from '@shike/shared'
import { db, exportBackup, parseBackup, restoreBackup } from '../lib/db'
import type { Health } from '../lib/api'
import { numberLabel, rangeLabel } from '../lib/dates'
import { saveBackupFile } from '../lib/backup-file'
const props = defineProps<{ health: Health | null; healthError: string; estimatedFoods: EstimatedFood[] }>()
const emit = defineEmits<{ changed: []; notify: [message: string]; checkHealth: [] }>()
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<Backup | null>(null)
const filename = ref('')
const error = ref('')
const busy = ref(false)
const basicFoodCount = foods.filter(food => food.source.dataset === 'USDA SR Legacy').length
const surveyFoodCount = foods.length - basicFoodCount
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
  <section><div class="page-heading"><div><span class="eyebrow">留一个安心记录的空间</span><h1>安心记录，<span>自在掌握。</span></h1><p>你的记录，保存在你自己的浏览器。</p></div><span class="heading-symbol"><ShieldCheck :size="29" stroke-width="1.5" /></span></div>
    <div class="settings-grid"><article class="card settings-card"><span class="settings-icon"><Database :size="24" stroke-width="1.5" /></span><h2>备份与恢复</h2><p>定期备份，让每一份记录都有着落。</p><div class="backup-buttons"><button class="button primary" data-testid="export-backup" :disabled="busy" @click="download"><Download :size="17" /> 导出备份</button><button class="button secondary" data-testid="import-backup" :disabled="busy" @click="fileInput?.click()"><Upload :size="17" /> 恢复备份</button></div><input ref="fileInput" data-testid="backup-input" class="sr-only" type="file" accept="application/json,.json" @change="chooseBackup" /><div class="notice subtle"><Info :size="16" /><span>JSON 备份包含饮食、体重、目标设置和个人估算库，不包含照片或密钥。清理浏览器数据、无痕模式或换设备后，本地记录可能无法保留。</span></div>
      <div v-if="pending" class="backup-preview" data-testid="backup-preview"><h3>备份检查通过</h3><p class="small-text">{{ filename }}</p><div class="preview-counts"><span><strong>{{ pending.meals.length }}</strong> 条饮食</span><span><strong>{{ pending.weights.length }}</strong> 条体重</span><span><strong>{{ pending.estimatedFoods.length }}</strong> 项个人估算</span></div><p class="amber-text small-text">恢复会完整替换当前设备的所有记录、目标设置与个人估算库。建议先导出当前备份。</p><div class="backup-buttons"><button class="button primary" data-testid="confirm-restore" :disabled="busy" @click="restore"><LoaderCircle v-if="busy" class="spin" :size="17" /><Check v-else :size="17" /> 确认替换并恢复</button><button class="text-button" :disabled="busy" @click="pending = null">取消</button></div></div>
    </article><article class="card settings-card"><span class="settings-icon"><Sparkles :size="24" stroke-width="1.5" /></span><h2>AI 识别服务</h2><p>识别与初步估算同次完成，优先采用已有可靠数据。</p><div class="service-status"><span class="status-dot" :class="{ offline: !health, mock: health?.mode === 'mock' }"></span><strong>{{ health ? health.mode === 'mock' ? '模拟模式' : '真实模式已配置' : '服务未连接' }}</strong><button class="text-button" data-testid="refresh-health" @click="emit('checkHealth')">重新检查</button></div><dl v-if="health" class="service-details"><div><dt>提供商</dt><dd>{{ health.provider === 'gemini' ? 'Google Gemini' : health.provider === 'glm' ? '智谱 GLM' : '本地 Mock' }}</dd></div><div><dt>当前模型</dt><dd>{{ health.model }}</dd></div></dl><p v-if="health?.mode === 'mock'" class="notice warning">无密钥也能测试完整流程。模拟内容不分析你的照片，记录会一直显示模拟标识。</p><p v-if="healthError" class="notice danger">{{ healthError }} · 手动记录仍可使用。</p><p class="tiny muted">切换模型请修改服务端 .env 中的 AI_PROVIDER 与密钥，重启后生效。界面不接收或保存 API Key。此状态只说明后端已配置，模型实际可用性以识别请求为准。</p></article>
    <article class="card settings-card"><span class="settings-icon"><HardDrive :size="24" stroke-width="1.5" /></span><h2>关于本地数据</h2><p>饮食与体重仅保存于这个浏览器的 IndexedDB。食刻不会自动同步到其他设备。</p><ul class="plain-list"><li>上传的照片只在识别请求中临时处理。</li><li>发送到外部模型的照片，受模型服务商政策约束。</li><li>Gemini 免费服务可能使用请求内容改进产品。</li><li>所有热量与营养数值都标注为估算。</li></ul><a class="text-button" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">查看 Gemini 使用条款 <ArrowUpRight :size="14" /></a></article>
    <article class="card settings-card"><span class="settings-icon"><BookOpen :size="24" stroke-width="1.5" /></span><h2>数据来源与使用建议</h2><p>内置 {{ foods.length }} 条 USDA 食物参考：{{ basicFoodCount }} 条基础食物、{{ surveyFoodCount }} 条膳食调查记录；另有 {{ recipes.length }} 个可调参考配方。USDA 数据按 CC0 许可使用。</p><ul class="plain-list"><li>同一食物可能有不同做法、含糖量和配料版本，数量不等于不同菜品数量。</li><li>膳食参考可能采用美国常见配方，请核对实际做法；部分专名保留原文。</li><li>混合菜的可调参考配方是待确认的配比假设。</li><li>未匹配时使用标注的 AI 粗估；无法估计时保留缺失。</li><li>有包装营养表时，优先填写每 100 g 的标示值。</li></ul><a class="text-button" href="https://fdc.nal.usda.gov/api-guide/" target="_blank" rel="noopener noreferrer">查看 USDA 数据与许可 <ArrowUpRight :size="14" /></a></article></div>
    <article class="card settings-card personal-library"><div class="section-heading"><div><h2>个人估算库</h2><p class="small-text muted">仅收录你确认保存的真实 AI 估算，未经测量，不属于 USDA 数据。</p></div><span class="soft-tag" data-testid="estimated-food-count">{{ estimatedFoods.length }} 项</span></div><div v-if="!estimatedFoods.length" class="personal-empty">库外食物的 AI 粗估会在确认保存后加入这里，下次同名可复用。模拟结果与未保存草稿不会进入。</div><div v-for="(food, index) in estimatedFoods" :key="food.id" class="personal-food-row" :data-testid="`estimated-food-${index}`"><div><strong>{{ food.name }}</strong><p>{{ food.provider === 'mock' ? '导入的模拟估算 · 不参与真实匹配' : 'AI 粗估 · 未经测量' }} · {{ food.model }}</p><details><summary>查看假设</summary><p>{{ food.assumptions.join(' ') || '请核对用油、糖和含水量。' }}</p></details></div><span>{{ food.nutrientsPer100g.energyKcal === null ? '热量待补充' : `约 ${numberLabel(food.nutrientsPer100g.energyKcal)} kcal / 100 g` }}</span><button class="icon-button small" data-testid="delete-estimated-food" :aria-label="`删除个人估算${food.name}`" @click="removeEstimate(food)"><Trash2 :size="15" /></button></div><p class="tiny muted library-note">新餐默认中档，历史保留原选档。更新或删除个人估算不会改写已保存的历史记录。版本 2 备份包含此库，仍可恢复旧版本 1 备份。</p></article>
    <div v-if="error" class="notice danger" role="alert" data-testid="backup-error">{{ error }}</div><p class="settings-footer">食刻 SHIKE <span>v0.1.0 · 给好好吃饭，留一点空间</span></p>
  </section>
</template>
