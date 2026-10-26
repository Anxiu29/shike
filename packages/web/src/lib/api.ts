/**
 * 页面统一网络入口：direct交安卓PersonalVision插件，service交自己的Node HTTP接口。
 * FormData上传图片时浏览器生成boundary，不手设Content-Type；文字助手才发送JSON。
 * 两种路由都返回共享schema；AbortController限制等待时间，finally清理定时器。
 * health成功不代表真实模型调用成功；界面处理中文错误且不把失败变成模拟成功。
 * 桥接/Key生命周期参照personal-vision.ts与docs/personal-models.md。
 */
import { healthResponseSchema, recognitionResponseSchema, type HealthResponse, type RecognitionResponse } from '@shike/shared'
import { apiEndpoint, readConnection, writeConnection } from './connection'
import { aiRoute, personalHealth, recognizePersonalImage } from './personal-vision'
import { selectedLocalModel } from './model-selection'
import { serviceConnectionsEnabled } from './features'
import { assistantRequestSchema, assistantResponseSchema, type AssistantRequest, type AssistantResponse } from '@shike/shared'
import { describePersonalMeal } from './personal-vision'

// 前后端共用响应类型，提供商切换不会改变页面消费的接口。
export type Health = HealthResponse
export type { RecognitionResponse }

export async function getHealth(): Promise<Health> {
  if (aiRoute() === 'direct') return personalHealth()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(apiEndpoint('/api/health'), { signal: controller.signal, credentials: 'omit', redirect: 'error' })
    if (!response.ok) throw new Error('识别服务暂时无法连接')
    return healthResponseSchema.parse(await response.json())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('AI 服务连接超时，离线记录仍可使用。')
    if (error instanceof TypeError) throw new Error('AI 服务暂时无法连接，请检查网络和设置中的服务地址。')
    throw error
  } finally { window.clearTimeout(timer) }
}

export async function connectService(baseUrl: string, accessCode: string): Promise<Health> {
  if (!serviceConnectionsEnabled()) throw new Error('自建服务连接暂未启用。')
  const previous = readConnection()
  // 测试候选地址时不把旧服务的令牌发到新域名。
  const connection = { baseUrl, ...(previous.baseUrl === baseUrl ? { token: previous.token, expiresAt: previous.expiresAt } : {}) }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(apiEndpoint('/api/health', connection), { signal: controller.signal, credentials: 'omit', redirect: 'error' })
    if (!response.ok) throw new Error('无法连接此服务，请核对地址和网络。')
    const health = healthResponseSchema.parse(await response.json())
    if (health.authRequired) {
      if (!accessCode && !connection.token) throw new Error('此服务需要内测访问码。')
      if (accessCode) {
        const session = await fetch(apiEndpoint('/api/session', connection), { method: 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode }) })
        const payload = await session.json().catch(() => null)
        if (!session.ok) throw new Error(payload?.error?.message || '访问码验证失败。')
        if (typeof payload?.token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(payload.token) || payload.token.length >= 1024 || typeof payload.expiresAt !== 'string' || !(Date.parse(payload.expiresAt) > Date.now())) throw new Error('服务返回了无效的访问凭证。')
        Object.assign(connection, { token: payload.token, expiresAt: payload.expiresAt })
      }
    } else { delete connection.token; delete connection.expiresAt }
    writeConnection(connection)
    return health
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('连接超时，请检查服务地址和网络。')
    if (error instanceof TypeError) throw new Error('无法连接服务，请检查网络、HTTPS 证书和服务跨域配置。')
    throw error
  } finally { window.clearTimeout(timer) }
}

export async function recognizeImage(file: File): Promise<RecognitionResponse> {
  if (aiRoute() === 'direct') return recognizePersonalImage(file)
  const form = new FormData()
  form.append('image', file)
  if (!readConnection().baseUrl && selectedLocalModel() !== 'default') form.append('modelId', selectedLocalModel())
  const controller = new AbortController()
  const connection = readConnection()
  const timeout = window.setTimeout(() => controller.abort(), 70_000)
  try {
    const response = await fetch(apiEndpoint('/api/recognitions', connection), { method: 'POST', body: form, signal: controller.signal, credentials: 'omit', redirect: 'error', headers: connection.token ? { Authorization: `Bearer ${connection.token}` } : {} })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401) {
        const current = readConnection()
        if (current.baseUrl === connection.baseUrl && current.token === connection.token) writeConnection({ baseUrl: current.baseUrl })
      }
      const error = payload?.error
      throw new Error(error?.message || `识别失败（${response.status}），请稍后重试。`)
    }
    const parsed = recognitionResponseSchema.safeParse(payload)
    if (!parsed.success) throw new Error('识别服务返回了无效数据，请重试。')
    return parsed.data
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('识别超过 70 秒，请稍后重试。')
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。')
    throw error
  } finally { window.clearTimeout(timeout) }
}

export async function describeMeal(input: AssistantRequest): Promise<AssistantResponse> {
  const request = assistantRequestSchema.parse(input)
  if (aiRoute() === 'direct') return describePersonalMeal(request)
  const connection = readConnection(), controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 70000)
  try {
    const response = await fetch(apiEndpoint('/api/meal-assistant', connection), { method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) }, body: JSON.stringify({ ...request, ...(!connection.baseUrl ? { modelId: selectedLocalModel() } : {}) }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error?.message || `助手请求失败（${response.status}）`)
    const parsed = assistantResponseSchema.safeParse(payload)
    if (!parsed.success) throw new Error('助手返回的草稿无效，原草稿已保留。')
    return parsed.data
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('助手请求超时，输入与草稿已保留。')
    if (error instanceof TypeError) throw new Error('无法连接AI服务，输入与草稿已保留。')
    throw error
  } finally { window.clearTimeout(timer) }
}
