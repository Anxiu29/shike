import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';
import { barcodeImage } from './helpers/barcode-image';
test.use({ timezoneId: 'Asia/Shanghai' });

async function setup(page: Page) {
  await routeApkAssets(page);
  const jpeg = (await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#e9eedc' } }).jpeg().toBuffer()).toString('base64');
  await page.addInitScript(jpeg => {
    const w = window as any, id = '11111111-1111-4111-8111-111111111111';
    w.androidBridge = {}; w.__systemPhotos = 0; w.__webCameras = 0; w.__visionCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { w.__webCameras++; throw Error('系统相机版不应访问摄像头'); };
    w.Capacitor = { PluginHeaders: [
      { name: 'SystemPhoto', methods: [{ name: 'capture', rtype: 'promise' }] },
      { name: 'FoodCatalog', methods: [{ name: 'lookup', rtype: 'promise' }] },
      { name: 'PersonalVision', methods: ['getState', 'recognize'].map(name => ({ name, rtype: 'promise' })) },
    ], nativePromise: async (plugin: string, method: string) => {
      if (plugin === 'SystemPhoto') {
        w.__systemPhotos++;
        if (w.__holdSystemPhoto) await new Promise<void>(resolve => { w.__releaseSystemPhoto = resolve; });
        if (w.__systemPhotoError) throw Error(w.__systemPhotoError);
        return w.__systemPhotoResult ?? { cancelled: false, jpegBase64: jpeg };
      }
      if (plugin === 'FoodCatalog') return { data: JSON.stringify({ status: 0 }) };
      if (plugin === 'PersonalVision' && method === 'getState') return { activeId: id, profiles: [{ id, label: '模拟在线配置', provider: 'qwen', model: 'qwen3.7-flash' }] };
      if (plugin === 'PersonalVision' && method === 'recognize') {
        w.__visionCalls++;
        return { provider: 'qwen', model: 'qwen3.7-flash', data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] }) } }] }) };
      }
      return {};
    } };
  }, jpeg);
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  return Buffer.from(jpeg, 'base64');
}

test('首页不启用相机；系统拍照返回后保留餐次、识别核对保存及照片刷新', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__systemPhotoResult = { cancelled: true }; });
  expect(await page.evaluate(() => (window as any).__systemPhotos)).toBe(0);
  await page.getByTestId('photo-lunch').click(); await expect(page.getByTestId('system-capture')).toBeVisible();
  await expect(page.getByTestId('capture-camera')).toHaveCount(0);
  await expect(page.getByTestId('system-photo-meal')).toHaveValue('lunch');
  await page.getByTestId('system-photo-meal').selectOption('dinner');
  await expect(page.getByTestId('system-photo-privacy')).toContainText('不申请相机权限');
  await expect(page.getByTestId('system-photo-take')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__systemPhotos)).toBe(1);
  await page.evaluate(() => { (window as any).__systemPhotoResult = undefined; });
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.getByTestId('system-capture').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.getByTestId('system-photo-take')).toBeInViewport();
  }
  if (test.info().project.name === 'Chrome 手机') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('system-capture').screenshot({ path: 'artifacts/android/system-camera-mobile.png' });
  }
  await page.getByTestId('system-photo-take').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('editor-meal-type')).toHaveValue('dinner');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__webCameras)).toBe(0);
});

test('取消和拍摄失败不建记录，仍能选照片；营养表未读清不编造标签', async ({ page }) => {
  const jpeg = await setup(page);
  await page.evaluate(() => { (window as any).__systemPhotoResult = { cancelled: true }; });
  await page.getByTestId('hero-camera').click(); await page.getByTestId('system-photo-kind').selectOption('label');
  await page.evaluate(() => { (window as any).__systemPhotoResult = { cancelled: true }; });
  await page.getByTestId('system-photo-take').click(); await expect(page.getByTestId('system-photo-take')).toBeEnabled();
  await expect(page.getByTestId('system-capture')).toBeVisible(); await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await expect(page.getByTestId('system-photo-kind')).toHaveValue('label');
  await page.evaluate(() => { (window as any).__systemPhotoError = '没有找到系统相机，请选择已有照片。'; });
  await page.getByTestId('system-photo-take').click(); await expect(page.getByTestId('system-photo-error')).toContainText('选择已有照片');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.getByTestId('system-photo-gallery-input').setInputFiles({ name: 'label.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByTestId('editor-error')).toContainText('没有读清包装营养表');
  expect(await page.evaluate(() => (window as any).__webCameras)).toBe(0);
});

test('文字助手拍照只附图，取消保留文字，不自动发送给模型', async ({ page }) => {
  await setup(page); await page.getByTestId('assistant-open').click(); await page.getByTestId('assistant-input').fill('请看这张午餐照片');
  await page.evaluate(() => { (window as any).__systemPhotoResult = { cancelled: true }; });
  await page.getByTestId('assistant-take-photo').click(); await expect(page.getByTestId('assistant-take-photo')).toBeEnabled();
  await expect(page.getByTestId('assistant-input')).toHaveValue('请看这张午餐照片'); await expect(page.getByTestId('assistant-attachment')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__systemPhotoResult = undefined; });
  await page.getByTestId('assistant-take-photo').click(); await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await expect(page.getByTestId('assistant-input')).toHaveValue('请看这张午餐照片');
  expect(await page.evaluate(() => (window as any).__visionCalls)).toBe(0);
  expect(await page.evaluate(() => (window as any).__webCameras)).toBe(0);
});

test('条码照片在本机读码只查询数字，手输可用且不调用视觉模型', async ({ page }) => {
  await setup(page); await page.evaluate(() => { (window as any).__systemPhotoResult = { cancelled: true }; });
  await page.getByTestId('photo-breakfast').click(); await page.getByTestId('system-photo-kind').selectOption('barcode');
  await page.getByTestId('system-photo-gallery-input').setInputFiles({ name: 'barcode.png', mimeType: 'image/png', buffer: await barcodeImage('3274080005003') });
  await expect(page.getByTestId('catalog-barcode')).toHaveValue('3274080005003');
  await expect(page.getByTestId('catalog-message')).toContainText('尚未收录');
  expect(await page.evaluate(() => (window as any).__visionCalls)).toBe(0);
  await page.evaluate(() => { (window as any).__systemPhotoResult = undefined; });
  await page.getByTestId('catalog-photo').click();
  await expect(page.getByTestId('catalog-error')).toContainText('没有读清');
  await expect(page.getByTestId('catalog-choose-photo')).toBeVisible();
});

test('点击记录直接拍照，快速连点只打开一次，拍完保留选定日期与餐次', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00+08:00'));
  await setup(page);
  await page.evaluate(() => { (window as any).__holdSystemPhoto = true; });
  const record = page.locator('[data-testid="mobile-camera"]:visible, [data-testid="header-camera"]:visible').first();
  await record.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => (window as any).__systemPhotos)).toBe(1);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseSystemPhoto)).toBe('function');
  await page.evaluate(() => (window as any).__releaseSystemPhoto());
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150');
  await expect(page.getByTestId('editor-meal-type')).toHaveValue('lunch');
  await expect(page.getByTestId('editor-date')).toHaveValue('2026-10-27');
  await expect(page.getByTestId('system-capture')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__systemPhotos)).toBe(1);
  expect(await page.evaluate(() => (window as any).__webCameras)).toBe(0);
});
