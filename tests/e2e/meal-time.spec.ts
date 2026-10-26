import { test, expect, type Page } from '@playwright/test';
import { routeApkAssets } from './helpers/apk-assets';

test.use({ timezoneId: 'Asia/Shanghai' });
test.beforeEach(async ({ page }) => { await routeApkAssets(page); });

async function addRice(page: Page, button = 'manual-add') {
  await page.getByTestId(button).click();
  await page.getByTestId('food-picker-manual').click();
  await page.getByTestId('manual-food-name').fill('米饭');
  await page.getByTestId('confirm-manual-food').click();
  await expect(page.getByTestId('food-editor')).toBeVisible();
}
async function closeEditor(page: Page) {
  await page.getByRole('button', { name: '关闭记录面板', exact: true }).click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
}

test('普通添加用当前时段，跨时段不改草稿，历史餐次及指定餐次保持不变', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T10:59:00+08:00'));
  await page.goto('/'); await page.getByTestId('previous-date').click();
  const selectedDate = await page.getByTestId('diary-date').inputValue();
  await addRice(page);
  await expect(page.getByTestId('editor-meal-type')).toHaveValue('breakfast');
  await expect(page.getByTestId('editor-date')).toHaveValue(selectedDate);
  await page.clock.setFixedTime(new Date('2026-10-21T19:00:00+08:00'));
  await expect(page.getByTestId('editor-meal-type')).toHaveValue('breakfast');
  await page.getByTestId('save-meal').click(); await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('editor-meal-type')).toHaveValue('breakfast');
  await expect(page.getByTestId('editor-date')).toHaveValue(selectedDate); await closeEditor(page);
  await addRice(page); await expect(page.getByTestId('editor-meal-type')).toHaveValue('dinner');
  await expect(page.getByTestId('editor-date')).toHaveValue(selectedDate); await closeEditor(page);
  await addRice(page, 'add-lunch'); await expect(page.getByTestId('editor-meal-type')).toHaveValue('lunch');
});

test('拍照快捷入口按打开时间预选，相机手选能交接到编辑器', async ({ page }, info) => {
  const mobile = Boolean(info.project.use.isMobile);
  await page.clock.setFixedTime(new Date('2026-10-21T21:59:00+08:00'));
  await page.goto('/'); await page.getByTestId('hero-camera').click();
  if (mobile) {
    await expect(page.getByTestId('camera-meal-dinner')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('camera-meal-breakfast').click(); await page.getByTestId('camera-skip').click();
  } else {
    await expect(page.getByTestId('editor-meal-type')).toHaveValue('dinner');
    await page.getByTestId('editor-meal-type').selectOption('breakfast');
  }
  await expect(page.getByTestId('editor-meal-type')).toHaveValue('breakfast'); await closeEditor(page);
  await page.clock.setFixedTime(new Date('2026-10-21T22:00:00+08:00'));
  await page.getByTestId(mobile ? 'mobile-camera' : 'header-camera').click();
  if (mobile) {
    await expect(page.getByTestId('camera-meal-snack')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('close-camera').click();
  } else {
    await expect(page.getByTestId('editor-meal-type')).toHaveValue('snack');
  }
});
