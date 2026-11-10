import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './apk-assets';

// 合成图片与模拟原生返回；验证应用契约，不冒充手机真实模型推理。
export async function setupOfflineImage(page: Page) {
  await routeApkAssets(page);
  const jpeg = (await sharp({ create: { width: 900, height: 600, channels: 3, background: '#e0edc5' } }).jpeg().toBuffer()).toString('base64');
  await page.addInitScript(({ jpeg }) => {
    const w = window as any; w.androidBridge = {}; w.__offlinePhotoCalls = []; w.__cloudPhotoCalls = 0; w.__photoStops = 0;
    if (!localStorage.getItem('shike-offline-photo-v1')) localStorage.setItem('shike-offline-photo-v1', JSON.stringify({ enabled: true }));
    const state = { ready: true, busy: false, loaded: false, stage: 'ready', error: '', stopReason: '', text: '', bytes: 1303671472, downloadedBytes: 0, device: 'OPPO PLJ110（模拟桥）', availableMemoryBytes: 5_000_000_000 };
    w.Capacitor = { PluginHeaders: [
      { name: 'OfflineVision', methods: ['getState', 'generateImage', 'cancel', 'unload', 'downloadModel', 'importModel', 'deleteModel'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'PersonalVision', methods: ['getState', 'recognize', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'SystemPhoto', methods: [{ name: 'capture', rtype: 'promise' }] },
      { name: 'Filesystem', methods: [{ name: 'writeFile', rtype: 'promise' }] },
      { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] },
    ], nativePromise: async (plugin: string, method: string, options: any) => {
      if (plugin === 'Filesystem' && method === 'writeFile') { w.__backupText = options.data; return { uri: 'file:///mock-cache/backups/local-label.json' }; }
      if (plugin === 'Share' && method === 'share') { w.__sharedFiles = options.files; return {}; }
      if (plugin === 'PersonalVision') { if (method === 'getState') return { profiles: [], activeId: null }; w.__cloudPhotoCalls++; throw Error('不可自动发送云端'); }
      if (plugin === 'SystemPhoto') return w.__cameraCancelled ? { cancelled: true } : { cancelled: false, jpegBase64: jpeg };
      if (plugin !== 'OfflineVision') return {};
      if (method === 'getState') return state;
      if (method === 'cancel') { w.__photoStops++; Object.assign(state, { busy: false, stage: 'stopped' }); return {}; }
      if (method === 'generateImage') {
        w.__offlinePhotoCalls.push(structuredClone(options)); Object.assign(state, { busy: true, stage: 'loading', error: '', stopReason: '', text: '', task: options.task ?? 'names', maxOutputTokens: options.task ? 512 : 128 });
        if (w.__holdVision) return {};
        const text = w.__photoText ?? (options.namesOnly ? '米饭\n鸡蛋' : JSON.stringify({ foods: [{ name: '米饭', estimatedWeightG: 150 }, { name: '鸡蛋', estimatedWeightG: 100 }, { name: '火星独有菜', estimatedWeightG: null }] }));
        Object.assign(state, { busy: false, stage: 'completed', text });
      }
      return {};
    } };
  }, { jpeg });
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  return Buffer.from(jpeg, 'base64');
}

export async function openOfflineLabel(page: Page, value: unknown) {
  await page.evaluate(() => { (window as any).__cameraCancelled = true; });
  await page.getByTestId('photo-lunch').click(); await page.getByTestId('system-photo-kind').selectOption('label');
  await page.evaluate(value => { (window as any).__cameraCancelled = false; (window as any).__photoText = JSON.stringify(value); }, value);
  await page.getByTestId('system-photo-take').click();
}
export const offlineLabelFixture = { name: '测试饼干', basis: '100g', energyValue: 2092, energyUnit: 'kJ', proteinG: 8, fatG: 20, carbsG: 0, servingAmount: 25, servingUnit: 'g', netAmount: 100, netUnit: 'g', evidence: '每100克 能量2092千焦 蛋白质8克 脂肪20克 碳水0克' };
