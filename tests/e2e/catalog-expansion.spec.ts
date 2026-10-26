import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { test, expect, type Page } from '@playwright/test';
import { builtinPackagedFoods } from '@shike/shared';

async function tab(page: Page, name: 'diary' | 'settings') {
  await closeSettingsPanel(page);
  const button = page.getByTestId(`tab-${name}`); await (await button.isVisible() ? button : page.getByTestId(`desktop-tab-${name}`)).click();
}
async function backup(page: Page) {
  await tab(page, 'settings'); const pending = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click();
  const stream = await (await pending).createReadStream(); if (!stream) throw new Error('备份下载失败');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

test('内置包装按分类、品牌和条码离线选用，容量换算和来源随餐保存', async ({ page }, info) => {
  let requests = 0;
  await page.route('**/api/packaged-foods/**', route => { requests++; return route.abort(); });
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-category-包装食品').click();
  await page.getByTestId('package-filter-奶与植物奶').click();
  await expect(page.getByTestId('food-result-count')).toHaveText(`${builtinPackagedFoods.filter(item => item.category === '奶与植物奶').length} 项`);
  await page.getByTestId('food-picker-search').fill('特仑苏');
  const milk = page.getByTestId('food-option-package:off-6923644266066'); await expect(milk).toContainText('每100 mL');
  if (info.project.name === 'Chrome 手机') await page.getByTestId('food-picker').screenshot({ path: 'docs/screenshots/packaged-catalog-mobile.png' });
  await page.getByTestId('food-picker-search').fill('6923644266066'); await milk.click();
  await expect(page.getByTestId('package-amount-0')).toHaveValue(''); await page.getByTestId('package-unit-0').selectOption('ml'); await page.getByTestId('package-amount-0').fill('250');
  await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-calories-0')).toContainText('184.63'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload(); await expect(page.getByTestId('daily-calories')).toContainText('184.63');
  const data = await backup(page); expect(data.packagedFoods).toHaveLength(0);
  expect(data.meals[0].items[0].weightG).toBeNull(); expect(data.meals[0].items[0].packageSnapshot.consumedUnit).toBe('ml'); expect(data.meals[0].items[0].packageSnapshot.source.license).toBe('ODbL-1.0'); expect(requests).toBe(0);
});

test('包装库内置商品可离线查条码，显式保存后同条码只保留个人标签', async ({ page }) => {
  let requests = 0; await page.route('**/api/packaged-foods/**', route => { requests++; return route.abort(); });
  await page.goto('/'); await tab(page, 'settings'); await page.getByTestId('manage-packaged-foods').click();
  await expect(page.getByTestId('packaged-library-row')).toHaveCount(0); await expect(page.getByTestId('public-packaged-row')).toHaveCount(12);
  await page.getByTestId('package-library-search').fill('6921168558049'); await expect(page.getByTestId('public-packaged-row')).toHaveCount(1);
  await page.getByTestId('public-packaged-row').getByRole('button').click(); await expect(page.getByTestId('catalog-preview')).toContainText('东方树叶'); await expect(page.getByTestId('catalog-preview')).toBeInViewport();
  await page.getByTestId('catalog-barcode').fill('6921168558049'); await page.getByTestId('catalog-query').click(); await expect(page.getByTestId('catalog-message')).toContainText('内置商品参考');
  await page.getByTestId('save-catalog-product').click(); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1); await expect(page.getByTestId('public-packaged-row')).toHaveCount(0);
  await page.getByTestId('close-sheet').click(); const data = await backup(page); expect(data.packagedFoods).toHaveLength(1); expect(data.packagedFoods[0].barcode).toBe('6921168558049');
  await tab(page, 'diary'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-category-包装食品').click(); await page.getByTestId('food-picker-search').fill('6921168558049'); await expect(page.locator('[data-testid^="food-option-package:"]')).toHaveCount(1); expect(requests).toBe(0);
});

test('新增游泳与跳绳可估算编辑，刷新与备份保留项目和计算快照', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('add-exercise').click();
  await expect(page.getByTestId('exercise-activity').locator('optgroup')).toHaveCount(5); await expect(page.getByTestId('exercise-activity').locator('option')).toHaveCount(32);
  await page.getByTestId('exercise-activity').selectOption('18265'); await page.getByTestId('exercise-weight').fill('70'); await page.getByTestId('exercise-duration').fill('30'); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await expect(page.getByTestId('exercise-calories-total')).toContainText('150.5');
  await page.getByTestId('open-exercise-history').click(); await expect(page.getByTestId('exercise-record')).toContainText('蛙泳'); await page.getByTestId('edit-exercise').click(); await page.getByTestId('exercise-activity').selectOption('15552'); await page.getByTestId('exercise-duration').fill('10'); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await page.reload(); await expect(page.getByTestId('exercise-calories-total')).toContainText('85.17');
  const data = await backup(page); expect(data.exercises).toHaveLength(1); expect(data.exercises[0]).toMatchObject({ activityCode: '15552', met: 8.3, weightKg: 70, includeInBudget: true });
});

test('扩展包装库按页展示、细分类和中文品牌搜索，不联网也能找到新增商品', async ({ page }) => {
  let calls = 0; await page.route('**/api/packaged-foods/**', route => { calls++; return route.abort(); });
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-category-包装食品').click();
  await expect(page.getByTestId('food-result-count')).toHaveText(`${builtinPackagedFoods.length} 项`);
  await expect(page.locator('[data-testid^="food-option-package:"]')).toHaveCount(60); await page.getByTestId('food-load-more').click(); await expect(page.locator('[data-testid^="food-option-package:"]')).toHaveCount(120);
  await page.getByTestId('package-filter-面包与糕点').click();
  await expect(page.getByTestId('food-result-count')).toHaveText(`${builtinPackagedFoods.filter(item => item.category === '面包与糕点').length} 项`);
  await page.getByTestId('package-filter-全部商品').click(); await page.getByTestId('food-picker-search').fill('乐事');
  await expect(page.locator('[data-testid^="food-option-package:"]').first()).toBeVisible();
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport); expect(calls).toBe(0);
});
