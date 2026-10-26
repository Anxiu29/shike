import { test, expect, type Page } from '@playwright/test';
import { routeApkAssets } from './helpers/apk-assets';
import { openManualMeal } from './helpers/manual-food';
import appRelease from '../../config/app-release.json' with { type: 'json' };

test.beforeEach(async ({ page }) => { await routeApkAssets(page); });
async function tab(page: Page, name: 'settings' | 'diary') { const button = page.getByTestId(`tab-${name}`); await (await button.isVisible() ? button : page.getByTestId(`desktop-tab-${name}`)).click(); }
async function nativeUpdater(page: Page) {
  await page.addInitScript(({ code, name }) => {
    const w = window as any, listeners = new Map<string, { event: string; callback: (data: unknown) => void }>(); let listenerId = 0;
    const state = { appId: 'cn.anxiu29.shike', versionCode: code, versionName: name, repository: 'Anxiu29/shike', giteeRepository: 'anxiu29/shike', sdk: 36, readyVersionCode: 0 };
    const manifest = { schemaVersion: 1, appId: state.appId, versionCode: code + 1, versionName: '0.12.0-test', releasedAt: '2026-10-24T05:00:00.000Z', minSdk: 24, bytes: 10485760, sha256: 'a'.repeat(64), notes: ['新增测试更新流程', '保留原有饮食记录'] };
    w.androidBridge = {}; w.__updateCalls = []; w.__updateMode = 'available'; w.__installPermission = false;
    w.__emitUpdate = (value: unknown) => { for (const listener of listeners.values()) if (listener.event === 'downloadProgress') listener.callback(value); };
    w.Capacitor = { PluginHeaders: [{ name: 'AppUpdater', methods: [{ name: 'addListener', rtype: 'callback' }, ...['getInfo', 'setRepository', 'check', 'download', 'cancelDownload', 'install', 'removeListener'].map(name => ({ name, rtype: 'promise' }))] }],
      nativeCallback: (_plugin: string, method: string, input: any, callback: (data: unknown) => void) => { if (method !== 'addListener') throw Error('Unexpected callback'); const id = String(++listenerId); listeners.set(id, { event: input.eventName, callback }); return id; },
      nativePromise: async (_plugin: string, method: string, input: any) => {
        w.__updateCalls.push({ method });
        if (method === 'getInfo') return structuredClone(state);
        if (method === 'setRepository') { state.repository = input.repository; state.giteeRepository = input.giteeRepository; state.readyVersionCode = 0; return structuredClone(state); }
        if (method === 'removeListener') { listeners.delete(input.callbackId); return {}; }
        if (method === 'check') {
          if (w.__updateMode === 'error') throw new Error('GitHub仓库或更新文件不存在、尚未公开，请检查仓库与发行版设置。');
          return { current: structuredClone(state), status: w.__updateMode, release: w.__updateMode === 'no_release' ? null : { manifest: { ...manifest, versionCode: w.__updateMode === 'current' ? code : code + 1 }, source: 'gitee', apkUrl: `https://gitee.com/${state.giteeRepository}/releases/download/v-next/shike.apk`, releaseUrl: `https://gitee.com/${state.giteeRepository}/releases/tag/v-next` } };
        }
        if (method === 'download') {
          if (w.__downloadError) throw new Error(w.__downloadError);
          return new Promise((resolve, reject) => { w.__cancelDownload = () => reject(new Error('下载已取消。')); w.__finishDownload = () => { state.readyVersionCode = code + 1; resolve(structuredClone(state)); }; });
        }
        if (method === 'cancelDownload') { w.__cancelDownload?.(); return {}; }
        if (method === 'install') { if (!w.__installPermission) { w.__installPermission = true; return { status: 'permission_required' }; } return { status: 'installer_opened' }; }
        throw new Error('Unexpected method');
      },
    };
  }, { code: appRelease.versionCode, name: appRelease.versionName });
}

