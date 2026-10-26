<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, ChevronRight, Copy, FileCode, Info, KeyRound, Monitor, RefreshCw, ShieldCheck, SlidersHorizontal } from '@lucide/vue'
import { personalProviders, personalProviderName, type PersonalProvider } from '@shike/shared'
import type { Health } from '../lib/api'
import ModelPicker from './ModelPicker.vue'
import AppSheet from './AppSheet.vue'
import ModelKeyGuide from './ModelKeyGuide.vue'

const props = defineProps<{ health: Health | null; healthError: string; checkingHealth?: boolean }>()
const emit = defineEmits<{ checkHealth: [] }>()
const helpOpen = ref(false), helpProvider = ref<PersonalProvider>('qwen'), modelRevision = ref(0)
const selectedMode = ref<'live' | 'mock' | null>(null), copyMessage = ref('')
const status = computed(() => props.checkingHealth ? '正在检查' : !props.health ? '服务未连接' : props.health.mode === 'mock' ? '模拟模式' : '真实模式已配置')
const platformMarks: Record<PersonalProvider, string> = { qwen: 'Q', deepseek: 'DS', siliconflow: 'SF', openrouter: 'OR', gemini: 'G', glm: 'GLM' }
const configExample = 'AI_PROVIDER=deepseek\nAI_MODE=auto\n\nDEEPSEEK_API_KEY=\nZHIPU_API_KEY=\nDASHSCOPE_API_KEY=\nSILICONFLOW_API_KEY=\nOPENROUTER_API_KEY=\nGEMINI_API_KEY='
function openGuide(provider: PersonalProvider = 'qwen') { helpProvider.value = provider; helpOpen.value = true }
function refresh() { modelRevision.value++; selectedMode.value = null; emit('checkHealth') }
async function copyExample() {
  try { await navigator.clipboard.writeText(configExample); copyMessage.value = '已复制示例，记得填写自己的 Key。' }
  catch { copyMessage.value = '暂时无法复制，请选中下方示例手动复制。' }
}
</script>

<template>
  <article class="card local-ai-card" data-testid="local-ai-service">
    <div class="local-ai-overview">
      <div class="local-ai-title"><span class="settings-feature-icon"><Monitor :size="23" stroke-width="1.6" /></span><div><span class="settings-kicker">网页版 · 当前电脑提供 AI 服务</span><h2>本机 AI 服务</h2></div><span class="settings-status-pill" :class="{ warning: health?.mode === 'mock', offline: !health }" data-testid="local-ai-status"><span class="status-dot" :class="{ mock: health?.mode === 'mock', offline: !health }"></span>{{ status }}</span></div>
      <p class="local-ai-description">选择常用模型，管理申请入口。Key 留在运行服务的电脑中，网页只保存你的型号选择。</p>
      <div class="local-ai-service-row"><div><span class="settings-kicker">服务默认模型</span><strong v-if="health">{{ personalProviderName(health.provider) }}<small>{{ health.model }}</small></strong><strong v-else>暂时无法读取<small>手动记餐、食物库和备份仍可使用</small></strong></div><button type="button" class="button secondary" data-testid="refresh-health" aria-label="刷新服务状态与模型列表" :disabled="checkingHealth" @click="refresh"><RefreshCw :size="15" :class="{ spin: checkingHealth }" />{{ checkingHealth ? '检查中…' : '刷新状态' }}</button></div>
      <p v-if="healthError" class="notice danger" role="status">{{ healthError }}</p>
      <p v-if="health?.mode === 'mock'" class="local-ai-mode-note"><Info :size="14" />模拟结果用于体验流程，不会分析照片。配置好 Key 并重启服务后，再刷新状态。</p>
      <p v-else class="local-ai-mode-note">这里检查本机服务与配置，不会发送照片或测试模型调用。</p>
    </div>

    <div class="local-ai-preference">
      <div class="local-ai-section-heading"><SlidersHorizontal :size="18" /><h3>识别模型</h3><span v-if="selectedMode" class="settings-small-tag">{{ selectedMode === 'mock' ? '模拟演示' : '已配置' }}</span></div>
      <ModelPicker :key="modelRevision" compact label="此浏览器使用的模型" @mode="selectedMode = $event" />
      <p>拍照和文字记餐共用这个选择，切换不会调用模型。列表只显示服务已配置的型号。</p>
    </div>

    <div class="local-ai-platforms">
      <div class="local-ai-section-heading"><KeyRound :size="18" /><h3>平台与 API Key</h3><button type="button" class="text-button" data-testid="open-web-model-key-guides" @click="openGuide()"><BookOpen :size="14" />全部教程<ChevronRight :size="14" /></button></div>
      <p class="local-ai-platform-intro">同平台多个型号可共用一把 Key。选一个平台，查看申请步骤和网页版配置方法。</p>
      <div class="settings-platform-grid"><button v-for="platform in personalProviders" :key="platform.id" type="button" class="settings-platform-button" :data-testid="`platform-guide-${platform.id}`" @click="openGuide(platform.id)"><span class="settings-platform-mark" :class="`platform-${platform.id}`">{{ platformMarks[platform.id] }}</span><span><strong>{{ platform.name }}</strong><small>{{ platform.models.length }} 个已适配型号</small></span><ChevronRight :size="15" /></button></div>
      <details class="local-config-details" data-testid="local-config-help"><summary><FileCode :size="17" /><span>.env 应该怎么填写？</span><ChevronRight :size="15" /></summary><div class="local-config-content"><p><strong>两项通用设置各写一次，每个平台的 Key 单独一行。</strong>下面是示例，留空的 Key 按需填写；已有文件请修改对应行。</p><div class="local-config-example-heading"><span>项目根目录 · .env 示例</span><button type="button" class="text-button" data-testid="copy-env-example" @click="copyExample"><Copy :size="14" />复制示例</button></div><pre data-testid="local-env-example"><code>{{ configExample }}</code></pre><p v-if="copyMessage" class="local-config-copy-message" role="status">{{ copyMessage }}</p><ul><li><code>AI_PROVIDER</code> 设置服务默认平台；仍可在上方切换其他已配置型号。</li><li><code>AI_MODE=auto</code> 有默认平台的 Key 就真实调用，没有则模拟。不会自动换模型。</li><li>保存后重启食刻的 Node 服务，再刷新本页状态。Key 不要写入 <code>VITE_</code> 变量。</li></ul></div></details>
      <p class="local-ai-security"><ShieldCheck :size="15" /><span>教程和状态检查不消耗模型额度。实际识别可能产生费用，以平台规则为准。</span></p>
      <p class="tiny muted local-ai-app-note">安卓 App 可直接在设置中填写 Key。自建云端连接暂未启用。</p>
    </div>
  </article>
  <AppSheet :open="helpOpen" title="API Key 申请教程" subtitle="申请 Key 后，在运行食刻服务的电脑上配置。" test-id="web-model-key-help-sheet" @close="helpOpen = false">
    <label class="key-guide-provider">查看哪个平台<select v-model="helpProvider" data-testid="key-guide-provider"><option v-for="platform in personalProviders" :key="platform.id" :value="platform.id">{{ platform.name }}</option></select></label>
    <ModelKeyGuide :provider="helpProvider" audience="web" />
  </AppSheet>
</template>
