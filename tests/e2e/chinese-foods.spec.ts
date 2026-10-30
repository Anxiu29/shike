import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import sharp from 'sharp';
import { calculateNutrients, createRecipeEntry, findRecipe } from '@shike/shared';
import { openPhotoEditor } from './helpers/photo-editor';

// 可选：用最终APK解包的内置资源重跑同样场景；禁止从解包目录之外读取文件。
test.beforeEach(async ({ page }) => {
  if (!process.env.SHIKE_E2E_APK_ASSETS) return;
  const root = resolve(process.env.SHIKE_E2E_APK_ASSETS);
  await page.route('**/*', async route => {
    const request = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(request.hostname) || request.pathname.startsWith('/api/')) return route.abort();
    const file = resolve(root, '.' + (request.pathname === '/' ? '/index.html' : decodeURIComponent(request.pathname)));
    if (!file.startsWith(root + sep)) return route.abort();
    try {
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
      return route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    } catch { return route.abort(); }
  });
});
async function tab(page: Page, name: 'diary' | 'settings') {
  await closeSettingsPanel(page);
  const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}

test('手机分类可找到菜包肉包，选取后保存刷新并保留参考配方快照', async ({ page }, info) => {
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click();
  await page.getByTestId('food-category-主食').click(); await page.getByTestId('food-picker-search').fill('肉包');
  await expect(page.locator('[data-testid^="food-option-"]').first()).toHaveAttribute('data-testid', 'food-option-pork-bao');
  await expect(page.getByTestId('food-option-fdc-2708725')).toHaveCount(0);
  await page.getByTestId('food-option-pork-bao').click(); await page.getByTestId('manual-food-weight').fill('105'); await page.getByTestId('confirm-manual-food').click();
  await expect(page.getByTestId('food-name-0')).toHaveValue('鲜肉包');
  await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-picker-search').fill('菜包');
  await expect(page.getByTestId('food-option-vegetable-bao')).toContainText('参考配方');
  if (info.project.name === 'Chrome 手机' && !process.env.SHIKE_E2E_APK_ASSETS) await page.getByTestId('food-picker').screenshot({ path: 'docs/screenshots/chinese-foods-mobile.png' });
  await page.getByTestId('food-option-vegetable-bao').click(); await page.getByTestId('manual-food-weight').fill('135'); await page.getByTestId('confirm-manual-food').click();
  const total = calculateNutrients(createRecipeEntry(findRecipe('肉包')!, 105)).energyKcal! + calculateNutrients(createRecipeEntry(findRecipe('菜包')!, 135)).energyKcal!;
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload();
  await expect(page.getByTestId('daily-calories')).toContainText(new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(total));
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('105'); await expect(page.getByTestId('food-weight-1')).toHaveValue('135');
  await expect(page.getByTestId('food-source-1')).toHaveAttribute('data-source-id', 'vegetable-bao');
});

test('TFDA馒头按重量换算并保存来源，设置显示数据归属', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-picker-search').fill('馒头');
  await page.getByTestId('food-option-tfda-R2400201').click(); await page.getByTestId('manual-food-weight').fill('150'); await page.getByTestId('confirm-manual-food').click();
  await expect(page.getByTestId('food-calories-0')).toContainText('372'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload();
  await expect(page.getByTestId('daily-calories')).toContainText('372'); await tab(page, 'settings');
  await openSettingsPanel(page, 'sources'); await page.getByTestId('settings-detail').getByText('查看来源、许可与使用建议', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'TFDA 数据集' })).toBeVisible();
  const download = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click(); const stream = await (await download).createReadStream(); if (!stream) throw Error('未导出备份');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(data.meals[0].items[0].provenance).toContain('样本 R2400201'); expect(data.meals[0].items[0].nutrientsPer100g.energyKcal).toBe(248);
});

test('多食物识别匹配菜包和肉包并保留各自重量', async ({ page }) => {
  test.skip(!!process.env.SHIKE_E2E_APK_ASSETS, '独立APK需要原生模型桥；本项验证网页统一识别结果，不执行真实AI调用');
  await page.route('**/api/recognitions', route => route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'test-only-bao', result: { isFood: true, uncertainties: [], foods: [{ name: '2个菜包', estimatedWeightG: 150, visibleIngredients: ['青菜'], uncertainties: [] }, { name: '肉包', estimatedWeightG: 110, visibleIngredients: ['猪肉'], uncertainties: [] }] } } }));
  await page.goto('/'); await openPhotoEditor(page);
  const bytes = await sharp({ create: { width: 600, height: 450, channels: 3, background: '#ddd4c0' } }).jpeg().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'synthetic-test.jpg', mimeType: 'image/jpeg', buffer: bytes });
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', 'vegetable-bao'); await expect(page.getByTestId('food-source-1')).toHaveAttribute('data-source-id', 'pork-bao');
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('food-weight-1')).toHaveValue('110');
  await expect(page.getByTestId('food-name-2')).toHaveCount(0); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload();
  await expect(page.getByTestId('meal-record')).toContainText('菜包'); await expect(page.getByTestId('meal-record')).toContainText('鲜肉包');
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('food-weight-1')).toHaveValue('110'); await expect(page.getByTestId('food-name-2')).toHaveCount(0);
});

test('中文补译可搜原文和旧名，新增皮蛋瘦肉粥保存刷新不丢来源', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click();
  for (const query of ['分层甜品', 'parfait']) {
    await page.getByTestId('food-picker-search').fill(query);
    const yogurt = page.getByTestId('food-option-fdc-2705450'); await expect(yogurt).toContainText('酸奶分层甜品'); await expect(yogurt).toContainText('Yogurt parfait, with fruit');
  }
  await page.getByTestId('food-picker-search').fill('皮蛋瘦肉粥'); await page.getByTestId('food-option-century-egg-pork-porridge').click(); await page.getByTestId('manual-food-weight').fill('300'); await page.getByTestId('confirm-manual-food').click();
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', 'century-egg-pork-porridge'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload();
  await expect(page.getByTestId('meal-record')).toContainText('皮蛋瘦肉粥'); await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('300');
});

test('包装中文名和原商品名同时展示并可检索，选择后仍按原标签换算', async ({ page }, info) => {
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-category-包装食品').click();
  for (const query of ['可可慕斯', 'Kakao-Mousse']) {
    await page.getByTestId('food-picker-search').fill(query);
    const chocolate = page.getByTestId('food-option-package:off-4000417294005'); await expect(chocolate).toContainText('可可慕斯'); await expect(chocolate).toContainText('原名：Kakao-Mousse');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  if (info.project.name === 'Chrome 手机' && !process.env.SHIKE_E2E_APK_ASSETS) await page.getByTestId('food-picker').screenshot({ path: 'docs/screenshots/chinese-labels-mobile.png' });
  await page.getByTestId('food-option-package:off-4000417294005').click(); await page.getByTestId('package-unit-0').selectOption('g'); await page.getByTestId('package-amount-0').fill('30'); await page.getByTestId('confirm-manual-food').click(); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload();
  await expect(page.getByTestId('meal-record')).toContainText('可可慕斯'); await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('package-amount-0')).toHaveValue('30'); await expect(page.getByTestId('package-unit-0')).toHaveValue('g');
});