test('安卓检查更新、下载进度、安装授权和系统确认，不把打开安装器标为安装完成', async ({ page }, info) => {
  await nativeUpdater(page); await page.goto('/'); await tab(page, 'settings');
  await expect(page.getByTestId('app-current-version')).toHaveText(appRelease.versionName);
  await expect(page.getByTestId('app-update-priority')).toContainText('Gitee 国内源优先');
  expect(await page.evaluate(() => (window as any).__updateCalls.filter((call: any) => call.method !== 'getInfo'))).toEqual([]);
  await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-release')).toContainText('0.12.0-test');
  await expect(page.getByTestId('app-update-selected-source')).toHaveText('Gitee 国内源');
  await page.getByTestId('download-app-update').click(); await expect.poll(() => page.evaluate(() => typeof (window as any).__finishDownload)).toBe('function');
  await page.evaluate(() => (window as any).__emitUpdate({ phase: 'downloading', percent: 42, received: 4404019, total: 10485760 }));
  await expect(page.getByTestId('app-update-progress')).toContainText('42%'); await expect(page.getByTestId('install-app-update')).toHaveCount(0);
  await page.evaluate(() => (window as any).__emitUpdate({ phase: 'verifying', percent: 99, received: 10485760, total: 10485760 }));
  await expect(page.getByTestId('app-update-progress')).toContainText('正在校验'); await page.evaluate(() => (window as any).__finishDownload());
  await expect(page.getByTestId('install-app-update')).toBeEnabled(); await page.getByTestId('install-app-update').click();
  await expect(page.getByTestId('app-update-message')).toContainText('允许食刻安装更新');
  await page.getByTestId('install-app-update').click(); await expect(page.getByTestId('app-update-message')).toContainText('已打开系统安装界面');
  await expect(page.getByTestId('app-current-version')).toHaveText(appRelease.versionName);
  for (const width of [320, 390, 820, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); const button = page.getByTestId('install-app-update'); await button.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); expect(await button.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true); }
  if (info.project.name === 'Chrome 手机') { await page.setViewportSize({ width: 390, height: 844 }); await page.getByTestId('app-update-card').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' })); await page.getByTestId('app-update-card').screenshot({ path: 'docs/screenshots/app-update-mobile.png' }); }
});

test('取消下载与签名失败均不可进入安装，原有饮食记录仍能恢复', async ({ page }) => {
  await nativeUpdater(page); await page.goto('/'); await openManualMeal(page, '更新前餐食'); await page.getByTestId('food-weight-0').fill('150'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings'); await page.getByTestId('check-app-update').click(); await page.getByTestId('download-app-update').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__cancelDownload)).toBe('function'); await page.getByTestId('cancel-app-update').click();
  await expect(page.getByTestId('app-update-message')).toContainText('下载已取消'); await expect(page.getByTestId('install-app-update')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__downloadError = '安装包签名与当前食刻不一致，已停止安装。'; }); await page.getByTestId('download-app-update').click();
  await expect(page.getByTestId('app-update-error')).toContainText('签名'); await expect(page.getByTestId('install-app-update')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__updateCalls.filter((call: any) => call.method === 'install'))).toEqual([]);
  await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('更新前餐食');
});

test('更新仓库可保存，404、未发布更新文件和当前版本分别显示，切换仓库不主动下载', async ({ page }) => {
  await nativeUpdater(page); await page.goto('/'); await tab(page, 'settings');
  await page.getByTestId('app-update-source').locator('summary').click(); await page.getByTestId('update-repository').fill('https://github.com/team/public-app'); await page.getByTestId('save-update-repository').click();
  await page.getByTestId('update-gitee-repository').fill('https://gitee.com/team_cn/public-app'); await page.getByTestId('save-update-repository').click();
  await expect(page.getByTestId('update-gitee-repository')).toHaveValue('team_cn/public-app');
  await expect(page.getByTestId('update-repository')).toHaveValue('team/public-app');
  await page.evaluate(() => { (window as any).__updateMode = 'error'; }); await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-error')).toContainText('尚未公开'); await expect(page.getByTestId('app-update-status')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__updateMode = 'no_release'; }); await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-status')).toContainText('暂未发现');
  await page.evaluate(() => { (window as any).__updateMode = 'current'; }); await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-status')).toContainText('当前已是');
  await page.getByTestId('update-repository').fill('https://secret@github.com/a/b'); await page.getByTestId('save-update-repository').click(); await expect(page.getByTestId('app-update-error')).toContainText('用户名/仓库名');
  expect(await page.evaluate(() => (window as any).__updateCalls.filter((call: any) => call.method === 'download'))).toEqual([]);
});

