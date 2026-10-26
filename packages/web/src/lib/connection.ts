import { Capacitor } from '@capacitor/core'
import { serviceConnectionsEnabled } from './features'

export interface ApiConnection { baseUrl: string; token?: string; expiresAt?: string }
const storageKey = 'shike-api-connection-v1'
/** 此处只保存自己的服务地址和短期访问令牌，绝不能填供应商模型 Key。 */
export function normalizeApiBase(value: string): string {
  if (!value.trim()) return ''
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请输入完整的 HTTPS 服务地址。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('服务地址须为 HTTPS 来源，不含账号、路径、查询参数或片段。')
  return url.origin
}
export function readConnection(): ApiConnection {
  if (!serviceConnectionsEnabled()) return { baseUrl: '' }
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as ApiConnection
    const baseUrl = normalizeApiBase(typeof value.baseUrl === 'string' ? value.baseUrl : '')
    const valid = typeof value.token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token) && value.token.length < 1024 && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.now()
    return { baseUrl, ...(valid ? { token: value.token, expiresAt: value.expiresAt } : {}) }
  } catch { return { baseUrl: '' } }
}
export function writeConnection(value: ApiConnection): void {
  const baseUrl = normalizeApiBase(value.baseUrl)
  localStorage.setItem(storageKey, JSON.stringify({ ...value, baseUrl }))
}
export function apiEndpoint(path: string, connection = readConnection()): string {
  if (!path.startsWith('/api/')) throw new Error('无效的食刻接口路径。')
  if (connection.baseUrl) return normalizeApiBase(connection.baseUrl) + path
  // 独立 App 没有本地 Node 服务，不能把 https://localhost 当成 AI 后端。
  if (Capacitor.isNativePlatform() || import.meta.env.VITE_APP_STANDALONE === 'true') throw new Error(serviceConnectionsEnabled() ? '尚未连接云端 AI 服务，请到设置填写 HTTPS 服务地址；离线记录仍可使用。' : '请到设置添加并选用手机模型配置；离线记录仍可使用。')
  return path
}
export function forgetToken(): void { const { baseUrl } = readConnection(); writeConnection({ baseUrl }) }
