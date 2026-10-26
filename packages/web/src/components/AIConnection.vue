<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen } from '@lucide/vue'
import { personalProviders, type PersonalProvider } from '@shike/shared'
import { serviceConnectionsEnabled } from '../lib/features'
import ServiceConnection from './ServiceConnection.vue'
import PersonalModels from './PersonalModels.vue'
import LocalAISettings from './LocalAISettings.vue'
import type { Health } from '../lib/api'
import AppSheet from './AppSheet.vue'
import ModelKeyGuide from './ModelKeyGuide.vue'
import { aiRoute, personalVisionSupported, setAiRoute } from '../lib/personal-vision'
withDefaults(defineProps<{ health?: Health | null; healthError?: string; checkingHealth?: boolean }>(), { health: null, healthError: '', checkingHealth: false })
const emit = defineEmits<{ changed: []; checkHealth: []; busy: [value: boolean] }>()
const busy = ref(false)
function reportBusy(value: boolean) { busy.value = value; emit('busy', value) }
const supported = personalVisionSupported(), route = ref(aiRoute()), error = ref('')
const helpOpen = ref(false), helpProvider = ref<PersonalProvider>('qwen')
function change(value: 'direct' | 'service') {
  try { setAiRoute(value); route.value = value; error.value = ''; emit('changed') }
  catch { error.value = '无法保存连接方式，请检查本机存储。' }
}
</script>
<template>
  <div class="ai-connection">
    <article v-if="supported && serviceConnectionsEnabled()" class="card settings-card">
      <h2>AI 连接方式</h2><p>自配 Key 可直接使用模型；也可连接已有的食刻服务。</p>
      <div class="ai-route-options" role="group" aria-label="AI 连接方式">
        <button class="button" :class="route === 'direct' ? 'primary' : 'secondary'" data-testid="ai-route-direct" :disabled="busy" :aria-pressed="route === 'direct'" @click="change('direct')">手机自配 Key</button>
        <button class="button" :class="route === 'service' ? 'primary' : 'secondary'" data-testid="ai-route-service" :disabled="busy" :aria-pressed="route === 'service'" @click="change('service')">连接食刻服务</button>
      </div><p v-if="error" class="notice danger">{{ error }}</p>
    </article>
    <PersonalModels v-if="supported && (route === 'direct' || !serviceConnectionsEnabled())" @changed="emit('changed')" @busy="reportBusy" />
    <ServiceConnection v-else-if="serviceConnectionsEnabled()" @changed="emit('changed')" @busy="reportBusy" />
    <LocalAISettings v-else :health="health" :health-error="healthError" :checking-health="checkingHealth" @check-health="emit('checkHealth')" />
    <article v-if="!supported && serviceConnectionsEnabled()" class="card settings-card"><h2>API Key 申请教程</h2><p>查看各平台的官方申请入口和食刻服务端配置方法。</p><button type="button" class="button secondary model-key-help-button" data-testid="open-web-model-key-guides" @click="helpOpen = true"><BookOpen :size="16" />API Key 申请与网页版配置教程</button></article>
    <AppSheet v-if="!supported && serviceConnectionsEnabled()" :open="helpOpen" title="API Key 申请教程" subtitle="申请 Key 后，在运行食刻服务的电脑上配置。" test-id="web-model-key-help-sheet" @close="helpOpen = false">
      <label class="key-guide-provider">查看哪个平台<select v-model="helpProvider" data-testid="key-guide-provider"><option v-for="item in personalProviders" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <ModelKeyGuide :provider="helpProvider" audience="web" />
    </AppSheet>
  </div>
</template>