test('网页版仅在点击时读取公开更新，显示说明及APK链接且没有原生安装按钮', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shike-update-gitee-repository-v1', ''));
  const prefix = 'https://github.com/Anxiu29/shike/releases/download/v-next/', requests: string[] = [];
  await page.route('https://api.github.com/repos/Anxiu29/shike/releases?per_page=10', route => { requests.push(route.request().url()); return route.fulfill({ json: [{ draft: false, prerelease: true, published_at: '2026-10-24T05:00:00.000Z', assets: [{ name: 'shike.apk', size: 2048, browser_download_url: prefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: prefix + 'shike-update.json' }] }] }); });
  await page.route(prefix + 'shike-update.json', route => { requests.push(route.request().url()); return route.fulfill({ json: { schemaVersion: 1, appId: 'cn.anxiu29.shike', versionCode: appRelease.versionCode + 1, versionName: '0.12.0-test', releasedAt: '2026-10-24T05:00:00.000Z', minSdk: 24, bytes: 2048, sha256: 'a'.repeat(64), notes: ['公开发行版说明'] } }); });
  await page.goto('/'); await tab(page, 'settings'); expect(requests).toEqual([]);
  await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-release')).toContainText('公开发行版说明'); await expect(page.getByTestId('download-apk-link')).toHaveAttribute('href', prefix + 'shike.apk'); await expect(page.getByTestId('install-app-update')).toHaveCount(0); expect(requests).toHaveLength(2);
});

test('网页版Gitee优先且失败回退GitHub，显示实际来源，进入设置不联网', async ({ page }) => {
  const calls: string[] = [], giteePrefix = 'https://gitee.com/anxiu29/shike/releases/download/v-next/', githubPrefix = 'https://github.com/Anxiu29/shike/releases/download/v-next/';
  let unavailable = false;
  const manifest = { schemaVersion: 1, appId: 'cn.anxiu29.shike', versionCode: appRelease.versionCode + 1, versionName: '0.12.0-test', releasedAt: '2026-10-24T05:00:00.000Z', minSdk: 24, bytes: 2048, sha256: 'a'.repeat(64), notes: ['国内更新源测试'] };
  await page.route('**/api/app-updates/gitee?**', route => {
    calls.push(route.request().url());
    if (unavailable) return route.fulfill({ status: 502, json: { error: { code: 'UPDATE_SOURCE_UNAVAILABLE', message: 'Gitee暂不可达' } } });
    const tag = new URL(route.request().url()).searchParams.get('tag');
    const release = { id: 2, tag_name: 'v-next', created_at: manifest.releasedAt, assets: [{ name: 'shike.apk', browser_download_url: giteePrefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: giteePrefix + 'shike-update.json' }] };
    return route.fulfill({ json: tag ? { ...manifest, versionCode: tag === 'v-old' ? appRelease.versionCode : manifest.versionCode } : [{ ...release, id: 1, tag_name: 'v-old', created_at: '2026-10-23T05:00:00.000Z', assets: release.assets.map(asset => ({ ...asset, browser_download_url: asset.browser_download_url.replace('v-next', 'v-old') })) }, release] });
  });
  await page.route('https://api.github.com/repos/Anxiu29/shike/releases?per_page=10', route => { calls.push(route.request().url()); return route.fulfill({ json: [{ draft: false, published_at: manifest.releasedAt, assets: [{ name: 'shike.apk', size: 2048, browser_download_url: githubPrefix + 'shike.apk' }, { name: 'shike-update.json', browser_download_url: githubPrefix + 'shike-update.json' }] }] }); });
  await page.route(githubPrefix + 'shike-update.json', route => { calls.push(route.request().url()); return route.fulfill({ json: manifest }); });
  await page.goto('/'); await tab(page, 'settings'); expect(calls).toEqual([]);
  await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-selected-source')).toHaveText('Gitee 国内源'); await expect(page.getByTestId('download-apk-link')).toHaveAttribute('href', giteePrefix + 'shike.apk'); expect(calls).toHaveLength(2);
  unavailable = true; await page.getByTestId('check-app-update').click(); await expect(page.getByTestId('app-update-selected-source')).toHaveText('GitHub 备用源'); await expect(page.getByTestId('download-apk-link')).toHaveAttribute('href', githubPrefix + 'shike.apk'); await expect(page.getByTestId('app-update-message')).toContainText('备用源'); expect(calls).toHaveLength(5);
});
