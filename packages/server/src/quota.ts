/**
 * 公网多次调用共享的日额度，通过OSS原子追加控制；分钟限频/并发仍由limiter在进程内管。
 * 额度服务故障必须阻止上游调用，不能降级为每实例内存计数后继续消耗真实额度。
 * OSS在这里存额度控制信息，不是用户餐食同步；部署权限及实例数限制见docs/cloud-deployment.md。
 */
import OSS from 'ali-oss';
import Credential from '@alicloud/credentials';
import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';

/** 成功表示预留一次调用资格；抛错必须阻止模型请求，不能当作“额度服务可选”。 */
export interface DailyQuota { consume(now: number, maximum: number): Promise<void>; }
/** 存储适配器只暴露读取长度和带预期位置追加，便于用内存实现验证跨实例竞争。 */
export interface AppendStore {
  size(key: string): Promise<number>;
  append(key: string, position: number): Promise<void>;
}
// 给UTC毫秒加8小时后取ISO日期，与主机系统时区无关；统一应用的北京时间计数口径。
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
  /**
   * 最长等待8秒。race只让调用者及时失败，signal阻止迟到读取继续触发新的存储写入。
   * AppendStore未承诺可中止在途请求；若append已送达OSS，超时后仍可能占用一次额度。
   * 这与“超时不退款”的保守计费边界一致，不能在未知写入结果时盲目重新预留。
   */
  async consume(now: number, maximum: number): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.reserve(now, maximum, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new ApiError('QUOTA_UNAVAILABLE', '识别额度服务响应超时，请稍后重试。', 503);
          controller.abort(error); reject(error);
        }, 8000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  /**
   * 一天对应一个追加对象，长度n等价于已经预留n次；position=n是比较并写入的原子条件。
   * 两个实例都读到n时只有一个能追加，另一个收到PositionNotEqualToLength后重新读。
   * 只为明确的竞争冲突最多尝试4次；网络失败的写入结果未知，不能当成冲突重试。
   */
  private async reserve(now: number, maximum: number, signal: AbortSignal): Promise<void> {
    const key = `shike-quota/${shanghaiDay(now)}.count`;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        signal.throwIfAborted();
        const size = await this.store.size(key);
        // Promise.race只停止调用者等待，不能停止迟到的存储请求；过期后禁止再发起追加。
        // 已在途的append仍可能成功，因此超时不代表已预留额度会自动退还。
        signal.throwIfAborted();
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
  // 每次操作从官方凭证链取当前凭证，临时STS凭证轮换后不继续使用过期Key。
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
        // 普通对象的长度不能作为此协议的原子追加计数，类型不符必须关闭调用资格。
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
