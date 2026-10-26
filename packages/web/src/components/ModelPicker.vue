<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { personalModelInfo, personalModelUsageNotice, personalProfileModels, personalModelSelection, personalProviderName } from '@shike/shared'
import { personalVisionSupported, getPersonalState, activatePersonalProfile } from '../lib/personal-vision'
import { selectedLocalModel, selectLocalModel } from '../lib/model-selection'
const props = defineProps<{ busy?: boolean; compact?: boolean; collapsible?: boolean; label?: string }>()
const emit = defineEmits<{ switching: [value: boolean]; mode: [value: 'live' | 'mock'] }>()
const items = ref<Array<{ id: string; profileId?: string; provider?: string; model?: string; label: string; mode: 'live' | 'mock' }>>([]), id = ref(''), pending = ref(false), error = ref('')
const usageNotice = computed(() => { const item = items.value.find(item => item.id === id.value); return item?.provider && item.model ? personalModelUsageNotice(item.provider, item.model) : '' })
const native = personalVisionSupported()
function publishMode() { const item = items.value.find(item => item.id === id.value); if (item) emit('mode', item.mode) }
onMounted(async () => {
  try {
    if (native) {
      const state = await getPersonalState()
      items.value = state.profiles.flatMap(profile => personalProfileModels(profile).map(model => ({ id: personalModelSelection(profile, model), profileId: profile.id, provider: profile.provider, model, label: `${profile.label} · ${model}（${personalModelInfo(profile.provider, model).badge}）`, mode: 'live' as const })))
      const active = state.profiles.find(profile => profile.id === state.activeId); id.value = active ? personalModelSelection(active) : ''
    }
    else if (import.meta.env.VITE_APP_STANDALONE !== 'true') {
      const response = await fetch('/api/models', { signal: AbortSignal.timeout(4000), credentials: 'omit' }); if (!response.ok) return
      const data = await response.json(); if (!Array.isArray(data.models) || data.models.length > 20) return
      items.value = data.models.filter((p: any) => p && typeof p.id === 'string' && typeof p.provider === 'string' && typeof p.model === 'string' && p.id.length < 100 && p.provider.length < 80 && p.model.length < 200 && (p.mode === 'mock' || p.mode === 'live')).map((p: any) => ({ id: p.id, provider: p.provider, model: p.model, mode: p.mode, label: `${personalProviderName(p.provider)} · ${p.model}${p.mode === 'mock' ? '（模拟）' : ''}` }))
      const saved = selectedLocalModel(); id.value = items.value.some(item => item.id === saved) ? saved : 'default'; selectLocalModel(id.value)
    }
    publishMode()
  } catch { error.value = '暂时无法读取模型列表，当前配置仍可使用。' }
})
async function change(event: Event) {
  const next = (event.target as HTMLSelectElement).value, previous = id.value
  pending.value = true; emit('switching', true); error.value = ''
  try {
    if (native) { const item = items.value.find(item => item.id === next); if (!item?.profileId || !item.model) throw new Error('未找到模型'); await activatePersonalProfile(item.profileId, item.model) }
    else selectLocalModel(next)
    id.value = next; publishMode()
  }
  catch { id.value = previous; (event.target as HTMLSelectElement).value = previous; error.value = '模型切换失败，原配置保留。' }
  finally { pending.value = false; emit('switching', false) }
}
</script>
<template><div :class="['recognition-model-picker', { compact }]" data-testid="recognition-model-picker"><label>{{ label ?? '本次识别模型' }}<select :value="id" :disabled="busy || pending || !items.length" data-testid="recognition-model" @change="change"><option v-if="!id" value="" disabled>{{ native ? '请在设置添加并选用模型' : '使用本机服务配置' }}</option><option v-for="item in items" :key="item.id" :value="item.id">{{ item.label }}</option></select></label><p v-if="!compact && !collapsible" class="tiny muted">手动选择后使用该模型；识别失败不会自动换模型或Key。{{ native ? '添加和管理配置请前往设置。' : '只列出本机已配置的模型，密钥不进入网页。' }}</p><details v-if="!compact && collapsible" class="model-picker-help"><summary>模型设置与切换说明</summary><p class="tiny muted">使用你手动选定的模型，失败后保留草稿。{{ native ? "添加和管理配置请前往设置。" : "模型配置来自本机服务，密钥不进入网页。" }}不会自动切换模型或Key。</p></details><p v-if="usageNotice" class="notice warning model-usage-notice" data-testid="model-usage-notice">{{ usageNotice }}</p><p v-if="error" class="tiny amber-text" role="status">{{ error }}</p></div></template>
