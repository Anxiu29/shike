import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGiteeUpdate } from './app-updates.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { FastifyInstance } from 'fastify';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('Gitee公开更新元数据接口', () => {
  it.each(['http-error', 'oversized'] as const)('取消%s响应永不完成也不会卡住业务错误', async scenario => {
    const cleanup = Promise.withResolvers<void>();
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { if (scenario === 'oversized') controller.enqueue(new Uint8Array(65537)); },
      cancel() { cancelled = true; return cleanup.promise; },
    }), { status: scenario === 'http-error' ? 404 : 200 });
    const pending = readGiteeUpdate('a/b', 'v-next', async () => response).then(() => 'unexpected-success', error => error.code);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([pending, new Promise<string>(resolve => { timer = setTimeout(() => resolve('blocked-by-cleanup'), 50); })]);
      expect(outcome).toBe(scenario === 'http-error' ? 'UPDATE_SOURCE_UNAVAILABLE' : 'UPDATE_METADATA_INVALID');
      expect(cancelled).toBe(true);
      expect(response.body!.locked).toBe(false);
    } finally { if (timer) clearTimeout(timer); cleanup.resolve(); await pending; }
  });
  it('下载中的响应忽略fetch信号时仍会在截止时取消并结束读取', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let cancelled = false;
    let streamController: ReadableStreamDefaultController | undefined;
    const response = new Response(new ReadableStream({ start(value) { streamController = value; }, cancel() { cancelled = true; } }));
    const pending = readGiteeUpdate('a/b', 'v-next', async () => response).then(() => 'unexpected-success', error => error.code);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await vi.waitFor(() => expect(response.body!.locked).toBe(true));
      controller.abort();
      const outcome = await Promise.race([pending, new Promise<string>(resolve => { timer = setTimeout(() => resolve('still-reading'), 50); })]);
      expect(outcome).toBe('UPDATE_SOURCE_UNAVAILABLE');
      expect(cancelled).toBe(true); expect(response.body!.locked).toBe(false);
    } finally { if (timer) clearTimeout(timer); timeout.mockRestore(); if (!cancelled) streamController?.close(); await pending; }
  });
  it('固定公开列表/JSON路径，不发送凭据或模型Key，允许官方附件CDN跳转', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('', { status: 302, headers: { location: '/anxiu29/shike/attach_files/123/download' } })).mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://foruda.gitee.com/attach/example.json?signature=temporary' } })).mockResolvedValueOnce(new Response('{"schemaVersion":1}'));
    expect(await readGiteeUpdate('anxiu29/shike', undefined, fetcher)).toEqual([]);
    expect(await readGiteeUpdate('anxiu29/shike', 'v-next', fetcher)).toEqual({ schemaVersion: 1 });
    expect(fetcher.mock.calls[0]![0]).toBe('https://gitee.com/api/v5/repos/anxiu29/shike/releases?page=1&per_page=10&direction=desc');
    expect(fetcher.mock.calls[1]![0]).toBe('https://gitee.com/anxiu29/shike/releases/download/v-next/shike-update.json');
    for (const [, options] of fetcher.mock.calls) { expect(options).toMatchObject({ credentials: 'omit', redirect: 'manual' }); expect(options?.headers).not.toHaveProperty('Authorization'); }
  });
  it('拒绝任意URL、凭据、APK代理与跨主机跳转', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const repo of ['https://evil.test/a/b', 'https://token@gitee.com/a/b', 'a/b/../../c']) await expect(readGiteeUpdate(repo, undefined, fetcher)).rejects.toThrow();
    for (const tag of ['..', 'a/b', 'a\\b', '']) await expect(readGiteeUpdate('a/b', tag, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    await expect(readGiteeUpdate('a/b', 'v-next', fetcher)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('限制JSON大小并区分损坏文件与源不可达', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('x'.repeat(65537))).mockResolvedValueOnce(new Response('<html>error</html>')).mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(readGiteeUpdate('a/b', 'v-next', fetcher)).rejects.toMatchObject({ code: 'UPDATE_METADATA_INVALID' });
    await expect(readGiteeUpdate('a/b', 'v-next', fetcher)).rejects.toMatchObject({ code: 'UPDATE_METADATA_INVALID' });
    await expect(readGiteeUpdate('a/b', 'v-next', fetcher)).rejects.toMatchObject({ code: 'UPDATE_SOURCE_UNAVAILABLE' });
  });
  it('HTTP入口参数严格、限频且不占用AI服务或日额度', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('[]'));
    const app = await buildApp({ config: loadConfig({ AI_MODE: 'mock', NODE_ENV: 'test' }), fetchImpl: fetcher }); apps.push(app);
    for (const url of ['/api/app-updates/gitee?repository=a%2Fb&url=http://localhost', '/api/app-updates/gitee?repository=https://evil.test/a/b', '/api/app-updates/gitee?repository=a%2Fb&tag=..']) expect((await app.inject(url)).statusCode).toBe(400);
    const result = await app.inject('/api/app-updates/gitee?repository=anxiu29%2Fshike'); expect(result.statusCode).toBe(200); expect(result.json()).toEqual([]); expect(result.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/api/app-updates/gitee?repository=a%2Fb', headers: { origin: 'https://evil.test' } })).statusCode).toBe(403);
    for (let i = 0; i < 6; i++) await app.inject('/api/app-updates/gitee?repository=a%2Fb');
    expect((await app.inject('/api/app-updates/gitee?repository=a%2Fb')).statusCode).toBe(429);
    expect(fetcher.mock.calls.every(call => String(call[0]).startsWith('https://gitee.com/api/v5/repos/'))).toBe(true);
  });
});
