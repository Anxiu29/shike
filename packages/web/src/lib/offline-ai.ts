/** 仅在独立安卓APK中调用原生推理。读取状态不加载模型，不发送云端请求。 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { offlineAssistantInput, parseOfflineAssistantDraft, type AssistantRequest, type AssistantResponse } from '@shike/shared'

export interface OfflineAiState {
  stage: string; busy: boolean; ready: boolean; loaded: boolean; backend: string
  bytes: number; downloadedBytes: number; progressBytes: number
  error: string; stopReason?: string; task?: string; maxOutputTokens?: number; text: string; loadMs: number; firstTextMs: number; responseMs: number; characters: number
  availableMemoryBytes: number; totalMemoryBytes: number; device: string
}
interface OfflineAiBridge {
  getState(): Promise<OfflineAiState>
  downloadModel(): Promise<void>
  importModel(): Promise<void>
  loadModel(options: { backend: 'cpu' | 'gpu' }): Promise<void>
  generate(options: { prompt: string }): Promise<void>
  cancel(): Promise<void>
  unload(): Promise<void>
  deleteModel(): Promise<void>
  prepareAssistant(options: { backend: 'cpu' | 'gpu' }): Promise<void>
  describeMeal(options: { backend: 'cpu' | 'gpu'; prompt: string; system: string; schema: unknown }): Promise<{ model: string; text: string; backend: string }>
}
export const offlineAi = registerPlugin<OfflineAiBridge>('OfflineAi')
export const offlineModel = {
  name: 'Qwen2.5-1.5B · Q8 文字版', bytes: 1_597_922_856,
  filename: 'Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm',
  url: 'https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/2f23bacf8ec78b83dfcd7271c5cb25777b1be5e0/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm',
  source: 'https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct',
  revision: '2f23bacf8ec78b83dfcd7271c5cb25777b1be5e0',
  sha256: 'c4a9b7289365ab80fe599b844b77ad253eb3c53fb0e5d963d699146a6f01255e',
}
export function offlineAiSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('OfflineAi')
}
export function formatOfflineBytes(value: number) { return `${(value / 1_000_000_000).toFixed(2)} GB` }
export function formatOfflineTime(value?: number) { return value === undefined || value < 0 ? '—' : `${(value / 1000).toFixed(2)} 秒` }

const assistantKey = 'shike-offline-assistant-v1'
function preference(): { enabled: boolean; backend: 'cpu' | 'gpu' } {
  try { const saved = JSON.parse(localStorage.getItem(assistantKey) ?? '{}'); return { enabled: saved.enabled === true, backend: saved.backend === 'cpu' ? 'cpu' : 'gpu' } }
  catch { return { enabled: false, backend: 'gpu' } }
}
export function offlineAssistantEnabled() { return offlineAiSupported() && preference().enabled }
export function offlineAssistantBackend() { return preference().backend }
export function configureOfflineAssistant(enabled: boolean, backend = offlineAssistantBackend()) {
  if (enabled && !offlineAiSupported()) throw new Error('本机离线记餐需要新版安卓独立 APK。')
  localStorage.setItem(assistantKey, JSON.stringify({ enabled, backend }))
}
export async function describeOfflineMeal(input: AssistantRequest): Promise<AssistantResponse> {
  const { prompt, text, schema } = offlineAssistantInput(input), backend = offlineAssistantBackend()
  const state = await offlineAi.getState()
  if (state.busy) throw new Error('本机模型正在操作，请等待或停止后重试；原草稿已保留。')
  if (!state.loaded || state.backend !== backend) throw new Error('请先点击“准备模型”再发送。退后台、空闲释放或切换运行方式后需重新手动准备；输入与草稿已保留。')
  const response = await offlineAi.describeMeal({ backend, prompt: text, system: prompt, schema })
  if (response.model !== 'Qwen2.5-1.5B-Q8' || response.backend !== backend || typeof response.text !== 'string' || response.text.length > 32768) throw new Error('本机模型响应与本次选择不符，原草稿已保留。')
  return { mode: 'live', provider: 'offline', model: response.model, draft: parseOfflineAssistantDraft(response.text, input) }
}
