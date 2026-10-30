import { Capacitor } from '@capacitor/core'
import { serviceConnectionsEnabled } from './features'

export interface ApiConnection { baseUrl: string; token?: string; expiresAt?: string }
const storageKey = 'shike-api-connection-v1'
/**
 * 服务地址统一存成 origin，例如 https://api.example.com（不带结尾斜线）。
 * 只允许 HTTPS 来源，拒绝 URL 中的账号、参数与路径，避免凭证进入地址或接口拼错。
 * 空串表示开发模式的同源服务；这里不是供应商模型地址，也不保存供应商 Key。
 */
export function normalizeApiBase(value: string): string {
  if (!value.trim()) return ''
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请输入完整的 HTTPS 服务地址。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('服务地址须为 HTTPS 来源，不含账号、路径、查询参数或片段。')
  return url.origin
}
/**
 * localStorage 是可损坏、可被旧版本写入的外部输入，因此每次读取都重新验证。
 * 无效/过期令牌只从本次返回值移除，仍保留合法服务地址，方便重新验证访问码。
 * 功能开关关闭时完全忽略旧配置；返回空地址并不授权原生 App 请求 localhost。
 */
export function readConnection(): ApiConnection {
  if (!serviceConnectionsEnabled()) return { baseUrl: '' }
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as ApiConnection
    const baseUrl = normalizeApiBase(typeof value.baseUrl === 'string' ? value.baseUrl : '')
    const valid = typeof value.token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token) && value.token.length < 1024 && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.now()
    return { baseUrl, ...(valid ? { token: value.token, expiresAt: value.expiresAt } : {}) }
  } catch { return { baseUrl: '' } }
}
/** setItem 的配额/权限错误交回调用者；写入失败不能伪装成连接已保存。 */
export function writeConnection(value: ApiConnection): void {
  const baseUrl = normalizeApiBase(value.baseUrl)
  localStorage.setItem(storageKey, JSON.stringify({ ...value, baseUrl }))
}
/** 指定 connection 可把一次请求固定在同一地址，避免异步过程中换服务导致令牌串用。 */
export function apiEndpoint(path: string, connection = readConnection()): string {
  if (!path.startsWith('/api/')) throw new Error('无效的食刻接口路径。')
  if (connection.baseUrl) return normalizeApiBase(connection.baseUrl) + path
  // 独立 App 没有本地 Node 服务，不能把 https://localhost 当成 AI 后端。
  if (Capacitor.isNativePlatform() || import.meta.env.VITE_APP_STANDALONE === 'true') throw new Error(serviceConnectionsEnabled() ? '尚未连接云端 AI 服务，请到设置填写 HTTPS 服务地址；离线记录仍可使用。' : '请到设置添加并选用手机模型配置；离线记录仍可使用。')
  return path
}
export function forgetToken(): void { const { baseUrl } = readConnection(); writeConnection({ baseUrl }) }
