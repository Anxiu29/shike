/**
 * Capacitor桥接层：网页调用插件方法，安卓PersonalVisionPlugin执行HTTPS和Key加密存储。
 * 页面可提交新Key，但读取配置只拿掩码/模型元数据；不能从已存配置取回明文Key。
 * 统一提示词与响应解析复用shared；原生还需VisionPolicy限制上游地址、模型和重定向。
 * 这条路由仍需网络；独立APK可离线记餐不等于AI离线。详细设置/加密边界保留在
 * docs/personal-models.md；相机走另一套native-camera桥，不与模型插件混用。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { serviceConnectionsEnabled } from './features'
import { assistantPrompt, assistantJsonSchema, assistantRequestSchema, parseAssistantDraft, type AssistantRequest, type AssistantResponse } from '@shike/shared'
import { FOOD_PROMPT, GLM_FOOD_PROMPT, recognitionJsonSchema, personalStateSchema, personalProfileSchema, parseRecognition, geminiOutputText, chatCompletionOutputText, glmOutputText, type PersonalProfile, type PersonalState, type RecognitionResponse, type HealthResponse } from '@shike/shared'

export interface SavePersonalProfile { id?: string; label: string; provider: PersonalProfile['provider']; model: string; models?: string[]; apiKey: string }
interface PersonalVisionBridge {
  describeMeal(input: { id: string; model: string; prompt: string; request: string; schema: typeof assistantJsonSchema }): Promise<{ provider: string; model: string; data: string }>
  getState(): Promise<unknown>
  saveProfile(input: SavePersonalProfile): Promise<unknown>
  activate(input: { id: string; model?: string }): Promise<unknown>
  deleteProfile(input: { id: string }): Promise<unknown>
  clearProfiles(): Promise<unknown>
  testProfile(input: { id: string }): Promise<unknown>
  recognize(input: { id: string; model: string; imageBase64: string; prompt: string; schema: typeof recognitionJsonSchema }): Promise<{ provider: string; model: string; data: string }>
}
const native = registerPlugin<PersonalVisionBridge>('PersonalVision')
const routeKey = 'shike-ai-route-v1'
export function personalVisionSupported(): boolean {
  return Capacitor.isNativePlatform() && typeof Capacitor.getPlatform === 'function' && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PersonalVision')
}
export function aiRoute(): 'direct' | 'service' {
  if (!personalVisionSupported()) return 'service'
  if (!serviceConnectionsEnabled()) return 'direct'
  return localStorage.getItem(routeKey) === 'service' ? 'service' : 'direct'
}
export function setAiRoute(route: 'direct' | 'service') { localStorage.setItem(routeKey, route) }
function state(value: unknown): PersonalState {
  const parsed = personalStateSchema.safeParse(value)
  if (!parsed.success) throw new Error('手机模型配置无效，请重新打开设置或清空模型配置后添加。')
  return parsed.data
}
export async function getPersonalState() { return state(await native.getState()) }
export async function savePersonalProfile(input: SavePersonalProfile) {
  // 不将输入对象写入 localStorage/IndexedDB；Key 只交给原生插件。
  const parsed = personalProfileSchema.safeParse({ id: input.id ?? '00000000-0000-4000-8000-000000000000', label: input.label.trim(), provider: input.provider, model: input.model, ...(input.models === undefined ? {} : { models: input.models }) })
  if (!parsed.success) throw new Error('请填写配置名称，并选择支持的提供商与模型。')
  if ((!input.id || input.apiKey.trim()) && !/^[!-~]{8,512}$/.test(input.apiKey.trim())) throw new Error('请输入有效的 API Key，不含空格或换行。')
  return state(await native.saveProfile(input))
}
export async function activatePersonalProfile(id: string, model?: string) { return state(await native.activate({ id, ...(model === undefined ? {} : { model }) })) }
export async function deletePersonalProfile(id: string) { return state(await native.deleteProfile({ id })) }
export async function clearPersonalProfiles() { return state(await native.clearProfiles()) }
export async function testPersonalProfile(id: string) { return state(await native.testProfile({ id })) }
export async function personalHealth(): Promise<HealthResponse> {
  const value = await getPersonalState()
  const active = value.profiles.find(profile => profile.id === value.activeId)
  if (!active) throw new Error('请到设置添加并选用模型配置，填写自己的 API Key；离线记录仍可使用。')
  // 仅检查本机配置，启动 App 不产生收费请求。
  return { status: 'ok', mode: 'live', provider: active.provider, model: active.model }
}
async function fileBase64(file: File): Promise<string> {
  if (file.type !== 'image/jpeg' || file.size === 0 || file.size > 1024 * 1024) throw new Error('请先将照片压缩成不超过 1 MB 的 JPEG。')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('照片读取失败，请重新选择。'))
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/jpeg;base64,')) return reject(new Error('照片编码失败。'))
      resolve(reader.result.slice(reader.result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}
export async function recognizePersonalImage(file: File): Promise<RecognitionResponse> {
  const current = await getPersonalState()
  const profile = current.profiles.find(value => value.id === current.activeId)
  if (!profile) throw new Error('请先到设置添加并选用一组模型配置。')
  const response = await native.recognize({ id: profile.id, model: profile.model, imageBase64: await fileBase64(file), prompt: profile.provider === 'glm' ? GLM_FOOD_PROMPT : FOOD_PROMPT, schema: recognitionJsonSchema })
  // 提供商、模型取本次快照，不能把配置切换后的标签贴到旧请求上。
  if (response.provider !== profile.provider || response.model !== profile.model || typeof response.data !== 'string' || response.data.length > 524288) throw new Error('模型响应与所选配置不一致，请重新识别。')
  let payload: unknown
  try { payload = JSON.parse(response.data) } catch { throw new Error('模型接口返回了无效 JSON，请重试或手动记录。') }
  const text = profile.provider === 'gemini' ? geminiOutputText(payload) : profile.provider === 'glm' ? glmOutputText(payload, profile.model) : chatCompletionOutputText(payload, true)
  const result = parseRecognition(text, { requireProfile: true, discardInvalidNutrition: profile.provider === 'glm' })
  return { mode: 'live', provider: profile.provider, model: profile.model, result }
}

export async function describePersonalMeal(input: AssistantRequest): Promise<AssistantResponse> {
  const request = assistantRequestSchema.parse(input), state = await getPersonalState()
  const profile = state.profiles.find(profile => profile.id === state.activeId)
  if (!profile) throw new Error('请先到设置添加并选用一组模型配置。')
  const response = await native.describeMeal({ id: profile.id, model: profile.model, prompt: assistantPrompt(request), request: JSON.stringify(request), schema: assistantJsonSchema })
  if (response.provider !== profile.provider || response.model !== profile.model || typeof response.data !== 'string' || response.data.length > 524288) throw new Error('助手响应与所选模型不一致，请重试。')
  let payload: unknown; try { payload = JSON.parse(response.data) } catch { throw new Error('助手接口返回无效JSON，当前草稿已保留。') }
  return { mode: 'live', provider: profile.provider, model: profile.model, draft: parseAssistantDraft(profile.provider === 'gemini' ? geminiOutputText(payload) : profile.provider === 'glm' ? glmOutputText(payload, profile.model) : chatCompletionOutputText(payload, true)) }
}
