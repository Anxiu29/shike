<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'
import { KeyRound, Plus, LoaderCircle, Check, Pencil, Trash2, BookOpen } from '@lucide/vue'
import { personalProviders, personalModelInfo, personalModelUsageNotice, personalProfileModels, type PersonalProfile, type PersonalProvider, type PersonalState } from '@shike/shared'
import { activatePersonalProfile, clearPersonalProfiles, deletePersonalProfile, getPersonalState, savePersonalProfile, testPersonalProfile } from '../lib/personal-vision'
import AppSheet from './AppSheet.vue'
import ModelKeyGuide from './ModelKeyGuide.vue'
import ModelPicker from './ModelPicker.vue'

const emit = defineEmits<{ changed: []; busy: [value: boolean] }>()
const state = ref<PersonalState>({ profiles: [], activeId: null })
const working = ref(false), switching = ref(false), ready = ref(false), formOpen = ref(false)
const busy = computed(() => working.value || switching.value)
watch(busy, value => emit('busy', value), { flush: 'sync' })
const error = ref(''), message = ref('')
const editingId = ref<string | undefined>(), label = ref(''), provider = ref<PersonalProvider>('qwen'), model = ref('qwen3.7-flash'), apiKey = ref('')
const helpOpen = ref(false), helpProvider = ref<PersonalProvider>('qwen'), enabledModels = ref<string[]>(['qwen3.7-flash'])
const formId = useId()
const editingProfile = computed(() => state.value.profiles.find(profile => profile.id === editingId.value))
const models = computed(() => personalProviders.find(value => value.id === provider.value)!.models)
const selectedInfo = computed(() => personalModelInfo(provider.value, model.value))
function providerName(id: string) { return personalProviders.find(value => value.id === id)?.name ?? id }
async function operation(action: () => Promise<PersonalState>, success: string) {
  if (busy.value) return
  working.value = true; error.value = ''; message.value = ''
  try { state.value = await action(); ready.value = true; message.value = success; emit('changed'); return true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '模型配置操作失败，请重试。'; return false }
  finally { working.value = false }
}
const pickerKey = computed(() => JSON.stringify([state.value.activeId, state.value.profiles.map(profile => [profile.id, profile.model, profile.models])]))
async function reloadSelection() {
  const previous = pickerKey.value
  if (await operation(getPersonalState, '') && pickerKey.value !== previous) message.value = '已切换模型，下一次拍照与聊天使用新模型。'
}
function modelSwitching(value: boolean) { switching.value = value; if (!value) void reloadSelection() }
onMounted(() => { void operation(getPersonalState, '') })
function openForm(profile?: PersonalProfile) {
  if (busy.value || formOpen.value) return
  editingId.value = profile?.id; label.value = profile?.label ?? ''; provider.value = profile?.provider ?? 'qwen'; model.value = profile?.model ?? 'qwen3.7-flash'; apiKey.value = ''; formOpen.value = true; error.value = ''; message.value = ''
  enabledModels.value = profile ? [...personalProfileModels(profile)] : [model.value]
}
function closeForm() { if (busy.value) return; formOpen.value = false; apiKey.value = ''; editingId.value = undefined; error.value = '' }
function providerChanged() { model.value = personalProviders.find(value => value.id === provider.value)!.models[0]; apiKey.value = ''; enabledModels.value = [model.value] }
function modelChanged() { if (!enabledModels.value.includes(model.value)) enabledModels.value = enabledModels.value.length === 1 ? [model.value] : [...enabledModels.value, model.value] }
function modelsChanged() { if (!enabledModels.value.includes(model.value)) model.value = enabledModels.value[0] ?? models.value[0] }
function openHelp(value = provider.value) { helpProvider.value = value; helpOpen.value = true }
async function save() {
  const input = { ...(editingId.value ? { id: editingId.value } : {}), label: label.value, provider: provider.value, model: model.value, models: [...enabledModels.value], apiKey: apiKey.value }
  apiKey.value = '' // 清掉输入框；失败时也不把 Key 留在页面。
  const ok = await operation(() => savePersonalProfile(input), '默认／当前模型测试成功，本组 Key 与模型已加密保存。识别使用标记为“使用中”的 Key 组。')
  input.apiKey = ''
  if (ok) closeForm()
}
async function remove(profile: PersonalProfile) {
  if (!window.confirm(`删除「${profile.label}」这把 Key 及本组 ${personalProfileModels(profile).length} 个模型选项？饮食和体重记录保留。`)) return
  await operation(() => deletePersonalProfile(profile.id), '配置已删除。若删除的是使用中的配置，请手动选用另一组。')
}
async function clear() {
  if (!window.confirm('清空手机上全部模型配置和 Key？饮食、体重与备份不受影响。')) return
  closeForm(); await operation(clearPersonalProfiles, '全部模型配置已清空，记录仍保留。')
}
</script>

