import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openManualMeal } from './helpers/manual-food';
import { openPhotoEditor } from './helpers/photo-editor';
import { routeApkAssets } from './helpers/apk-assets';

test.beforeEach(async ({ page }) => { await routeApkAssets(page); });

async function tab(page: Page, name: 'settings' | 'diary') {
  await closeSettingsPanel(page);
  const mobile = page.getByTestId(`tab-${name}`);
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}

test('首次页面资源下载失败时显示刷新提示而非空白', async ({ page }) => {
  await page.route('**/assets/SettingsView-*.js', route => route.abort('failed'));
  await page.goto('/'); await tab(page, 'settings');
  await expect(page.getByTestId('async-panel-error')).toContainText('未保存');
  await expect(page.getByTestId('async-panel-error').getByRole('button', { name: '刷新重试' })).toBeVisible();
});

test('设置首页只展示常用入口，详细内容按需打开并返回原位置', async ({ page }) => {
  const calls: string[] = []; page.on('request', request => { if (request.url().includes('/api/models') || request.url().includes('/app-updates') || request.method() === 'POST') calls.push(request.url()); });
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', mode: 'live', provider: 'qwen', model: 'qwen3.7-flash' } }));
  await page.goto('/'); await tab(page, 'settings');
  await expect(page.getByTestId('settings-current-model')).toHaveText(process.env.SHIKE_E2E_APK_ASSETS ? '添加模型，开始拍照和聊天' : 'qwen3.7-flash');
  await expect(page.getByTestId('local-ai-service')).toHaveCount(0); await expect(page.getByTestId('app-update-card')).toHaveCount(0); await expect(page.getByTestId('export-backup')).toHaveCount(0);
  expect(calls).toEqual([]);
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await page.getByTestId('settings-page').boundingBox())!.height).toBeLessThan(1000);
  }
  const size = test.info().project.use.viewport!; await page.setViewportSize(size);
  for (const panel of ['privacy', 'sources', 'backup', 'updates'] as const) {
    const opener = page.getByTestId(`settings-open-${panel}`); await opener.scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => scrollY); await opener.click(); await expect(page.getByTestId('settings-detail')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByTestId('settings-detail')).not.toBeVisible(); await expect(opener).toBeFocused();
    expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThanOrEqual(2);
  }
  expect(calls).toEqual([]);
  await page.getByRole('heading', { name: '设置', exact: true }).click(); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/settings-hub-mobile.png', fullPage: true });
  if (test.info().project.name === 'Chrome 桌面') await page.screenshot({ path: 'docs/screenshots/settings-hub-desktop.png', fullPage: true });
});

