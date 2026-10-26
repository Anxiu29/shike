/**
 * 公网多次调用共享的日额度，通过OSS原子追加控制；分钟限频/并发仍由limiter在进程内管。
 * 额度服务故障必须阻止上游调用，不能降级为每实例内存计数后继续消耗真实额度。
 * OSS在这里存额度控制信息，不是用户餐食同步；部署权限及实例数限制见docs/cloud-deployment.md。
 */
import OSS from 'ali-oss';
import Credential from '@alicloud/credentials';
import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';

export interface DailyQuota { consume(now: number, maximum: number): Promise<void>; }
export interface AppendStore {
  size(key: string): Promise<number>;
  append(key: string, position: number): Promise<void>;
}
export const shanghaiDay = (now: number): string => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export function dailyLimitError(now: number): ApiError {
  const next = Date.parse(`${shanghaiDay(now)}T00:00:00Z`) + 16 * 3600000;
  return new ApiError('DAILY_LIMIT_REACHED', '今天的识别次数已达上限，请手动记录或明天再试。', 429, Math.max(1, Math.ceil((next - now) / 1000)));
}

/** 每次调用追加一个字节，OSS 的 position 比较保证多实例不能抢占同一个名额。
 * 只存每日次数，不存照片、饮食、IP 或令牌。超时与失败也不退还已预留次数。
 */
export class OssDailyQuota implements DailyQuota {
  constructor(private readonly store: AppendStore) {}
  async consume(now: number, maximum: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.reserve(now, maximum), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ApiError('QUOTA_UNAVAILABLE', '识别额度服务响应超时，请稍后重试。', 503)), 8000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  private async reserve(now: number, maximum: number): Promise<void> {
    const key = `shike-quota/${shanghaiDay(now)}.count`;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const size = await this.store.size(key);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid quota size');
        if (size >= maximum) throw dailyLimitError(now);
        try { await this.store.append(key, size); return; }
        catch (error) {
          if ((error as { code?: string }).code !== 'PositionNotEqualToLength') throw error;
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    // 存储故障或竞争耗尽时停止真实调用，不能退回内存计数绕过成本上限。
    throw new ApiError('QUOTA_UNAVAILABLE', '识别额度服务暂时不可用，请稍后重试或手动记录。', 503);
  }
}

export function createDailyQuota(config: ServerConfig): DailyQuota | undefined {
  if (config.quotaStore !== 'oss') return undefined;
  // 凭证仅由云端环境或官方凭证链提供；可使用最小权限 RAM 用户或可刷新临时凭证。
  const credential = new Credential.default();
  const getClient = async () => {
    const keys = await credential.getCredential();
    if (!keys?.accessKeyId || !keys.accessKeySecret) throw new Error('No OSS credential');
    return new OSS({
      region: config.ossRegion!, bucket: config.ossBucket!, secure: true, authorizationV4: true,
      accessKeyId: keys.accessKeyId, accessKeySecret: keys.accessKeySecret,
      ...(keys.securityToken ? { stsToken: keys.securityToken } : {}), timeout: 4000,
    });
  };
  return new OssDailyQuota({
    async size(key) {
      try {
        const response = await (await getClient()).head(key);
        const headers = response.res.headers as Record<string, string>;
        if (headers['x-oss-object-type'] !== 'Appendable') throw new Error('Invalid quota object type');
        return Number(headers['content-length']);
      } catch (error) {
        if ((error as { code?: string }).code === 'NoSuchKey') return 0;
        throw error;
      }
    },
    async append(key, position) {
      await (await getClient()).append(key, Buffer.from('.'), { position: String(position), headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream' } });
    },
  });
}
