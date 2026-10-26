// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateAppId } from '@shike/shared';
const mock = vi.hoisted(() => ({ native: false, bridge: { getInfo: vi.fn(), setRepository: vi.fn(), check: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(), install: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.native ? 'android' : 'web', isPluginAvailable: () => mock.native }, registerPlugin: () => mock.bridge }));
import { appUpdateInfo, buildUpdateInfo, checkAppUpdate, downloadAppUpdate, installAppUpdate, setUpdateRepository } from '../src/lib/app-updates';
const prefix = 'https://github.com/Anxiu29/shike/releases/download/v-next/';
const manifest = { schemaVersion: 1, appId: updateAppId, versionCode: 99, versionName: 'next-test', releasedAt: '2026-10-24T05:00:00.000Z', minSdk: 24, bytes: 2048, sha256: 'a'.repeat(64), notes: ['更新功能测试'] };
describe('更新桥接与网页版只读检查', () => {
  beforeEach(() => { mock.native = false; localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it('读取版本和保存仓库不联网，不保存访问令牌，损坏偏好可恢复', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await appUpdateInfo()).versionCode).toBeGreaterThan(31);
    await setUpdateRepository('https://github.com/team/public-app'); expect(buildUpdateInfo().repository).toBe('team/public-app');
    await expect(setUpdateRepository('https://secret@github.com/team/app')).rejects.toThrow();
    localStorage.setItem('shike-update-repository-v1', 'broken'); expect(buildUpdateInfo().repository).toBe('Anxiu29/shike');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('只读取GitHub公开资源，不发送凭据，必须核对大小与版本', async () => {
    await setUpdateRepository('Anxiu29/shike', '');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ draft: false, published_at: manifest.releasedAt, assets: [{ name: 'shike.apk', size: 2048, browser_download_url: prefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: prefix + 'shike-update.json' }] }]))).mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
    vi.stubGlobal('fetch', fetcher); const result = await checkAppUpdate(); expect(result.status).toBe('available'); expect(result.release?.manifest.versionCode).toBe(99);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, options] of fetcher.mock.calls) { expect(options.credentials).toBe('omit'); expect(options.headers).not.toHaveProperty('Authorization'); }
  });
  it('404和空发行版不同，不把网络问题显示为已是最新版', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(checkAppUpdate()).rejects.toThrow('尚未公开');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]'))); expect((await checkAppUpdate()).status).toBe('no_release');
  });
  const giteePrefix = 'https://gitee.com/anxiu29/shike/releases/download/v-next/';
  const giteeList = [{ tag_name: 'v-next', created_at: manifest.releasedAt, assets: [{ name: 'shike.apk', browser_download_url: giteePrefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: giteePrefix + 'shike-update.json' }] }];
  const githubList = [{ draft: false, published_at: manifest.releasedAt, assets: [{ name: 'shike.apk', size: 2048, browser_download_url: prefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: prefix + 'shike-update.json' }] }];
  const response = (value: unknown) => new Response(JSON.stringify(value));
  it('默认先查Gitee，有新版就使用国内地址且不访问GitHub', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(giteeList)).mockResolvedValueOnce(response(manifest)); vi.stubGlobal('fetch', fetcher);
    const result = await checkAppUpdate(); expect(result.release?.source).toBe('gitee'); expect(result.release?.apkUrl).toBe(giteePrefix + 'shike.apk');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/app-updates/gitee?repository=anxiu29%2Fshike', '/api/app-updates/gitee?repository=anxiu29%2Fshike&tag=v-next']);
    for (const [, options] of fetcher.mock.calls) { expect(options.credentials).toBe('omit'); expect(options.headers).not.toHaveProperty('Authorization'); }
  });
  it.each(['network', 'empty', 'current'])('Gitee %s 时检查备用源，镜像滞后不会漏掉GitHub新版', async mode => {
    const fetcher = vi.fn();
    if (mode === 'network') fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else if (mode === 'empty') fetcher.mockResolvedValueOnce(response([]));
    else fetcher.mockResolvedValueOnce(response(giteeList)).mockResolvedValueOnce(response({ ...manifest, versionCode: buildUpdateInfo().versionCode }));
    fetcher.mockResolvedValueOnce(response(githubList)).mockResolvedValueOnce(response(manifest)); vi.stubGlobal('fetch', fetcher);
    const result = await checkAppUpdate(); expect(result.status).toBe('available'); expect(result.release?.source).toBe('github'); expect(result.message).toContain('备用源');
  });
  it('镜像元数据损坏不静默切换，备用源失败也不能伪装成全部检查成功', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(giteeList)).mockResolvedValueOnce(response({ ...manifest, sha256: 'bad' })); vi.stubGlobal('fetch', fetcher);
    await expect(checkAppUpdate()).rejects.toThrow('Gitee更新文件无效'); expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset().mockResolvedValueOnce(response(giteeList)).mockResolvedValueOnce(response({ ...manifest, versionCode: buildUpdateInfo().versionCode })).mockRejectedValueOnce(new Error());
    const result = await checkAppUpdate(); expect(result.status).toBe('partial'); expect(result.message).toContain('备用源未完成检查');
    fetcher.mockReset().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(response([])); await expect(checkAppUpdate()).rejects.toThrow('尚无法确认更新');
  });
  it('保留旧仓库、自定义仓库不自动指向官方镜像，两个源可独立保存和停用', async () => {
    expect(buildUpdateInfo().giteeRepository).toBe('anxiu29/shike');
    localStorage.setItem('shike-update-repository-v1', 'team/custom'); expect(buildUpdateInfo().giteeRepository).toBe('');
    await setUpdateRepository('team/custom', 'https://gitee.com/team_cn/app.git'); expect(buildUpdateInfo()).toMatchObject({ repository: 'team/custom', giteeRepository: 'team_cn/app' });
    await setUpdateRepository('team/custom', ''); expect(buildUpdateInfo().giteeRepository).toBe('');
    await expect(setUpdateRepository('Anxiu29/shike', 'https://token@gitee.com/a/b')).rejects.toThrow();
  });
  it('匿名GitHub额度耗尽与Token失效区分；只检查到旧镜像时不宣称最新', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(giteeList)).mockResolvedValueOnce(response({ ...manifest, versionCode: buildUpdateInfo().versionCode }))
      .mockResolvedValueOnce(new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })); vi.stubGlobal('fetch', fetcher);
    const result = await checkAppUpdate(); expect(result.status).toBe('partial'); expect(result.message).toContain('公开接口请求额度已用完'); expect(result.message).toContain('无需Token');
  });
  it('原生下载与安装不接受网页提供的APK地址或版本，安装窗口打开不等于更新完成', async () => {
    mock.native = true;
    const current = { ...buildUpdateInfo(), sdk: 36, readyVersionCode: 0 };
    mock.bridge.check.mockResolvedValue({ current, status: 'available', release: { manifest, apkUrl: prefix + 'shike.apk', releaseUrl: 'https://github.com/Anxiu29/shike/releases/tag/v-next' } });
    expect((await checkAppUpdate()).status).toBe('available'); await downloadAppUpdate();
    expect(mock.bridge.download).toHaveBeenCalledWith();
    mock.bridge.install.mockResolvedValue({ status: 'permission_required' }); expect(await installAppUpdate()).toEqual({ status: 'permission_required' });
    mock.bridge.install.mockResolvedValue({ status: 'installer_opened' }); expect(await installAppUpdate()).toEqual({ status: 'installer_opened' });
    expect(mock.bridge.install).toHaveBeenCalledWith();
  });
});