test('本地设置可切换并记住模型，刷新配置、直达教程和常用库，窄屏按钮可操作', async ({ page }) => {
  const posts: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  let trimmedModels = false, holdHealth = false, releaseHealth: (() => void) | undefined;
  const models = [
    { id: 'default', provider: 'deepseek', model: 'deepseek-flash', mode: 'live' },
    { id: 'qwen:qwen3-vl-plus', provider: 'qwen', model: 'qwen3-vl-plus', mode: 'live' },
    { id: 'glm:glm-4.6v-flash', provider: 'glm', model: 'glm-4.6v-flash', mode: 'live' },
  ];
  await page.route('**/api/health', async route => {
    if (holdHealth) await new Promise<void>(resolve => { releaseHealth = resolve; });
    await route.fulfill({ json: { status: 'ok', mode: 'live', provider: 'deepseek', model: 'deepseek-flash' } });
  });
  await page.route('**/api/models', route => route.fulfill({ json: { defaultId: 'default', models: trimmedModels ? models.slice(0, 2) : models } }));
  await page.goto('/'); await tab(page, 'settings'); await openSettingsPanel(page, 'ai');
  await expect(page.getByTestId('local-ai-status')).toHaveText('真实模式已配置');
  await expect(page.getByTestId('recognition-model').locator('option')).toHaveCount(3);
  await expect(page.getByTestId('recognition-model').locator('option').last()).toHaveText(/智谱 GLM/);
  await page.getByTestId('recognition-model').selectOption('glm:glm-4.6v-flash');
  await closeSettingsPanel(page); await expect(page.getByTestId('settings-current-model')).toHaveText('glm-4.6v-flash');
  await page.reload(); await tab(page, 'settings'); await openSettingsPanel(page, 'ai'); await expect(page.getByTestId('recognition-model')).toHaveValue('glm:glm-4.6v-flash');
  await tab(page, 'diary'); await openPhotoEditor(page);
  await expect(page.getByTestId('recognition-model')).toHaveValue('glm:glm-4.6v-flash');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('food-editor')).toHaveCount(0); await tab(page, 'settings'); await openSettingsPanel(page, 'ai');
  trimmedModels = true; holdHealth = true;
  await page.getByTestId('refresh-health').click(); await expect(page.getByTestId('refresh-health')).toBeDisabled();
  await expect(page.getByTestId('local-ai-status')).toHaveText('正在检查');
  await expect.poll(() => Boolean(releaseHealth)).toBe(true); holdHealth = false; releaseHealth!();
  await expect(page.getByTestId('refresh-health')).toBeEnabled(); await expect(page.getByTestId('local-ai-status')).toHaveText('真实模式已配置');
  await expect(page.getByTestId('recognition-model').locator('option')).toHaveCount(2);
  await expect(page.getByTestId('recognition-model')).toHaveValue('default');
  await page.getByTestId('platform-guide-glm').click();
  await expect(page.getByTestId('web-model-key-help-sheet')).toBeVisible(); await expect(page.getByTestId('key-guide-provider')).toHaveValue('glm');
  await expect(page.getByTestId('key-guide-env')).toContainText('ZHIPU_API_KEY');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('platform-guide-glm')).toBeFocused();
  await closeSettingsPanel(page); await page.getByTestId('settings-food-library').click(); await expect(page.getByTestId('personal-food-library')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('personal-food-library')).toHaveCount(0); await expect(page.getByTestId('settings-food-library')).toBeFocused();
  await openSettingsPanel(page, 'ai'); await page.getByTestId('local-config-help').locator('summary').click();
  const example = await page.getByTestId('local-env-example').innerText();
  expect(example.match(/^AI_PROVIDER=/gm)).toHaveLength(1); expect(example.match(/^AI_MODE=/gm)).toHaveLength(1);
  await page.getByTestId('local-config-help').locator('summary').click();
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const id of ['platform-guide-glm', 'export-backup', 'settings-food-library']) {
      if (id === 'platform-guide-glm') await openSettingsPanel(page, 'ai'); else if (id === 'export-backup') await openSettingsPanel(page, 'backup'); else await closeSettingsPanel(page);
      const button = page.getByTestId(id); await button.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      expect(await button.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
    }
  }
  await closeSettingsPanel(page); const viewport = test.info().project.use.viewport!; await page.setViewportSize(viewport); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/settings-web-mobile.png' });
  if (test.info().project.name === 'Chrome 桌面') await page.screenshot({ path: 'docs/screenshots/settings-web-desktop.png', fullPage: true });
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test('本地网页可选择新增免费视觉模型并查看对应提示与官方教程', async ({ page }) => {
  const nvidia = 'nvidia/nemotron-3.5-super-vl:free', dots = 'dots-studio/dots-3-note-preview:free', posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', mode: 'live', provider: 'openrouter', model: nvidia } }));
  await page.route('**/api/models', route => route.fulfill({ json: { defaultId: 'default', models: [
    { id: 'default', provider: 'openrouter', model: nvidia, mode: 'live' },
    { id: 'openrouter:' + dots, provider: 'openrouter', model: dots, mode: 'live' },
  ] } }));
  await page.goto('/'); await tab(page, 'settings'); await openSettingsPanel(page, 'ai');
  await expect(page.getByTestId('model-usage-notice')).toContainText('请勿上传人脸');
  await page.getByTestId('recognition-model').selectOption('openrouter:' + dots);
  await expect(page.getByTestId('model-usage-notice')).toContainText('2026-12-31');
  await page.reload(); await tab(page, 'settings'); await openSettingsPanel(page, 'ai'); await expect(page.getByTestId('recognition-model')).toHaveValue('openrouter:' + dots);
  await page.getByTestId('platform-guide-openrouter').click();
  const guide = page.getByTestId('web-model-key-help-sheet'); await expect(guide).toBeVisible();
  await expect(guide.getByTestId('key-guide-model-link')).toHaveCount(2);
  await expect(guide.getByTestId('key-guide-models')).toContainText(nvidia); await expect(guide.getByTestId('key-guide-models')).toContainText(dots);
  await expect(guide).toContainText('2026-12-31'); await page.keyboard.press('Escape');
  expect(posts).toEqual([]);
});

