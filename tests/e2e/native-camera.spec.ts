import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';
import { selectDate } from './helpers/calendar';

// 可用真实APK的解包资源重跑同一组场景；禁用所有后端网络，不以源码构建替代成品检查。
test.beforeEach(async ({ page }) => { await routeApkAssets(page); });

async function nativeCamera(page: Page, delayedPermission = false, delayedRecognition = false, freeVision = false) {
  const jpeg = (await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#a7bcac' } }).jpeg().toBuffer()).toString('base64');
  await page.addInitScript(({ jpeg, delayedPermission, delayedRecognition, freeVision }) => {
    const state = window as any; state.__nativeCalls = []; state.__webCameraCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { state.__webCameraCalls++; throw Error('原生相机不得退回WebView取流'); };
    state.androidBridge = {};
    const appListeners = new Map<string, { event: string; callback: (data: unknown) => void }>(); let listenerId = 0;
    state.__appEmit = (event: string, data = {}) => { for (const listener of appListeners.values()) if (listener.event === event) listener.callback(data); };
    const methods = ['requestPermissions', 'getAvailableDevices', 'start', 'stop', 'getDeviceId', 'getZoom', 'setFocus', 'getSupportedFlashModes', 'capture', 'setPreviewSize', 'setFlashMode'];
    state.Capacitor = { PluginHeaders: [{ name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, ...['removeListener', 'minimizeApp', 'exitApp'].map(name => ({ name, rtype: 'promise' }))] }, { name: 'CameraPreview', methods: methods.map(name => ({ name, rtype: 'promise' })) }, { name: 'PersonalVision', methods: ['getState', 'recognize'].map(name => ({ name, rtype: 'promise' })) }],
      nativeCallback: (_plugin: string, method: string, input: any, callback: (data: unknown) => void) => { if (method !== 'addListener') throw Error('Unexpected callback'); const id = String(++listenerId); appListeners.set(id, { event: input.eventName, callback }); return id; },
      nativePromise: async (plugin: string, method: string, options: any) => {
        state.__nativeCalls.push({ plugin, method, options });
        if (plugin === 'App') { if (method === 'removeListener') appListeners.delete(options.callbackId); return {}; }
        if (plugin === 'PersonalVision') {
          if (method === 'getState') return { activeId: '11111111-1111-4111-8111-111111111111', profiles: [{ id: '11111111-1111-4111-8111-111111111111', label: '测试配置（无Key）', provider: freeVision ? 'openrouter' : 'qwen', model: freeVision ? 'nvidia/nemotron-3.5-super-vl:free' : 'qwen3.7-flash' }] };
          if (method === 'recognize') { if (delayedRecognition) await new Promise<void>(resolve => { state.__finishRecognition = resolve; }); return { provider: 'qwen', model: 'qwen3.7-flash', data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] }) } }] }) }; }
        }
        if (method === 'requestPermissions') {
          if (delayedPermission) return new Promise(resolve => { state.__grantCamera = () => resolve({ camera: 'granted' }); });
          return { camera: 'granted' };
        }
        if (method === 'getAvailableDevices') return { devices: [
          { deviceId: 'ultra', label: '超广角', position: 'rear', isLogical: false, minZoom: .5, maxZoom: .5, lenses: [{ deviceType: 'ultraWide' }] },
          { deviceId: 'main', label: '标准后摄', position: 'rear', isLogical: true, minZoom: .5, maxZoom: 10, lenses: [{ deviceType: 'wideAngle' }] },
          { deviceId: 'front', label: '前置', position: 'front', isLogical: false, minZoom: 1, maxZoom: 3, lenses: [] },
        ] };
        if (method === 'start') {
          state.__device = options.deviceId;
          // 模拟NativeView的位置；真实CameraX光学画质必须在手机上确认。
          const frame = document.createElement('div'); frame.id = 'native-test-frame'; frame.style.cssText = `position:fixed;left:${options.x}px;top:${options.y}px;width:${options.width}px;height:${options.height}px;background:#789b85;z-index:-1`;
          document.body.append(frame); return options;
        }
        if (method === 'stop') { document.getElementById('native-test-frame')?.remove(); if (state.__delayCameraStop) { state.__delayCameraStop = false; await new Promise<void>(resolve => { state.__finishCameraStop = resolve; }); } state.__cameraStopFinished = true; return {}; }
        if (method === 'getDeviceId') return { deviceId: state.__device };
        if (method === 'getZoom') return { current: 1 };
        if (method === 'getSupportedFlashModes') return { result: ['off', 'torch'] };
        if (method === 'capture') return { value: jpeg };
        if (method === 'setPreviewSize') {
          const frame = document.getElementById('native-test-frame');
          if (frame) Object.assign(frame.style, { left: `${options.x}px`, top: `${options.y}px`, width: `${options.width}px`, height: `${options.height}px` });
          return options;
        }
        return {};
      },
    };
  }, { jpeg, delayedPermission, delayedRecognition, freeVision });
}

