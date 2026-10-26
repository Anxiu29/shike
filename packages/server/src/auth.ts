/**
 * 自建服务访问码换取有过期时间的签名令牌，保护的是服务端模型调用，不是云端餐食账号。
 * 签名/恒定时间比较由本模块负责，入口和限频在app.ts；令牌不随饮食备份导出。
 * 启用公网模式需配齐保护项，步骤与限制见docs/cloud-deployment.md。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';
import type { ServerConfig } from './config.js';

const lifetimeSeconds = 7 * 24 * 60 * 60;
const digest = (text: string) => createHash('sha256').update(text).digest();
/** 朋友内测访问码换取有期限的设备令牌；模型 Key 从不返回客户端。 */
export class AppAccess {
  constructor(private readonly config: ServerConfig, private readonly now = Date.now) {}
  get required(): boolean { return Boolean(this.config.accessCode); }
  private sign(payload: string): string {
    // 轮换访问码或签名密钥都会让旧令牌失效，无需云端保存设备列表。
    return createHmac('sha256', `${this.config.tokenSecret}:${this.config.accessCode}`).update(payload).digest('base64url');
  }
  create(code: string): { token: string; expiresAt: string } {
    if (!this.required) throw new ApiError('ACCESS_NOT_REQUIRED', '当前本地服务不需要访问码。');
    if (!timingSafeEqual(digest(code), digest(this.config.accessCode!))) throw new ApiError('ACCESS_CODE_INVALID', '内测访问码不正确。', 401);
    const expires = Math.floor(this.now() / 1000) + lifetimeSeconds;
    const payload = Buffer.from(JSON.stringify({ v: 1, exp: expires, nonce: randomBytes(16).toString('hex') })).toString('base64url');
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }
  verify(header: string | undefined): void {
    if (!this.required) return;
    const token = header?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
    if (token && token.length < 1024) {
      const [payload, signature] = token.split('.') as [string, string];
      if (timingSafeEqual(digest(signature), digest(this.sign(payload)))) {
        try {
          const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { v?: unknown; exp?: unknown; nonce?: unknown };
          const now = Math.floor(this.now() / 1000);
          if (data.v === 1 && typeof data.exp === 'number' && data.exp > now && data.exp <= now + lifetimeSeconds && typeof data.nonce === 'string' && /^[a-f0-9]{32}$/.test(data.nonce)) return;
        } catch { /* 不向请求方透露签名或令牌解析细节。 */ }
      }
    }
    throw new ApiError('APP_UNAUTHORIZED', '请在设置中输入内测访问码；已有凭证可能已过期。', 401);
  }
}