test('网页版FlashX充值教程提供官方入口与型号配置，查看及切换不调用付费模型', async ({ page }) => {
  const model = 'glm-4.6v-flashx', posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', mode: 'live', provider: 'glm', model: 'glm-4.1v-thinking-flash' } }));
  await page.route('**/api/models', route => route.fulfill({ json: { defaultId: 'default', models: [
    { id: 'default', provider: 'glm', model: 'glm-4.1v-thinking-flash', mode: 'live' },
    { id: 'glm:' + model, provider: 'glm', model, mode: 'live' },
  ] } }));
  await page.goto('/'); await tab(page, 'settings'); await openSettingsPanel(page, 'ai'); await expect(page.getByTestId('recognition-model')).toHaveValue('default');
  await page.getByTestId('recognition-model').selectOption('glm:' + model); await expect(page.getByTestId('model-usage-notice')).toContainText('按量计费');
  await page.getByTestId('platform-guide-glm').click(); const sheet = page.getByTestId('web-model-key-help-sheet');
  await expect(sheet.getByTestId('key-guide-payment')).toContainText('先用适用资源包');
  await expect(sheet.getByTestId('key-guide-payment')).toContainText('无需购买编程包月套餐');
  await expect(sheet.getByTestId('key-guide-payment-console')).toHaveAttribute('href', 'https://bigmodel.cn/console/overview');
  await expect(sheet.getByTestId('key-guide-env')).toContainText('GLM_MODEL=glm-5.3-flash');
  expect((await sheet.getByTestId('key-guide-env').innerText()).match(/^ZHIPU_API_KEY=/gm)).toHaveLength(1);
  await page.keyboard.press('Escape'); await page.reload(); await tab(page, 'settings'); await openSettingsPanel(page, 'ai'); await expect(page.getByTestId('recognition-model')).toHaveValue('glm:' + model);
  expect(posts).toEqual([]);
});

test('重新分区后的备份可导出、预览和恢复，设置中的食物库入口可返回', async ({ page }) => {
  await page.goto('/'); await openManualMeal(page, '设置页备份餐食');
  await page.getByTestId('food-weight-0').fill('180'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  const downloadPromise = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(backup.schemaVersion).toBe(11); expect(backup.meals).toHaveLength(1); expect(backup.meals[0].items[0].name).toBe('设置页备份餐食');
  backup.meals[0].items[0].name = '设置页恢复成功';
  await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: 'settings-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByTestId('backup-preview')).toContainText('备份检查通过');
  await expect(page.getByTestId('backup-preview')).toContainText('完整替换');
  await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  await tab(page, 'diary'); await expect(page.getByTestId('meal-record')).toContainText('设置页恢复成功');
  await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('设置页恢复成功');
  await tab(page, 'settings'); await page.getByTestId('manage-packaged-foods').click();
  await expect(page.getByRole('heading', { name: '我的包装食品' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('settings-page')).toBeVisible();
});

test('大量估算收起在管理入口内，支持搜索、分批查看、删除和返回焦点', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('shike-local-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('estimatedFoods', 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      for (let index = 0; index < 35; index++) tx.objectStore('estimatedFoods').put({ id: `estimate-${index}`, name: `测试估算${String(index).padStart(2, '0')}`, model: 'test-model', provider: 'qwen', createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z', nutrientsPer100g: { energyKcal: 100, proteinG: null, fatG: null, carbsG: null }, provenance: '合成测试', assumptions: ['用油待核对'] });
    }); } finally { database.close(); }
  });
  await page.reload(); await tab(page, 'settings'); await expect(page.getByTestId('estimated-food-count')).toHaveText('35 项');
  await expect(page.locator('.estimate-library-item')).toHaveCount(0);
  expect((await page.getByTestId('settings-estimate-card').boundingBox())!.height).toBeLessThan(190);
  await page.getByTestId('manage-estimates').click(); await expect(page.getByTestId('estimate-library')).toBeVisible(); await expect(page.locator('.estimate-library-item')).toHaveCount(10);
  await page.getByTestId('estimate-load-more').click(); await expect(page.locator('.estimate-library-item')).toHaveCount(20);
  await page.getByTestId('estimate-search').fill('估算34'); await expect(page.locator('.estimate-library-item')).toHaveCount(1);
  await page.locator('.estimate-library-item summary').click(); await expect(page.locator('.estimate-library-item')).toContainText('用油待核对');
  page.once('dialog', dialog => dialog.accept()); await page.getByTestId('delete-estimated-food').click(); await expect(page.locator('.estimate-library-item')).toHaveCount(0); await expect(page.getByTestId('estimate-library')).toContainText('没有找到');
  await page.getByTestId('estimate-search').fill(''); await expect(page.locator('.estimate-library-item')).toHaveCount(10);
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/estimate-library-mobile.png' });
  await page.keyboard.press('Escape'); await expect(page.getByTestId('manage-estimates')).toBeFocused(); await expect(page.getByTestId('estimated-food-count')).toHaveText('34 项');
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/settings-compact-estimates-mobile.png' });
});
