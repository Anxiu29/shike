import { ApiError, upstreamError } from '../errors.js';
import type { FetchLike } from './types.js';

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number, fetchImpl: FetchLike): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 超时覆盖响应下载和解析；就算测试 fetch 不响应 abort，也不会永久挂起。
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ApiError('AI_TIMEOUT', '识别超时，请稍后重试或手动记录。', 504)); }, timeoutMs);
  });
  const request = async () => {
    const response = await fetchImpl(url, {
      // 带密钥的请求不跟随跳转，端点只能是各适配器的固定地址。
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: controller.signal,
    });
    // 不向浏览器透传模型原始错误，避免上游泄露请求内容或账户信息。
    if (!response.ok) {
      let glmCode: string | undefined;
      if (url === 'https://open.bigmodel.cn/api/paas/v4/chat/completions' && response.body) {
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 16384) { await reader.cancel(); break } chunks.push(chunk.value) }
          if (size <= 16384) { const error = JSON.parse(Buffer.concat(chunks).toString('utf8')); const code = error?.error?.code; if (typeof code === 'string' || typeof code === 'number') glmCode = String(code) }
        } catch { /* 格式异常继续使用安全的HTTP错误，不回显上游原文。 */ }
        finally { reader.releaseLock() }
      }
      throw upstreamError(response.status, response.headers.get('retry-after'), glmCode);
    }
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new ApiError('AI_INVALID_RESULT', '模型响应过大，请重新识别。', 502);
    try { return JSON.parse(text) as unknown; }
    catch { throw new ApiError('AI_INVALID_JSON', '模型服务返回了无效响应，请稍后重试。', 502); }
  };
  try { return await Promise.race([request(), timeout]); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('AI_NETWORK_ERROR', '无法连接模型服务，请检查服务端网络或稍后重试。', 502);
  } finally { if (timer) clearTimeout(timer); }
}
