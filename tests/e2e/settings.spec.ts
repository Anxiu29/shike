import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openManualMeal } from './helpers/manual-food';
import { openPhotoEditor } from './helpers/photo-editor';

async function tab(page: Page, name: 'settings' | 'diary') {
  const mobile = page.getByTestId(`tab-${name}`);
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}

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
  await page.goto('/'); await tab(page, 'settings');
  await expect(page.getByTestId('local-ai-status')).toHaveText('真实模式已配置');
  await expect(page.getByTestId('recognition-model').locator('option')).toHaveCount(3);
  await expect(page.getByTestId('recognition-model').locator('option').last()).toHaveText(/智谱 GLM/);
  await page.getByTestId('recognition-model').selectOption('glm:glm-4.6v-flash');
  await page.reload(); await tab(page, 'settings'); await expect(page.getByTestId('recognition-model')).toHaveValue('glm:glm-4.6v-flash');
  await tab(page, 'diary'); await openPhotoEditor(page);
  await expect(page.getByTestId('recognition-model')).toHaveValue('glm:glm-4.6v-flash');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('food-editor')).toHaveCount(0); await tab(page, 'settings');
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
  await page.getByTestId('settings-food-library').click(); await expect(page.getByTestId('personal-food-library')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('personal-food-library')).toHaveCount(0); await expect(page.getByTestId('settings-food-library')).toBeFocused();
  await page.getByTestId('local-config-help').locator('summary').click();
  const example = await page.getByTestId('local-env-example').innerText();
  expect(example.match(/^AI_PROVIDER=/gm)).toHaveLength(1); expect(example.match(/^AI_MODE=/gm)).toHaveLength(1);
  await page.getByTestId('local-config-help').locator('summary').click();
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const id of ['platform-guide-glm', 'export-backup', 'settings-food-library']) {
      const button = page.getByTestId(id); await button.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      expect(await button.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
    }
  }
  const viewport = test.info().project.use.viewport!; await page.setViewportSize(viewport); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
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
  await page.goto('/'); await tab(page, 'settings');
  await expect(page.getByTestId('model-usage-notice')).toContainText('请勿上传人脸');
  await page.getByTestId('recognition-model').selectOption('openrouter:' + dots);
  await expect(page.getByTestId('model-usage-notice')).toContainText('2026-12-31');
  await page.reload(); await tab(page, 'settings'); await expect(page.getByTestId('recognition-model')).toHaveValue('openrouter:' + dots);
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
  await page.goto('/'); await tab(page, 'settings'); await expect(page.getByTestId('recognition-model')).toHaveValue('default');
  await page.getByTestId('recognition-model').selectOption('glm:' + model); await expect(page.getByTestId('model-usage-notice')).toContainText('按量计费');
  await page.getByTestId('platform-guide-glm').click(); const sheet = page.getByTestId('web-model-key-help-sheet');
  await expect(sheet.getByTestId('key-guide-payment')).toContainText('先用适用资源包');
  await expect(sheet.getByTestId('key-guide-payment')).toContainText('无需购买编程包月套餐');
  await expect(sheet.getByTestId('key-guide-payment-console')).toHaveAttribute('href', 'https://bigmodel.cn/console/overview');
  await expect(sheet.getByTestId('key-guide-env')).toContainText('GLM_MODEL=glm-5.3-flash');
  expect((await sheet.getByTestId('key-guide-env').innerText()).match(/^ZHIPU_API_KEY=/gm)).toHaveLength(1);
  await page.keyboard.press('Escape'); await page.reload(); await tab(page, 'settings'); await expect(page.getByTestId('recognition-model')).toHaveValue('glm:' + model);
  expect(posts).toEqual([]);
});

test('重新分区后的备份可导出、预览和恢复，设置中的食物库入口可返回', async ({ page }) => {
  await page.goto('/'); await openManualMeal(page, '设置页备份餐食');
  await page.getByTestId('food-weight-0').fill('180'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  const downloadPromise = page.waitForEvent('download'); await page.getByTestId('export-backup').click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(backup.schemaVersion).toBe(10); expect(backup.meals).toHaveLength(1); expect(backup.meals[0].items[0].name).toBe('设置页备份餐食');
  backup.meals[0].items[0].name = '设置页恢复成功';
  await page.getByTestId('backup-input').setInputFiles({ name: 'settings-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByTestId('backup-preview')).toContainText('备份检查通过');
  await expect(page.getByTestId('backup-preview')).toContainText('完整替换');
  await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  await tab(page, 'diary'); await expect(page.getByTestId('meal-record')).toContainText('设置页恢复成功');
  await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('设置页恢复成功');
  await tab(page, 'settings'); await page.getByTestId('manage-packaged-foods').click();
  await expect(page.getByRole('heading', { name: '我的包装食品' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('settings-page')).toBeVisible();
});
