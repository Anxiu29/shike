import { describe, expect, it, vi } from 'vitest';
import { postJson } from './http.js';

const url = 'https://example.com/test-model';

describe('模型响应读取边界', () => {
  it('GLM错误正文恰好16KiB保留业务错误码，超限则取消并使用通用安全错误', async () => {
    const glmUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    const payload = JSON.stringify({ error: { code: '1308' } });
    const exact = new Response(payload + ' '.repeat(16384 - Buffer.byteLength(payload)), { status: 429 });
    await expect(postJson(glmUrl, {}, {}, 1000, vi.fn().mockResolvedValue(exact))).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', message: expect.stringContaining('使用上限') });
    let pulls = 0, cancelled = false;
    const oversized = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; if (pulls <= 2) controller.enqueue(new Uint8Array(9000)); else controller.error(new Error('不应继续读取')); },
      cancel() { cancelled = true; return new Promise(() => {}); },
    }, { highWaterMark: 0 }), { status: 429 });
    await expect(postJson(glmUrl, {}, {}, 1000, vi.fn().mockResolvedValue(oversized))).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', message: expect.stringContaining('429') });
    expect(pulls).toBe(2); expect(cancelled).toBe(true); expect(oversized.body!.locked).toBe(false);
  });
  it.each([undefined, '1', '9999999'])('恰好1MiB的有效JSON可读取，实际大小不依赖Content-Length=%s', async length => {
    const body = JSON.stringify('a'.repeat(1024 * 1024 - 2));
    const response = new Response(body, length ? { headers: { 'Content-Length': length } } : undefined);
    const result = await postJson(url, {}, {}, 1000, vi.fn().mockResolvedValue(response));
    expect(typeof result).toBe('string'); expect((result as string).length).toBe(1048574);
  });

  it('分块切在中文UTF-8字节中间仍能解析原文', async () => {
    const bytes = Buffer.from('{"message":"饭"}');
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 13)); controller.enqueue(bytes.subarray(13, 14)); controller.enqueue(bytes.subarray(14)); controller.close();
    } }));
    await expect(postJson(url, {}, {}, 1000, vi.fn().mockResolvedValue(response))).resolves.toEqual({ message: '饭' });
  });

  it('取消异常响应失败时不覆盖原HTTP错误', async () => {
    const response = new Response(new ReadableStream({ cancel() { return Promise.reject(new Error('取消失败')); } }), { status: 429 });
    await expect(postJson(url, {}, {}, 1000, vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
  });
  it('按UTF-8字节拒绝过大的有效JSON，不把中文字符数当字节数', async () => {
    const response = new Response(JSON.stringify({ message: '餐'.repeat(360000) }));
    const result = postJson(url, {}, {}, 1000, vi.fn().mockResolvedValue(response));
    const error = await result.then(() => null, error => error);
    expect(error).toMatchObject({ code: 'AI_INVALID_RESULT' });
  });

  it('分块超限后停止读取并取消流，不等待剩余正文', async () => {
    let pulls = 0, cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls <= 2) controller.enqueue(new Uint8Array(600000));
        else controller.error(new Error('越过上限后不应继续读取'));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }));
    await expect(postJson(url, {}, {}, 1000, vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ code: 'AI_INVALID_RESULT' });
    expect(pulls).toBe(2); expect(cancelled).toBe(true);
    expect(response.body!.locked).toBe(false);
  });

  it('响应下载超时会取消忽略fetch信号的响应流', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    await expect(postJson(url, {}, {}, 20, vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(response.body!.locked).toBe(false);
  });

  it('HTTP错误取消未读响应体并保留安全错误码', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 });
    await expect(postJson(url, {}, {}, 1000, vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ code: 'AI_FORBIDDEN' });
    expect(cancelled).toBe(true);
  });
});
