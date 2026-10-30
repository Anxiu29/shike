// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { normalizeApiBase, apiEndpoint, readConnection, writeConnection } from '../src/lib/connection'
import { connectService, describeMeal, recognizeImage } from '../src/lib/api'
vi.mock('@capacitor/core', async importOriginal => ({ ...await importOriginal<typeof import('@capacitor/core')>(), Capacitor: { isNativePlatform: vi.fn(() => false) } }))
beforeEach(() => { vi.stubEnv("VITE_ENABLE_SERVICE_CONNECTION", "true"); localStorage.clear(); vi.restoreAllMocks(); vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const health = { status: 'ok', mode: 'live', provider: 'qwen', model: 'qwen3.7-flash', authRequired: true }
const expiresAt = new Date(Date.now() + 86400000).toISOString()
const mealInput = { text: '午饭吃米饭', date: '2026-10-29', mealType: 'lunch' as const }

describe('独立 App 云端连接', () => {
  it('默认关闭功能时忽略旧连接，不能主动连接自建云端', async () => {
    writeConnection({ baseUrl: 'https://old.example.com', token: 'old.signature', expiresAt })
    vi.stubEnv('VITE_ENABLE_SERVICE_CONNECTION', 'false')
    expect(readConnection()).toEqual({ baseUrl: '' }); expect(apiEndpoint('/api/health')).toBe('/api/health')
    await expect(connectService('https://new.example.com', 'test-access-code')).rejects.toThrow('暂未启用')
  })
  it('HTTPS 来源规范化，拒绝明文、凭据、查询及路径', () => {
    expect(normalizeApiBase(' https://api.example.com/ ')).toBe('https://api.example.com')
    for (const url of ['http://api.example.com', 'https://user:pass@api.example.com', 'https://api.example.com/api', 'https://api.example.com/?key=secret', 'https://api.example.com/#secret']) expect(() => normalizeApiBase(url)).toThrow()
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    expect(() => apiEndpoint('/api/health')).toThrow('尚未连接')
  })
  it('连接成功只存令牌，不保存访问码，也不把旧令牌发送到新服务', async () => {
    writeConnection({ baseUrl: 'https://old.example.com', token: 'old.signature', expiresAt })
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(health))).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'new.signature', expiresAt })))
    vi.stubGlobal('fetch', request)
    await connectService('https://new.example.com', 'example-access-code')
    expect(readConnection()).toEqual({ baseUrl: 'https://new.example.com', token: 'new.signature', expiresAt })
    expect(localStorage.getItem('shike-api-connection-v1')).not.toContain('example-access-code')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('old.signature')
    expect(request.mock.calls[1][1].redirect).toBe('error')
  })
  it('候选服务连接失败保留原连接；过期令牌不读取', async () => {
    writeConnection({ baseUrl: 'https://old.example.com', token: 'old.signature', expiresAt })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    await expect(connectService('https://new.example.com', 'wrong')).rejects.toThrow('无法连接')
    expect(readConnection().baseUrl).toBe('https://old.example.com')
    writeConnection({ baseUrl: 'https://old.example.com', token: 'old.signature', expiresAt: '2020-01-01T00:00:00Z' })
    expect(readConnection().token).toBeUndefined()
  })
  it('上传只对所选服务带访问令牌，401 清理令牌但保留地址和本地数据', async () => {
    writeConnection({ baseUrl: 'https://api.example.com', token: 'test.signature', expiresAt })
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: '凭证失效' } }), { status: 401 }))
    vi.stubGlobal('fetch', request)
    await expect(recognizeImage(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))).rejects.toThrow('凭证失效')
    expect(request.mock.calls[0][0]).toBe('https://api.example.com/api/recognitions')
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer test.signature')
    expect(readConnection()).toEqual({ baseUrl: 'https://api.example.com' })
  })
  it('文字助手收到401也清除已失效令牌，保留服务地址', async () => {
    writeConnection({ baseUrl: 'https://api.example.com', token: 'old.signature', expiresAt })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(describeMeal(mealInput)).rejects.toThrow('401')
    expect(readConnection()).toEqual({ baseUrl: 'https://api.example.com' })
  })
  it('旧请求迟到的401不会删除用户刚更换的新令牌', async () => {
    writeConnection({ baseUrl: 'https://api.example.com', token: 'old.signature', expiresAt })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      writeConnection({ baseUrl: 'https://api.example.com', token: 'new.signature', expiresAt })
      return new Response('{}', { status: 401 })
    }))
    await expect(describeMeal(mealInput)).rejects.toThrow('401')
    expect(readConnection().token).toBe('new.signature')
  })
  it.each([
    { name: '识图', timeout: 70000, invoke: () => recognizeImage(new File(['test'], 'meal.jpg', { type: 'image/jpeg' })), message: '识别超过 70 秒' },
    { name: '文字助手', timeout: 70000, invoke: () => describeMeal(mealInput), message: '助手请求超时' },
    { name: '访问码验证', timeout: 10000, invoke: () => connectService('https://api.example.com', 'test-code'), message: '连接超时' },
  ])('$name 的响应体读取超时保留超时分类，不伪报数据或凭证无效', async ({ timeout, invoke, message }) => {
    vi.useFakeTimers()
    const responseHeaders = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      // fetch 已收到响应头，但下载 JSON 仍需响应同一个中断信号。
      json: () => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
    }))
    vi.stubGlobal('fetch', responseHeaders)
    if (timeout === 10000) responseHeaders.mockResolvedValueOnce(new Response(JSON.stringify(health)))
    const result = invoke().then(() => null, cause => cause)
    await vi.advanceTimersByTimeAsync(timeout)
    expect(await result).toBeInstanceOf(Error)
    expect((await result).message).toContain(message)
  })
});