test('安卓返回先关拍摄帮助再关相机，释放原生摄像头并恢复首页', async ({ page }) => {
  await nativeCamera(page); await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  await page.getByRole('button', { name: '拍摄帮助' }).click(); await page.evaluate(() => (window as any).__appEmit('backButton'));
  await expect(page.locator('.capture-help')).toHaveCount(0); await expect(page.getByTestId('capture-camera')).toBeVisible();
  await page.evaluate(() => (window as any).__appEmit('backButton')); await expect(page.getByTestId('capture-camera')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/camera-native-active/); await expect(page.getByTestId('daily-summary')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__nativeCalls.some((call: any) => call.method === 'stop'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__nativeCalls.some((call: any) => call.method === 'minimizeApp' || call.method === 'exitApp'))).toBe(false);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('每餐拍照快捷入口预选对应餐次，空餐、已记录和可复用历史时均能继续拍照', async ({ page }) => {
  await nativeCamera(page); await page.goto('/'); await selectDate(page, 'diary-date', '2026-10-23');
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
    await page.getByTestId(`photo-${meal}`).click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
    await expect(page.getByTestId(`camera-meal-${meal}`)).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('camera-shutter').click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('150');
    await expect(page.getByTestId('editor-meal-type')).toHaveValue(meal); await expect(page.getByTestId('editor-date')).toHaveValue('2026-10-23');
    await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0);
    await expect(page.getByTestId(`meal-${meal}`)).toContainText('米饭'); await expect(page.getByTestId(`photo-${meal}`)).toBeVisible();
  }
  await expect(page.getByTestId('meal-record')).toHaveCount(4);
  await selectDate(page, 'diary-date', '2026-10-24');
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
    await expect(page.getByTestId(`reuse-previous-${meal}`)).toBeVisible(); await expect(page.getByTestId(`photo-${meal}`)).toBeVisible();
  }
  await page.getByTestId('photo-lunch').click(); await expect(page.getByTestId('camera-meal-lunch')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('camera-shutter')).toBeEnabled(); await page.getByTestId('camera-shutter').click();
  await expect(page.getByTestId('editor-date')).toHaveValue('2026-10-24'); await expect(page.getByTestId('editor-meal-type')).toHaveValue('lunch');
  await page.getByRole('button', { name: '关闭记录面板', exact: true }).click(); await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await selectDate(page, 'diary-date', '2026-10-23'); await expect(page.getByTestId('meal-record')).toHaveCount(4);
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.plugin === 'PersonalVision' && call.method === 'recognize').length)).toBe(5);
});

