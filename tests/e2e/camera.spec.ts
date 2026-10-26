import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { barcodeImage } from './helpers/barcode-image';

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });
test('相机条码模式拍摄类型交接自动查询，只发送数字且未收录可改拍标签', async ({ page }) => {
  let queries = 0, ai = 0; const code = '3274080005003';
  await page.route('**/api/packaged-foods/**', route => { queries++; expect(route.request().url()).toContain(code); expect(route.request().postData()).toBeNull(); return route.fulfill({ json: { product: null } }); });
  await page.route('**/api/recognitions', route => { ai++; return route.abort(); });
  await page.goto('/'); await page.getByTestId('hero-camera').click(); await page.getByTestId('camera-mode-barcode').click(); await page.getByTestId('camera-meal-breakfast').click();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'barcode.png', mimeType: 'image/png', buffer: await barcodeImage(code) });
  await expect(page.getByTestId('catalog-barcode')).toHaveValue(code); await expect(page.getByTestId('catalog-message')).toContainText('尚未收录'); expect(queries).toBe(1); expect(ai).toBe(0);
  await page.getByTestId('close-sheet').click(); await expect(page.getByTestId('editor-meal-type')).toHaveValue('breakfast');
});
test('拍照直接进取景页，选餐次拍摄后识别编辑保存，关闭释放相机', async ({ page }, info) => {
  test.skip(process.env.SHIKE_E2E_LAN === '1', 'HTTP LAN不支持浏览器实时预览，另测相册回退');
  let calls = 0;
  await page.route('**/api/recognitions', route => { calls++; return route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'camera-test', result: { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] } } }); });
  // 合成画面也走真实video播放、canvas拍摄和MediaStreamTrack释放，避免依赖硬件。
  await page.addInitScript(() => { const media = navigator.mediaDevices; if (!media) return; (window as any).__tracks = []; media.getUserMedia = async constraints => { (window as any).__constraints = constraints; const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 960; const context = canvas.getContext('2d')!; context.fillStyle = '#a4bba1'; context.fillRect(0, 0, 640, 960); context.fillStyle = '#eef2d8'; context.beginPath(); context.arc(320, 400, 180, 0, Math.PI * 2); context.fill(); const stream = canvas.captureStream(15); (window as any).__tracks.push(...stream.getTracks()); return stream; }; });
  await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('capture-camera')).toBeVisible(); await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await expect(page.getByTestId('camera-shutter')).toBeEnabled(); await page.getByTestId('camera-meal-dinner').click();
  const view = await page.getByTestId('camera-preview').evaluate(element => ({ fit: getComputedStyle(element).objectFit, ratio: element.getBoundingClientRect().width / element.getBoundingClientRect().height })); expect(view.fit).toBe('cover');
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/camera-mobile.png' });
  await page.getByTestId('camera-shutter').click(); await expect(page.getByTestId('capture-camera')).toHaveCount(0); await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('editor-meal-type')).toHaveValue('dinner'); expect(calls).toBe(1);
  await expect(page.locator('.photo-preview')).toBeVisible(); expect(await page.locator('.photo-preview').evaluate(element => (element as HTMLImageElement).naturalWidth / (element as HTMLImageElement).naturalHeight)).toBeCloseTo(view.ratio, 2);
  await page.getByTestId('enlarge-photo').click(); await expect(page.getByTestId('photo-preview-sheet')).toBeVisible(); await expect(page.getByTestId('food-editor')).toHaveAttribute('inert', ''); await page.getByTestId('close-sheet').click(); await expect(page.getByTestId('enlarge-photo')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__constraints)).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-dinner').getByTestId('meal-record')).toHaveCount(1);
  await page.getByTestId('mobile-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(await page.evaluate(() => (window as any).__tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true); await expect(page.getByTestId('camera-shutter')).toBeDisabled();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByTestId('camera-retry').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled(); await page.getByTestId('close-camera').click(); expect(await page.evaluate(() => (window as any).__tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('高清请求、设备支持时连续对焦，多摄像头可切换且旧轨道释放', async ({ page }) => {
  test.skip(process.env.SHIKE_E2E_LAN === '1', '真实HTTP LAN无实时视频能力');
  await page.addInitScript(() => {
    (window as any).__quality = [];
    navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'rear', label: '合成后摄' }, { kind: 'videoinput', deviceId: 'front', label: '合成前摄' }] as MediaDeviceInfo[];
    navigator.mediaDevices.getUserMedia = async constraints => {
      (window as any).__quality.push({ constraints }); const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; canvas.getContext('2d')!.fillRect(0, 0, 1920, 1080); const stream = canvas.captureStream(10), track = stream.getVideoTracks()[0]!;
      const original = track.getSettings.bind(track), id = (constraints?.video as any)?.deviceId?.exact ?? 'rear'; track.getSettings = () => ({ ...original(), deviceId: id }); track.getCapabilities = () => ({ focusMode: ['continuous'] }) as MediaTrackCapabilities;
      track.applyConstraints = async change => { (window as any).__quality.push({ focus: change }); }; (window as any).__lastTrack = track; return stream;
    };
  });
  await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__quality[0].constraints)).toMatchObject({ audio: false, video: { width: { ideal: 2560 }, height: { ideal: 1440 } } });
  await page.getByRole('button', { name: '拍摄帮助' }).click(); await expect(page.locator('.capture-help')).toContainText('1920 × 1080'); await expect(page.locator('.capture-help')).toContainText('已启用连续对焦'); await page.getByRole('button', { name: '关闭帮助' }).click();
  await page.evaluate(() => { (window as any).__oldTrack = (window as any).__lastTrack; }); await page.getByTestId('switch-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__oldTrack.readyState)).toBe('ended'); expect(await page.evaluate(() => (window as any).__quality.some((item: any) => item.constraints?.video?.deviceId?.exact === 'front'))).toBe(true);
});

