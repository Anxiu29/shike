import { healthResponseSchema, recognitionResponseSchema, type HealthResponse, type RecognitionResponse } from '@shike/shared'

// 前后端共用响应类型，提供商切换不会改变页面消费的接口。
export type Health = HealthResponse
export type { RecognitionResponse }

export async function getHealth(): Promise<Health> {
  const response = await fetch('/api/health')
  if (!response.ok) throw new Error('识别服务暂时无法连接')
  return healthResponseSchema.parse(await response.json())
}

export async function recognizeImage(file: File): Promise<RecognitionResponse> {
  const form = new FormData()
  form.append('image', file)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 50_000)
  try {
    const response = await fetch('/api/recognitions', { method: 'POST', body: form, signal: controller.signal })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = payload?.error
      throw new Error(error?.message || `识别失败（${response.status}），请稍后重试。`)
    }
    const parsed = recognitionResponseSchema.safeParse(payload)
    if (!parsed.success) throw new Error('识别服务返回了无效数据，请重试。')
    return parsed.data
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('识别超过 50 秒，请稍后重试。')
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。')
    throw error
  } finally { window.clearTimeout(timeout) }
}