test('安卓识别进行中返回不关闭草稿或退出，完成后可保存', async ({ page }) => {
  await nativeCamera(page, false, true); await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled(); await page.getByTestId('camera-shutter').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishRecognition)).toBe('function');
  await page.evaluate(() => { (window as any).__appEmit('backButton'); (window as any).__appEmit('backButton'); });
  await expect(page.getByTestId('food-editor')).toBeVisible(); expect(await page.evaluate(() => (window as any).__nativeCalls.some((call: any) => call.method === 'minimizeApp' || call.method === 'exitApp'))).toBe(false);
  await page.evaluate(() => (window as any).__finishRecognition()); await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
});

test('拍照后原生释放尚未完成时返回，迟到照片不会重新打开编辑页', async ({ page }) => {
  await nativeCamera(page); await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  await page.evaluate(() => { (window as any).__delayCameraStop = true; (window as any).__cameraStopFinished = false; }); await page.getByTestId('camera-shutter').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishCameraStop)).toBe('function');
  await page.evaluate(() => (window as any).__appEmit('backButton')); await expect(page.getByTestId('capture-camera')).toHaveCount(0);
  await page.evaluate(() => (window as any).__finishCameraStop());
  await expect.poll(() => page.evaluate(() => (window as any).__cameraStopFinished)).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('daily-summary')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__nativeCalls.some((call: any) => call.method === 'recognize'))).toBe(false);
});

test('APK走原生后摄与点按对焦，类型餐次交互不误触对焦，关闭恢复页面', async ({ page }, info) => {
  await nativeCamera(page); await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  await expect(page.locator('.capture-preview')).toHaveAttribute('data-camera-engine', 'native');
  expect(await page.evaluate(() => (window as any).__webCameraCalls)).toBe(0);
  const start = await page.evaluate(() => (window as any).__nativeCalls.find((call: any) => call.method === 'start'));
  expect(start.options).toMatchObject({ deviceId: 'main', disableAudio: true, storeToFile: false, enableVideoMode: false, toBack: true });
  await page.getByRole('button', { name: '拍摄帮助' }).click(); await expect(page.locator('.capture-help')).toContainText('原生CameraX'); await page.getByRole('button', { name: '关闭帮助' }).click();
  const before = await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'setFocus').length);
  await page.getByTestId('camera-meal-dinner').click(); await page.getByTestId('camera-mode-label').click();
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'setFocus').length)).toBe(before);
  const rect = await page.locator('.capture-preview').boundingBox(); if (!rect) throw Error('没有取景区域');
  await page.mouse.click(rect.x + rect.width * .25, rect.y + rect.height * .4);
  await expect(page.getByTestId('camera-focus-status')).toContainText('已请求对焦');
  const point = await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'setFocus').at(-1).options);
  expect(point.x).toBeCloseTo(.25); expect(point.y).toBeCloseTo(.4);
  await expect(page.getByTestId('system-camera')).toBeVisible();
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/native-camera-mobile.png' });
  await page.getByTestId('close-camera').click(); await expect(page.locator('html')).not.toHaveClass(/camera-native-active/);
  await expect(page.getByTestId('daily-summary')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__nativeCalls.some((call: any) => call.method === 'stop'))).toBe(true);
});

test('原生照片经过现有识别编辑流程，拍摄先释放相机且不保存相册', async ({ page }) => {
  await nativeCamera(page);
  let calls = 0; await page.route('**/api/recognitions', route => { calls++; return route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'camera-test', result: { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] } } }); });
  await page.goto('/'); await page.getByTestId('hero-camera').click(); await expect(page.getByTestId('camera-shutter')).toBeEnabled(); await page.getByTestId('camera-meal-dinner').click(); await page.getByTestId('camera-shutter').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('editor-meal-type')).toHaveValue('dinner');
  const events = await page.evaluate(() => (window as any).__nativeCalls);
  expect(events.find((call: any) => call.method === 'capture').options).toMatchObject({ saveToGallery: false, withExifLocation: false }); expect(events.some((call: any) => call.method === 'stop')).toBe(true);
  expect(events.filter((call: any) => call.plugin === 'PersonalVision' && call.method === 'recognize')).toHaveLength(1);
  await expect(page.locator('html')).not.toHaveClass(/camera-native-active/); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); expect(calls).toBe(0);
});