test('权限拒绝可选相册，营养表未读清不编造标签，条码手输不调用AI', async ({ page }) => {
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  let calls = 0;
  await page.route('**/api/recognitions', route => { calls++; return route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'camera-test', result: { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] } } }); });
  await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('system-camera')).toBeVisible(); await page.getByTestId('camera-mode-label').click();
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer }); await expect(page.getByTestId('editor-error')).toContainText('没有读清包装营养表'); await expect(page.locator('[data-testid^="food-item-"]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭记录面板', exact: true }).click(); await page.getByTestId('hero-camera').click(); await page.getByTestId('camera-mode-barcode').click(); await page.getByTestId('camera-skip').click(); await expect(page.getByTestId('catalog-barcode')).toBeVisible(); expect(calls).toBe(1);
});

test('相机营养表保留包装单位，缺失摄入量带入有提示的常见份量而非整包', async ({ page }) => {
  await page.route('**/api/recognitions', route => route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'label-test', result: { isFood: true, foods: [{ name: '测试牛奶', estimatedWeightG: null, visibleIngredients: [], uncertainties: [], packageLabel: { basis: '100ml', energy: { value: 60, unit: 'kcal' }, proteinG: 3, fatG: 3, carbsG: 5, netContent: { amount: 750, unit: 'ml' }, servingSize: null } }], uncertainties: [] } } }));
  await page.goto('/'); await page.getByTestId('mobile-camera').click(); await page.getByTestId('camera-mode-label').click();
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer(); await page.getByTestId('gallery-input').setInputFiles({ name: 'label.png', mimeType: 'image/png', buffer });
  // 与现行recognition单元测试一致：首次缺失量补常见250mL并标明假设，不等同于750mL净含量。
  await expect(page.getByTestId('package-amount-0')).toHaveValue('250'); await expect(page.getByTestId('food-calories-0')).toContainText('150 kcal')
  await expect(page.getByTestId('food-editor')).toContainText('常见份量估算')
  await page.getByTestId('package-half-0').click(); await expect(page.getByTestId('food-calories-0')).toContainText('225 kcal')
});
