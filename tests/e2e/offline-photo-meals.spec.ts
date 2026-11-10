import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';

async function setup(page: Page, enabled = true) {
  await routeApkAssets(page);
  const jpeg = (await sharp({ create: { width: 900, height: 600, channels: 3, background: '#e0edc5' } }).jpeg().toBuffer()).toString('base64');
  await page.addInitScript(({ jpeg, enabled }) => {
    const w = window as any; w.androidBridge = {}; w.__offlinePhotoCalls = []; w.__cloudPhotoCalls = 0; w.__photoStops = 0;
    localStorage.setItem('shike-offline-photo-v1', JSON.stringify({ enabled, estimateWeights: false }));
    const state = { ready: true, busy: false, loaded: false, stage: 'ready', error: '', stopReason: '', text: '', bytes: 1303671472, downloadedBytes: 0, device: 'OPPO PLJ110（模拟桥）', availableMemoryBytes: 5_000_000_000 };
    w.Capacitor = { PluginHeaders: [
      { name: 'OfflineVision', methods: ['getState', 'generateImage', 'cancel', 'unload', 'downloadModel', 'importModel', 'deleteModel'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'PersonalVision', methods: ['getState', 'recognize', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'SystemPhoto', methods: [{ name: 'capture', rtype: 'promise' }] },
    ], nativePromise: async (plugin: string, method: string, options: any) => {
      if (plugin === 'PersonalVision') {
        if (method === 'getState') return { profiles: [], activeId: null };
        w.__cloudPhotoCalls++; throw Error('不可自动发送云端');
      }
      if (plugin === 'SystemPhoto') return w.__cameraCancelled ? { cancelled: true } : { cancelled: false, jpegBase64: jpeg };
      if (plugin !== 'OfflineVision') return {};
      if (method === 'getState') return { ...state, ready: !w.__missingVision };
      if (method === 'cancel') { w.__photoStops++; Object.assign(state, { busy: false, stage: 'stopped' }); return {}; }
      if (method === 'generateImage') {
        w.__offlinePhotoCalls.push(structuredClone(options)); Object.assign(state, { busy: true, stage: 'loading', error: '', stopReason: '', text: '' });
        if (w.__holdVision) return {};
        if (w.__limitedVision) { Object.assign(state, { busy: false, stage: 'limited', stopReason: 'repetition', error: '检测到循环重复，已停止。' }); return {}; }
        Object.assign(state, { busy: false, stage: 'completed', text: w.__photoText ?? '1. 米饭\n2. 鸡蛋\n3. 西兰花' });
      }
      return {};
    } };
  }, { jpeg, enabled });
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  return Buffer.from(jpeg, 'base64');
}

test('设置启用后直接拍照在本机生成清单；不估重量，核对后保存照片并刷新恢复', async ({ page }) => {
  const posts: string[] = []; page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await setup(page, false);
  await page.locator('[data-testid="tab-settings"]:visible, [data-testid="desktop-tab-settings"]:visible').click();
  await page.getByTestId('settings-open-offline-vision').click(); await page.getByTestId('vision-use-for-meals').click();
  await expect(page.getByTestId('vision-use-for-meals')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__offlinePhotoCalls.length)).toBe(0);
  await page.getByTestId('settings-detail').getByTestId('close-sheet').click();
  await page.locator('[data-testid="tab-diary"]:visible, [data-testid="desktop-tab-diary"]:visible').click();
  await page.getByTestId('photo-lunch').click();
  await expect(page.getByTestId('recognition-summary')).toContainText('本机离线识图');
  await expect(page.getByTestId('editor-meal-type')).toHaveValue('lunch');
  await expect(page.getByTestId('food-weight-0')).toHaveValue(''); await expect(page.getByTestId('food-weight-1')).toHaveValue('');
  await expect(page.getByTestId('recognition-summary')).toContainText('重量与份量待填写');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__offlinePhotoCalls);
  expect(calls).toHaveLength(1); expect(calls[0].namesOnly).toBe(true);
  const metadata = await sharp(Buffer.from(calls[0].imageBase64, 'base64')).metadata(); expect([metadata.width, metadata.height]).toEqual([512, 512]); expect(metadata.exif).toBeUndefined();
  await page.getByTestId('food-weight-0').fill('150'); await page.getByTestId('food-weight-1').fill('100'); await page.getByTestId('food-weight-2').fill('80');
  await expect(page.getByTestId('recognition-summary')).toContainText('已填 3/3 项份量');
  for (const width of [320, 390, 820, 1440]) { await page.setViewportSize({ width, height: 700 }); expect(await page.getByTestId('food-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); }
  if (test.info().project.name === 'Chrome 手机') { await page.setViewportSize({ width: 390, height: 844 }); await page.getByTestId('recognition-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/android/offline-photo-meals-mobile.png' }); }
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await expect(page.getByTestId('view-meal-photo')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0); expect(posts).toEqual([]);
});

test('模型缺失不上传、不回退；保留照片且可选图重试', async ({ page }) => {
  const jpeg = await setup(page); await page.evaluate(() => { (window as any).__missingVision = true; });
  await page.getByTestId('photo-lunch').click(); await expect(page.getByTestId('editor-error')).toContainText('下载或导入');
  await expect(page.getByTestId('enlarge-photo')).toBeVisible(); await expect(page.getByTestId('meal-record')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__offlinePhotoCalls.length)).toBe(0);
  await page.evaluate(() => { (window as any).__missingVision = false; });
  await page.getByTestId('gallery-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByTestId('recognition-summary')).toContainText('3 项食物');
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0);
});

test('循环、坏清单和停止均保留已核对草稿，重试仍只走本机', async ({ page }) => {
  const jpeg = await setup(page); await page.getByTestId('photo-lunch').click();
  await expect(page.getByTestId('food-weight-0')).toBeVisible(); await page.getByTestId('food-weight-0').fill('170');
  page.on('dialog', dialog => dialog.accept());
  for (const condition of ['limited', 'invalid', 'hold']) {
    await page.evaluate(condition => { const w = window as any; w.__limitedVision = condition === 'limited'; w.__photoText = condition === 'invalid' ? '米饭\n米饭' : undefined; w.__holdVision = condition === 'hold'; }, condition);
    await page.getByTestId('gallery-input').setInputFiles({ name: `${condition}.jpg`, mimeType: 'image/jpeg', buffer: jpeg });
    if (condition === 'hold') { await expect(page.getByTestId('photo-recognition-progress')).toContainText('本机识图'); await page.getByTestId('offline-photo-stop').click(); }
    await expect(page.getByTestId('editor-error')).toContainText(condition === 'limited' ? '循环' : condition === 'invalid' ? '重复食物' : '停止');
    await expect(page.getByTestId('food-weight-0')).toHaveValue('170'); await expect(page.getByTestId('enlarge-photo')).toBeVisible();
  }
  expect(await page.evaluate(() => (window as any).__photoStops)).toBe(1);
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0); await expect(page.getByTestId('meal-record')).toHaveCount(0);
});

test('营养表可选本机试读，明确选择在线才切换路由', async ({ page }) => {
  await setup(page); await page.evaluate(() => { (window as any).__cameraCancelled = true; });
  await page.getByTestId('photo-lunch').click(); await page.getByTestId('system-photo-kind').selectOption('label');
  await expect(page.getByTestId('photo-offline-note')).toContainText('本机营养表识读');
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0); expect(await page.evaluate(() => (window as any).__offlinePhotoCalls.length)).toBe(0);
  await page.getByTestId('photo-ai-route').selectOption('online'); await expect(page.getByTestId('recognition-model-picker')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shike-offline-photo-v1')!).enabled)).toBe(false);
});

test('非食物回答不生成默认餐食，选择离线方式刷新仍保留', async ({ page }) => {
  await setup(page); await page.evaluate(() => { (window as any).__photoText = '未识别到食物。'; });
  await page.getByTestId('photo-lunch').click(); await expect(page.getByTestId('food-editor')).toContainText('没有可靠识别到食物');
  await expect(page.locator('[data-testid^="food-item-"]')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.reload(); await page.getByTestId('photo-lunch').click(); await expect(page.getByTestId('photo-ai-route')).toHaveValue('offline');
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0);
});
