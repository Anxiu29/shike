import { ApiError, upstreamError } from '../errors.js';
import type { FetchLike } from './types.js';
import { discardResponse, readBoundedText, ResponseTooLargeError } from '../http-body.js';

/**
 * 所有模型适配器共用的出站HTTP边界：输入为固定端点、供应商请求体和认证头，
 * 输出unknown，交给各适配器提取文本，再由共享schema验证业务结果。
 * HTTP成功只证明传输成功；JSON合法也不代表识别结构或营养假设合法。
 * 这层不重试，避免一次用户动作变成多次计费；错误只返回可公开的稳定ApiError。
 */
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
      // 仅GLM的固定端点需要错误业务码来区分账户/并发限制；其它错误正文直接丢弃。
      // 限制16KiB并只取code，不能把供应商原始消息直接展示给浏览器。
      if (url === 'https://open.bigmodel.cn/api/paas/v4/chat/completions' && response.body) {
        try {
          const error = JSON.parse(await readBoundedText(response, 16384, controller.signal));
          const code = error?.error?.code; if (typeof code === 'string' || typeof code === 'number') glmCode = String(code);
        } catch { /* 格式异常继续使用安全的HTTP错误，不回显上游原文。 */ }
      } else discardResponse(response);
      throw upstreamError(response.status, response.headers.get('retry-after'), glmCode);
    }
    let text: string;
    try { text = await readBoundedText(response, 1024 * 1024, controller.signal); }
    catch (error) {
      if (error instanceof ResponseTooLargeError) throw new ApiError('AI_INVALID_RESULT', '模型响应过大，请重新识别。', 502);
      throw error;
    }
    try { return JSON.parse(text) as unknown; }
    catch { throw new ApiError('AI_INVALID_JSON', '模型服务返回了无效响应，请稍后重试。', 502); }
  };
  // Promise.race保证调用方能结束等待，abort负责让真实fetch/读取器释放网络资源。
  // 二者缺一不可：只race可能留下后台下载，只abort无法约束忽略信号的fetch实现。
  try { return await Promise.race([request(), timeout]); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('AI_NETWORK_ERROR', '无法连接模型服务，请检查服务端网络或稍后重试。', 502);
  } finally { if (timer) clearTimeout(timer); } // 快速成功也清定时器，避免空闲进程仍被它保活。
}
