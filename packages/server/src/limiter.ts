import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';

/**
 * 三种互相独立的边界：IP滑动分钟窗口、全局处理并发、北京时间全局日计数。
 * 分钟计数在入口发生（非法请求也可能消耗限频），日计数在图片验证成功后发生。
 * 状态只存在本Node进程；公网多副本的日总额度必须另外使用quota.ts的共享存储。
 */
export class RecognitionLimiter {
  private readonly byIp = new Map<string, number[]>();
  private active = 0;
  private day = '';
  private dailyCount = 0;
  constructor(private readonly config: ServerConfig, private readonly now: () => number = Date.now) {}

  /** 记录本次尝试；窗口为(now-60s, now]，最早一条记录决定Retry-After。 */
  checkIp(ip: string): void {
    const now = this.now();
    // 定期清掉过期 IP，避免 Map 因长期运行或恶意来源不断增长。
    for (const [key, times] of this.byIp) if (times.every((time) => now - time >= 60000)) this.byIp.delete(key);
    const recent = (this.byIp.get(ip) ?? []).filter((time) => now - time < 60000);
    if (recent.length >= this.config.requestsPerMinute) {
      throw new ApiError('REQUEST_RATE_LIMITED', '识别请求太频繁，请稍后再试。', 429, Math.max(1, Math.ceil((60000 - (now - recent[0]!)) / 1000)));
    }
    recent.push(now);
    this.byIp.set(ip, recent);
  }

  /** 只检查不扣次，可在解码前拒绝已用尽额度的请求；跨午夜时重置旧计数。 */
  private checkDaily(): void {
    const now = this.now();
    // 用户日期口径为 Asia/Shanghai，不能依赖部署机器恰好也处于这个时区。
    const currentDay = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (currentDay !== this.day) { this.day = currentDay; this.dailyCount = 0; }
    if (this.dailyCount >= this.config.requestsPerDay) {
      const nextUtcDay = Date.parse(`${currentDay}T00:00:00Z`) + 16 * 60 * 60 * 1000;
      throw new ApiError('DAILY_LIMIT_REACHED', '今天的识别次数已达上限，请手动记录或明天再试。', 429, Math.ceil((nextUtcDay - now) / 1000));
    }
  }

  /** 解码前占用槽位，拒绝忙碌/额度耗尽的请求；验证失败不会扣每日额度。 */
  acquireSlot(): () => void {
    this.checkDaily();
    if (this.active >= this.config.concurrency) throw new ApiError('AI_BUSY', '另一张照片正在识别，请稍后重试。', 429, 3);
    this.active += 1;
    // 返回幂等释放函数，调用者在finally使用；误调用两次也不能把active减成负数。
    let released = false;
    return () => { if (!released) { released = true; this.active -= 1; } };
  }

  /** 验证完成后、请求上游前计数；重新检查可防止并发请求超出当日剩余额度。 */
  consumeDaily(): void { this.checkDaily(); this.dailyCount += 1; }
}
