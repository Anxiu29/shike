import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';

async function setup(page: Page) {
  await routeApkAssets(page);
  const jpeg = (await sharp({ create: { width: 900, height: 600, channels: 3, background: '#d6e6b7' } }).jpeg().toBuffer()).toString('base64');
  await page.addInitScript(jpeg => {
    const w = window as any; w.androidBridge = {}; w.__visionRuns = []; w.__cloudVisionCalls = 0; w.__textModelDeleted = false;
    const state = { stage: 'idle', busy: false, ready: false, loaded: false, backend: '', bytes: 1303671472, downloadedBytes: 0, progressBytes: 0, error: '', stopReason: '', text: '', loadMs: -1, firstTextMs: -1, responseMs: -1, characters: 0, availableMemoryBytes: 4_000_000_000, totalMemoryBytes: 16_000_000_000, device: 'OPPO PLJ110（模拟桥）' };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { w.__visionReport = text; } } });
    w.Capacitor = { PluginHeaders: [
      { name: 'OfflineVision', methods: ['getState', 'downloadModel', 'importModel', 'generateImage', 'cancel', 'unload', 'deleteModel'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'OfflineAi', methods: ['getState', 'deleteModel'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'SystemPhoto', methods: [{ name: 'capture', rtype: 'promise' }] },
      { name: 'PersonalVision', methods: ['getState', 'recognize', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) },
    ], nativePromise: async (plugin: string, method: string, options: any) => {
      if (plugin === 'PersonalVision') {
        if (method === 'getState') return { profiles: [], activeId: null };
        w.__cloudVisionCalls++; throw Error('离线识图不可自动转云端');
      }
      if (plugin === 'OfflineAi') { if (method === 'deleteModel') w.__textModelDeleted = true; return { ...state, ready: true, bytes: 1597922856 }; }
      if (plugin === 'SystemPhoto') return w.__cameraCancelled ? { cancelled: true } : { cancelled: false, jpegBase64: jpeg };
      if (plugin !== 'OfflineVision') return {};
      if (method === 'getState') return structuredClone(state);
      if (method === 'downloadModel' || method === 'importModel') { Object.assign(state, { stage: 'ready', ready: true, downloadedBytes: 0 }); return {}; }
      if (method === 'deleteModel') { Object.assign(state, { stage: 'idle', ready: false }); return {}; }
      if (method === 'unload') { state.loaded = false; return {}; }
      if (method === 'cancel') { Object.assign(state, { busy: false, stage: 'stopped' }); return {}; }
      if (method === 'generateImage') {
        w.__visionRuns.push(structuredClone(options));
        Object.assign(state, { busy: true, stage: 'loading', text: '', error: '', stopReason: '' });
        if (w.__holdVision) return {};
        if (w.__failVision) { Object.assign(state, { busy: false, stage: 'error', error: 'CPU图像编码未完成，请重试。' }); return {}; }
        if (w.__repeatVision || w.__longVision) {
          const repeated = !!w.__repeatVision;
          const text = repeated ? '1. 蔬菜\n2. 蔬菜\n3. 蔬菜\n4. 蔬菜' : '1. 米饭\n2. 西兰花\n3. 鸡肉\n4. 土豆\n5. 红辣椒\n6. 蒜\n7. 葱花';
          Object.assign(state, { busy: false, stage: 'limited', text, stopReason: repeated ? 'repetition' : 'list_limit', error: repeated ? '检测到循环重复，已停止生成。以下为停止前的原始片段，不能作为完整识别结果。' : '清单超过6项，已停止生成。回答可能含推测内容，请核对后重新选图或简化问题。', characters: text.length, loadMs: 1500, firstTextMs: 500, responseMs: 2000 }); return {};
        }
        const text = '模拟识图：鸡蛋2个，米饭1碗。牛奶无法确认。';
        Object.assign(state, { busy: false, stage: 'completed', loaded: false, text, loadMs: 1500, firstTextMs: 500, responseMs: 2000, characters: text.length });
      }
      return {};
    } };
  }, jpeg);
  await page.goto('/');
  await page.locator('[data-testid="tab-settings"]:visible, [data-testid="desktop-tab-settings"]:visible').click();
  await page.getByTestId('settings-open-offline-vision').click();
  await expect(page.getByTestId('offline-vision-test')).toBeVisible();
  return Buffer.from(jpeg, 'base64');
}

