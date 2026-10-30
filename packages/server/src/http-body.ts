/** 上游正文按实际UTF-8字节限量；不信任Content-Length，也不先完整缓冲再检查。 */
export class ResponseTooLargeError extends Error {}

/** 丢弃无需解析的HTTP错误/重定向正文；触发取消，但不等待远端清理完成。 */
export function discardResponse(response: Response): void {
  // 取消只是清理资源，不能因上游cancel卡住或失败而覆盖原有业务错误。
  void response.body?.cancel().catch(() => {});
}

/**
 * 将响应流读取为UTF-8字符串，maxBytes约束实际收到的字节总量，含边界值。
 * 供模型、条码与更新接口共用；Content-Length可能缺失或谎报，不能用它代替累计。
 * AbortSignal不仅传给fetch，还绑定reader.cancel，避免响应头已到但正文一直不结束。
 * 返回前最多保留maxBytes正文；只在全部读完后解码，防止中文字符被分块截断。
 */
export async function readBoundedText(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) { signal?.throwIfAborted(); return ''; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const part = await reader.read();
      // cancel会让挂起的read返回done；再次检查信号才能区分“正常结束”和“已超时”。
      signal?.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new ResponseTooLargeError();
      chunks.push(part.value);
    }
    // 合并后解码，避免流分块切断中文或其它多字节字符。
    return Buffer.concat(chunks, size).toString('utf8');
  } catch (error) { cancel(); throw error; }
  // 取消和releaseLock是两件事：前者停止数据源，后者释放本函数持有的读取锁。
  // 成功/超限/超时都移除监听器，避免长生命周期signal一直引用reader及正文缓存。
  finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}