test('原生权限迟到时已关闭的相机不重新开启', async ({ page }) => {
  await nativeCamera(page, true); await page.goto('/'); await page.getByTestId('hero-camera').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__grantCamera)).toBe('function');
  await page.getByTestId('close-camera').click(); await page.evaluate(() => (window as any).__grantCamera());
  await expect(page.getByTestId('daily-summary')).toBeVisible(); await expect(page.locator('html')).not.toHaveClass(/camera-native-active/);
  expect(await page.evaluate(() => (window as any).__nativeCalls.some((call: any) => call.method === 'start'))).toBe(false);
});

test('取景画面覆盖整个窗口，操作悬浮可点击，旋转和小屏同步原生预览尺寸', async ({ page }, info) => {
  await nativeCamera(page); await page.goto('/'); await page.getByTestId('hero-camera').click()
  await expect(page.getByTestId('camera-shutter')).toBeEnabled()
  const start = await page.evaluate(() => (window as any).__nativeCalls.find((call: any) => call.method === 'start').options)
  expect(start.includeSafeAreaInsets).toBe(false); expect(start.aspectMode).toBe('cover')
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 960]]) {
    await page.setViewportSize({ width: width!, height: height! })
    const camera = await page.getByTestId('capture-camera').boundingBox(), preview = await page.locator('.capture-preview').boundingBox()
    expect(camera).not.toBeNull(); expect(preview).not.toBeNull()
    expect(preview!.x).toBeCloseTo(0); expect(preview!.y).toBeCloseTo(0)
    expect(preview!.width).toBeCloseTo(width!); expect(preview!.height).toBeCloseTo(height!)
    expect(camera!.width).toBeCloseTo(width!); expect(camera!.height).toBeCloseTo(height!)
    await expect.poll(async () => page.evaluate(() => {
      const calls = (window as any).__nativeCalls.filter((call: any) => call.method === 'start' || call.method === 'setPreviewSize')
      const bounds = calls.at(-1).options; return { width: Math.round(bounds.width), height: Math.round(bounds.height) }
    })).toEqual({ width, height })
    for (const id of ['close-camera', 'camera-shutter', 'camera-gallery', 'camera-skip', 'system-camera', 'camera-meal-dinner', 'camera-mode-label']) {
      await expect(page.getByTestId(id)).toBeInViewport()
      expect(await page.getByTestId(id).evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }), `${id} at ${width}x${height}`).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('camera-mode-barcode').click(); await expect(page.getByTestId('camera-shutter')).toBeInViewport()
  await page.getByTestId('camera-mode-food').click()
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/camera-fullscreen-mobile.png' })
  await page.getByTestId('close-camera').click(); await expect(page.getByTestId('daily-summary')).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/camera-native-active/)
})

test('免费视觉的隐私提醒在全屏相机横竖屏可读且不遮挡拍摄按钮', async ({ page }, info) => {
  await nativeCamera(page, false, false, true); await page.goto('/'); await page.getByTestId('hero-camera').click();
  await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 960]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const notice = page.getByTestId('model-usage-notice'); await expect(notice).toContainText('请勿上传人脸'); await expect(notice).toBeInViewport();
    for (const id of ['close-camera', 'camera-shutter', 'camera-gallery', 'camera-skip', 'system-camera', 'camera-meal-dinner', 'camera-mode-label']) {
      await expect(page.getByTestId(id)).toBeInViewport();
      expect(await page.getByTestId(id).evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), `${id} at ${width}x${height}`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
  }
  if (info.project.name === 'Chrome 手机') { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'docs/screenshots/openrouter-camera-notice-mobile.png' }); }
  await page.getByTestId('close-camera').click(); await expect(page.getByTestId('daily-summary')).toBeVisible();
});