test('单独下载视觉模型，无Key选图后仅本机识图，照片512方图且结果不写餐食', async ({ page }) => {
  const posts: string[] = []; page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  const jpeg = await setup(page);
  await expect(page.getByTestId('vision-generate')).toBeDisabled();
  await page.getByTestId('vision-download').click(); await expect(page.getByTestId('vision-download')).toContainText('已保存');
  await page.getByTestId('vision-image-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByTestId('vision-preview')).toBeVisible();
  expect(await page.getByTestId('vision-preview').evaluate(img => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight])).toEqual([512, 512]);
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.getByTestId('offline-vision-test').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.getByTestId('vision-generate').click(); await expect(page.getByTestId('vision-answer')).toContainText('模拟识图');
  const calls = await page.evaluate(() => (window as any).__visionRuns);
  expect(calls).toHaveLength(1); expect(calls[0].imageBase64).not.toContain('data:');
  expect(calls[0].prompt).toContain('不猜重量和热量');
  await page.getByTestId('vision-copy').click();
  const report = await page.evaluate(() => (window as any).__visionReport);
  expect(report).toContain('CPU / 图像CPU'); expect(report).not.toContain(calls[0].imageBase64); expect(report).not.toContain('模拟识图：');
  expect(await page.evaluate(() => (window as any).__cloudVisionCalls)).toBe(0); expect(posts).toEqual([]);
  if (test.info().project.name === 'Chrome 手机') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('vision-download').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/android/offline-vision-mobile.png' });
    await page.getByTestId('vision-answer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/android/offline-vision-result-mobile.png' });
  }
  await page.getByTestId('settings-detail').getByTestId('close-sheet').click();
  await page.locator('[data-testid="tab-diary"]:visible, [data-testid="desktop-tab-diary"]:visible').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
});

test('失败与停止不走云端，照片保留；重新选图不显示上次回答', async ({ page }) => {
  const jpeg = await setup(page); await page.getByTestId('vision-import').click();
  await page.getByTestId('vision-image-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.evaluate(() => { (window as any).__failVision = true; });
  await page.getByTestId('vision-generate').click(); await expect(page.getByTestId('vision-error')).toContainText('CPU图像编码');
  await expect(page.getByTestId('vision-preview')).toBeVisible();
  await page.evaluate(() => { (window as any).__failVision = false; (window as any).__holdVision = true; });
  await page.getByTestId('vision-generate').click(); await page.getByTestId('vision-stop').click();
  await expect(page.getByTestId('vision-status')).toContainText('停止'); await expect(page.getByTestId('vision-preview')).toBeVisible();
  await page.evaluate(() => { (window as any).__holdVision = false; });
  await page.getByTestId('vision-generate').click(); await expect(page.getByTestId('vision-answer')).toBeVisible();
  await page.getByTestId('vision-image-input').setInputFiles({ name: 'another.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByTestId('vision-answer')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__cloudVisionCalls)).toBe(0);
});

test('系统相机取消不丢已选图，删除只作用视觉模型', async ({ page }) => {
  await setup(page); await page.getByTestId('vision-download').click();
  await page.getByTestId('vision-photo').click(); await expect(page.getByTestId('vision-preview')).toBeVisible();
  const source = await page.getByTestId('vision-preview').getAttribute('src');
  await page.evaluate(() => { (window as any).__cameraCancelled = true; });
  await page.getByTestId('vision-photo').click(); await expect(page.getByTestId('vision-photo')).toBeEnabled();
  await expect(page.getByTestId('vision-preview')).toHaveAttribute('src', source!);
  page.once('dialog', dialog => dialog.accept()); await page.getByTestId('vision-delete').click();
  await expect(page.getByTestId('vision-download')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__textModelDeleted)).toBe(false);
});

test('重复和过长输出明确标异常且保留原文，重新测试清除旧提示，不自动记餐或上云', async ({ page }) => {
  const jpeg = await setup(page); await page.getByTestId('vision-download').click();
  await page.getByTestId('vision-image-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  for (const reason of ['repetition', 'list_limit']) {
    await page.evaluate(reason => { (window as any).__repeatVision = reason === 'repetition'; (window as any).__longVision = reason === 'list_limit'; }, reason);
    await page.getByTestId('vision-generate').click();
    await expect(page.getByTestId('vision-status')).toContainText('异常输出');
    await expect(page.getByTestId('vision-error')).toContainText(reason === 'repetition' ? '循环重复' : '超过6项');
    if (reason === 'repetition') expect((await page.getByTestId('vision-answer').innerText()).match(/蔬菜/g)).toHaveLength(4);
    else await expect(page.getByTestId('vision-answer')).toContainText('7. 葱花');
    await expect(page.getByTestId('vision-generate')).toBeEnabled();
    await page.getByTestId('vision-copy').click();
    const report = await page.evaluate(() => (window as any).__visionReport);
    expect(report).toContain(`停止原因：${reason}`); expect(report).toContain('最多128token'); expect(report).not.toContain('7. 葱花');
  }
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'artifacts/android/offline-vision-limit-mobile.png' });
  await page.evaluate(() => { (window as any).__repeatVision = false; (window as any).__longVision = false; });
  await page.getByTestId('vision-generate').click();
  await expect(page.getByTestId('vision-error')).toHaveCount(0);
  await expect(page.getByTestId('vision-status')).toContainText('请核对识别内容');
  await expect(page.getByTestId('vision-answer')).toContainText('模拟识图');
  expect(await page.evaluate(() => (window as any).__cloudVisionCalls)).toBe(0);
});
