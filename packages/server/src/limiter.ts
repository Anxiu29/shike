import type { ServerConfig } from './config.js';
import { ApiError } from './errors.js';

/** 单进程内存限额用于本地 MVP；公网多副本部署需换成共享持久化限额。 */
export class RecognitionLimiter {
  private readonly byIp = new Map<string, number[]>();
  private active = 0;
  private day = '';
  private dailyCount = 0;
  constructor(private readonly config: ServerConfig, private readonly now: () => number = Date.now) {}

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

  acquire(): () => void {
    const now = this.now();
    // 用户日期口径为 Asia/Shanghai，不能依赖部署机器恰好也处于这个时区。
    const currentDay = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (currentDay !== this.day) { this.day = currentDay; this.dailyCount = 0; }
    if (this.dailyCount >= this.config.requestsPerDay) {
      const nextUtcDay = Date.parse(`${currentDay}T00:00:00Z`) + 16 * 60 * 60 * 1000;
      throw new ApiError('DAILY_LIMIT_REACHED', '今天的识别次数已达上限，请手动记录或明天再试。', 429, Math.ceil((nextUtcDay - now) / 1000));
    }
    if (this.active >= this.config.concurrency) throw new ApiError('AI_BUSY', '另一张照片正在识别，请稍后重试。', 429, 3);
    this.active += 1;
    this.dailyCount += 1;
    let released = false;
    return () => { if (!released) { released = true; this.active -= 1; } };
  }
}
