<script setup lang="ts">
import { ref } from 'vue'
import { Cloud, LoaderCircle } from '@lucide/vue'
import { connectService } from '../lib/api'
import { normalizeApiBase, readConnection, writeConnection } from '../lib/connection'
const emit = defineEmits<{ changed: [] }>()
const initial = readConnection()
const address = ref(initial.baseUrl)
const accessCode = ref('')
const connected = ref(initial.baseUrl)
const hasToken = ref(Boolean(initial.token))
const busy = ref(false)
const error = ref('')
const message = ref('')
async function connect() {
  error.value = ''; message.value = ''; busy.value = true
  try {
    const base = normalizeApiBase(address.value)
    if (!base) throw new Error('请输入 HTTPS 服务地址。')
    const health = await connectService(base, accessCode.value)
    connected.value = base; address.value = base; hasToken.value = Boolean(readConnection().token); accessCode.value = ''
    message.value = health.mode === 'mock' ? '已连接模拟服务，识别结果会带模拟标识。' : '服务已连接，可以拍照识别。'
    emit('changed')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '连接失败，请重试。' }
  finally { busy.value = false }
}
function disconnect() {
  try { writeConnection({ baseUrl: '' }); connected.value = ''; address.value = ''; accessCode.value = ''; hasToken.value = false; message.value = '已清除连接，饮食与体重记录保留。'; error.value = ''; emit('changed') }
  catch { error.value = '无法保存连接配置，请检查本地存储。' }
}
</script>

<template>
  <article class="card settings-card service-connection" data-testid="service-connection">
    <span class="settings-icon"><Cloud :size="24" stroke-width="1.5" /></span>
    <h2>连接云端 AI</h2><p>手动记录与食物库可离线使用，拍照识别需要连接你的食刻服务。</p>
    <form @submit.prevent="connect">
      <label>服务地址<input v-model="address" data-testid="service-address" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com" :disabled="busy" /></label>
      <label>内测访问码<input v-model="accessCode" data-testid="service-access-code" type="password" autocomplete="off" placeholder="由服务管理员提供，可留空连接无需保护的服务" :disabled="busy" maxlength="128" /></label>
      <p class="tiny muted">这里填写食刻的访问码，不是百炼或 Gemini API Key。访问码不会保存；验证后的短期凭证仅保存在本机，不进入饮食备份。</p>
      <div class="backup-buttons"><button class="button primary" data-testid="connect-service" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="16" />{{ busy ? '正在连接…' : '保存并连接' }}</button><button type="button" class="text-button" data-testid="disconnect-service" :disabled="busy" @click="disconnect">清除连接</button></div>
    </form>
    <p v-if="connected" class="small-text connection-address" data-testid="connected-address">照片识别发送至：{{ connected }}<span v-if="hasToken"> · 已保存访问凭证</span></p>
    <p v-if="message" class="notice subtle" role="status" data-testid="connection-message">{{ message }}</p>
    <p v-if="error" class="notice danger" role="alert" data-testid="connection-error">{{ error }}</p>
  </article>
</template>
