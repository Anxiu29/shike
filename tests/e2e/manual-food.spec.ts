import { test, expect } from '@playwright/test';
import { findFood, parseOffProduct } from '@shike/shared';

test('添加弹窗直接选食物和包装标签，mL饮品刷新恢复并保留未知项', async ({ page }) => {
  let calls = 0; await page.route('**/api/recognitions', route => { calls++; return route.abort(); });
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await expect(page.getByTestId('food-picker')).toBeVisible(); await expect(page.getByTestId('food-category-包装食品')).toBeVisible();
  await page.getByTestId('food-picker-search').fill('米饭'); await page.getByTestId(`food-option-${findFood('米饭')!.id}`).click(); await expect(page.getByTestId('manual-food-name')).toHaveValue(findFood('米饭')!.name); await page.getByTestId('manual-food-weight').fill('100'); await page.getByTestId('confirm-manual-food').click();
  await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('自制牛奶饮品'); await page.getByTestId('manual-food-unit').selectOption('ml'); await page.getByTestId('manual-food-weight').fill('250'); await page.locator('.manual-food-nutrition summary').click(); await page.getByTestId('manual-food-energyKcal').fill('60'); await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-volume-1')).toHaveValue('250'); await expect(page.getByTestId('food-calories-1')).toContainText('150 kcal');
  await page.getByTestId('save-meal').click(); await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('250 mL'); await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-volume-1')).toHaveValue('250'); await page.getByTestId('nutrition-details-1').locator('summary').click(); await expect(page.getByTestId('food-proteinG-1')).toHaveValue(''); expect(calls).toBe(0);
});

test('手动添加的同一食物库能查询保存并选择包装食品，下次直接分类搜索复用', async ({ page }) => {
  const code = '3274080005003', product = parseOffProduct({ status: 'success', product: { code, product_name: '包装选库测试奶', brands: '选库品牌', quantity: '250 ml', nutriments: { 'energy-kcal_100g': 60 } } }, code)!;
  let requests = 0; await page.route('**/api/packaged-foods/**', route => { requests++; return route.fulfill({ json: { product } }); });
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-category-包装食品').click(); await page.getByTestId('picker-query-package').click(); await page.getByTestId('catalog-barcode').fill(code); await page.getByTestId('catalog-query').click(); await page.getByTestId('save-catalog-product').click(); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1); await page.getByTestId('use-catalog-product').click();
  await expect(page.getByTestId('manual-food-sheet')).toBeVisible(); await page.getByTestId('package-half-0').click(); await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-calories-0')).toContainText('75 kcal'); await page.getByTestId('save-meal').click();
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-category-包装食品').click(); await page.getByTestId('food-picker-search').fill('选库品牌'); const option = page.getByTestId(`food-option-package:${product.id}`); await expect(option).toContainText('每100 mL'); await option.click(); await expect(page.getByTestId('package-amount-0')).toHaveValue('250'); expect(requests).toBe(1);
});

test('手动添加弹窗填写后才加入，空名称提示、追加取消、保存刷新和本地匹配', async ({ page }, info) => {
  let aiCalls = 0; await page.route('**/api/recognitions', route => { aiCalls++; return route.abort(); });
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click();
  const sheet = page.getByTestId('manual-food-sheet'); await expect(sheet).toBeVisible(); await expect(sheet).toHaveAccessibleName('添加食物'); await expect(page.getByTestId('food-editor')).toHaveAttribute('inert', ''); await expect(page.locator('[data-testid^="food-item-"]')).toHaveCount(0);
  await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('manual-food-error')).toContainText('食物名称'); await expect(page.getByTestId('manual-food-name')).toBeFocused();
  await page.getByTestId('manual-food-name').fill('米饭'); await page.getByTestId('manual-food-weight').fill('150.25'); await expect(page.getByTestId('manual-food-preview')).toContainText('195.33 kcal');
  if (info.project.name === 'Chrome 手机') await sheet.screenshot({ path: 'docs/screenshots/manual-food-mobile.png' });
  await page.getByTestId('confirm-manual-food').click(); await expect(sheet).toHaveCount(0); await expect(page.locator('[data-testid^="food-item-"]')).toHaveCount(1); await expect(page.getByTestId('food-weight-0')).toHaveValue('150.25'); await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('取消的食物'); await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0); await expect(page.getByTestId('add-food')).toBeFocused(); await expect(page.locator('[data-testid^="food-item-"]')).toHaveCount(1); expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await page.reload(); await expect(page.getByTestId('daily-calories')).toContainText('195.33'); expect(aiCalls).toBe(0);
});

test('初次取消不留空餐食并解锁滚动，餐次加号保留日期餐次，缺重补常见份量', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('取消的草稿'); await page.getByTestId('cancel-manual-food').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(0); await expect(page.getByTestId('manual-add')).toBeFocused(); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.getByTestId('previous-date').click(); const date = await page.getByTestId('diary-date').inputValue(); await page.getByTestId('add-breakfast').click(); await page.getByTestId('food-picker-manual').click(); await expect(page.getByTestId('manual-food-weight')).toHaveValue(''); await page.getByTestId('manual-food-name').fill('未收录的自制食物'); await page.getByTestId('confirm-manual-food').click();
  await expect(page.getByTestId('editor-date')).toHaveValue(date); await expect(page.getByTestId('editor-meal-type')).toHaveValue('breakfast'); await expect(page.getByTestId('food-weight-0')).toHaveValue('200'); await expect(page.getByTestId('food-calories-0')).toHaveText('待补充'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-breakfast').getByTestId('meal-record')).toHaveCount(1); await expect(page.getByTestId('daily-summary')).toContainText('未补全');
});

test('弹窗可填确定营养值，短视口下可提交，未知宏量不补零', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 }); await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('米饭'); await page.getByTestId('manual-food-weight').fill('200'); await page.locator('.manual-food-nutrition summary').click(); await page.getByTestId('manual-food-energyKcal').fill('80');
  await expect(page.getByTestId('confirm-manual-food')).toBeInViewport(); await expect(page.getByTestId('manual-food-preview')).toContainText('160 kcal'); const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport);
  await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-calories-0')).toContainText('160 kcal'); await page.getByTestId('nutrition-details-0').locator('summary').click(); await expect(page.getByTestId('food-proteinG-0')).toHaveValue(''); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload(); await expect(page.getByTestId('daily-calories')).toContainText('160');
});