<template>
  <article class="card settings-card personal-models" data-testid="personal-models">
    <span class="settings-icon"><KeyRound :size="24" stroke-width="1.5" /></span>
    <h2>我的 AI 模型</h2><p>一组保存一把 Key，可勾选同平台多个模型。拍照时直接切换，更换 Key 只需修改这一组。</p>
    <ModelPicker v-if="ready && state.profiles.length" :key="pickerKey" compact :busy="busy" label="拍照与聊天使用的模型" @switching="modelSwitching"/>
    <p v-if="state.profiles.some(profile => profile.provider === 'openrouter')" class="small-text muted" data-testid="openrouter-removed-note">OpenRouter的Google／Gemma型号已移除，已有Key仍保留；若原来正在使用该型号，请重新选用本组可用模型。</p>
    <button type="button" class="button secondary model-key-help-button" data-testid="open-model-key-guides" @click="openHelp()"><BookOpen :size="16" />API Key 申请与多模型教程</button>
    <p class="notice warning small-text">照片会发送至所选提供商。保存和测试连接会发送一张内置测试图，可能消耗少量额度；识别失败不会自动切换模型或 Key。</p>
    <div class="model-profiles" data-testid="model-profiles">
      <div v-for="profile in state.profiles" :key="profile.id" class="model-profile" :data-testid="`model-profile-${profile.id}`">
        <div><strong>{{ profile.label }}</strong><span v-if="state.activeId === profile.id" class="soft-tag" data-testid="active-model">使用中</span><p class="small-text muted">{{ providerName(profile.provider) }} · 当前 {{ profile.model }}</p><div class="profile-models"><span v-for="item in personalProfileModels(profile)" :key="item" class="soft-tag">{{ item }} · {{ personalModelInfo(profile.provider, item).badge }}</span></div></div>
        <div class="model-actions">
          <button v-if="personalProviders.find(item => item.id === profile.provider)!.models.length > 1" type="button" class="text-button" :disabled="busy" data-testid="manage-key-models" @click="openForm(profile)">管理可用模型</button>
          <button v-if="state.activeId !== profile.id" class="text-button" :disabled="busy" data-testid="activate-model" @click="operation(() => activatePersonalProfile(profile.id), '已选用此配置，下一次识别生效。')"><Check :size="15" />选用</button>
          <button class="text-button" :disabled="busy" data-testid="test-model" @click="operation(() => testPersonalProfile(profile.id), '测试图调用成功。真实餐食的结构和准确性仍需检查。')">测试</button>
          <button type="button" class="text-button model-edit-button" :disabled="busy" :aria-label="`修改模型配置${profile.label}`" data-testid="edit-model" @click="openForm(profile)"><Pencil :size="16" />修改</button>
          <button class="icon-button" :disabled="busy" :aria-label="`删除模型配置${profile.label}`" data-testid="delete-model" @click="remove(profile)"><Trash2 :size="16" /></button>
        </div>
      </div>
    </div>
    <p v-if="ready && !state.profiles.length" class="small-text muted">还没有配置。可先试硅基流动免费模型，或添加已有百炼配置。</p>
    <button v-if="!formOpen" type="button" class="button primary" data-testid="add-model" :disabled="busy || !ready || state.profiles.length >= 12" @click="openForm()"><Plus :size="16" />添加 Key 配置</button>
    <p v-if="busy" class="small-text muted" role="status" data-testid="model-operation-status"><LoaderCircle class="spin" :size="16" />正在处理…</p>
    <p v-if="message" class="notice subtle" role="status" data-testid="model-message">{{ message }}</p>
    <p v-if="error && !formOpen" class="notice danger" role="alert" data-testid="model-error">{{ error }}</p>
    <p class="tiny muted">Key 在安卓私有空间加密保存，不进入记录备份。加密不能消除设备被攻破时的泄露风险。换手机需重新填写；本机保护上限为每分钟 5 次、每天 100 次请求（含测试和失败），并非账户账单上限。</p>
    <button class="text-button" data-testid="clear-models" :disabled="busy" @click="clear">清空全部模型配置</button>
    <AppSheet :open="formOpen" :title="editingId ? '修改模型配置' : '添加 Key 配置'" :subtitle="editingProfile ? `正在修改「${editingProfile.label}」· ${providerName(editingProfile.provider)}` : '同一平台的一把 Key，可以勾选多个可用模型。'" :busy="busy" test-id="model-config-sheet" class-name="model-config-sheet" @close="closeForm">
      <p v-if="error" class="notice danger" role="alert" data-testid="model-error">{{ error }}</p>
      <p v-if="busy" class="notice subtle" role="status">正在测试默认／当前模型，成功后保存配置，请稍候…</p>
      <form :id="formId" class="model-form" data-testid="model-form" :aria-busy="busy" @submit.prevent="save">
      <label>配置名称<input v-model="label" data-testid="model-label" maxlength="40" autocomplete="off" placeholder="例如：我的百炼日常 / Gemini 备用" :disabled="busy" required /></label>
      <div class="model-form-row"><label>提供商<select v-model="provider" data-testid="model-provider" :disabled="busy || Boolean(editingId)" @change="providerChanged"><option v-for="item in personalProviders" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label>默认／当前模型<select v-model="model" data-testid="model-name" :disabled="busy" @change="modelChanged"><option v-for="item in models" :key="item" :value="item">{{ item }} · {{ personalModelInfo(provider, item).badge }}</option></select></label></div>
      <fieldset class="model-enabled-list" data-testid="model-enabled-list"><legend>这把 Key 可使用的模型</legend><button v-if="models.length > 1" type="button" class="text-button" data-testid="enable-all-models" :disabled="busy" @click="enabledModels = [...models]">全选本平台模型</button><label v-for="item in models" :key="item"><input v-model="enabledModels" type="checkbox" :value="item" :data-testid="`enable-model-${item}`" :disabled="busy || (enabledModels.length === 1 && enabledModels.includes(item))" @change="modelsChanged" /><span>{{ item }}<small>{{ personalModelInfo(provider, item).badge }}</small><small v-if="personalModelUsageNotice(provider, item)" class="model-usage-note">{{ personalModelUsageNotice(provider, item) }}</small></span></label></fieldset>
      <div class="model-cost-note" data-testid="model-cost-note"><strong>{{ selectedInfo.badge }}</strong><p>{{ selectedInfo.note }}</p><a :href="selectedInfo.keyUrl" target="_blank" rel="noopener noreferrer">获取 Key／查看额度 ↗</a><span class="tiny muted">价格与可用额度以平台为准；此处不读取账户余额。</span></div>
      <label>API Key<input v-model="apiKey" data-testid="model-api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" :placeholder="editingId ? '留空保留本组 Key；填写则统一替换' : '只需粘贴一次，同组模型共用'" :disabled="busy" :required="!editingId" /></label>
      <p v-if="editingId" class="tiny muted" data-testid="model-edit-key-note">已保存的 Key 不会显示；留空继续使用，填写新 Key 则替换本组 Key。</p>
      <button type="button" class="text-button model-key-context-help" data-testid="model-key-help" @click="openHelp()"><BookOpen :size="15" />{{ provider === 'glm' ? '智谱 Key 申请与充值教程' : `如何获取 ${providerName(provider)} Key？` }}</button>
      <p class="tiny muted">同组模型共用这一把 Key 和平台额度，不能跨平台混用。保存时只测试默认／当前模型，其他模型的权限在实际使用时验证；不会自动轮换。最多12组 Key。</p>
      </form>
      <template #footer><div class="model-config-footer"><button type="button" class="button secondary" data-testid="cancel-model" :disabled="busy" @click="closeForm">取消</button><button type="submit" :form="formId" class="button primary" data-testid="save-model" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="16" />{{ busy ? '正在测试连接…' : '测试并保存' }}</button></div></template>
    </AppSheet>
    <AppSheet :open="helpOpen" title="API Key 申请教程" subtitle="先按平台申请，同平台多个模型通常共用一把 Key。" test-id="model-key-help-sheet" @close="helpOpen = false">
      <label class="key-guide-provider">查看哪个平台<select v-model="helpProvider" data-testid="key-guide-provider"><option v-for="item in personalProviders" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <ModelKeyGuide :provider="helpProvider" />
    </AppSheet>
  </article>
</template>
