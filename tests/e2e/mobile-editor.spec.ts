import { test, expect } from '@playwright/test';
import { openPhotoEditor } from './helpers/photo-editor';
test('手机餐食面板留出状态栏安全区，紧凑入口、短屏和滚动不遮住保存', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  // 模拟系统安全区；这验证网页布局，并不声称已在真实Android状态栏完成验收。
  await page.evaluate(() => { document.documentElement.style.setProperty('--app-safe-top', '32px'); document.documentElement.style.setProperty('--app-safe-bottom', '24px'); });
  await openPhotoEditor(page); const editor = page.getByTestId('food-editor'); await expect(editor).toBeVisible();
  const boxes = await editor.evaluate(element => ({ header: element.querySelector('.modal-header')!.getBoundingClientRect().top, capture: element.querySelector('.capture-area')!.getBoundingClientRect().height, model: element.querySelector('.recognition-model-picker')!.getBoundingClientRect().height })); expect(boxes.header).toBeGreaterThanOrEqual(32); expect(boxes.capture).toBeLessThan(190); expect(boxes.model).toBeLessThan(130);
  await expect(editor.locator('.modal-header .eyebrow')).not.toBeVisible(); await expect(editor.locator('.model-picker-help')).not.toHaveAttribute('open', ''); await expect(page.getByTestId('save-meal')).toBeInViewport(); await expect(page.getByTestId('save-meal')).toBeDisabled(); await expect(editor.locator('.footer-calories')).toContainText('—');
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/meal-editor-mobile.png' });
  await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('米饭'); await page.getByTestId('manual-food-weight').fill('100'); await page.getByTestId('confirm-manual-food').click(); await page.setViewportSize({ width: 360, height: 480 }); await expect(page.getByTestId('save-meal')).toBeInViewport();
  await editor.locator('.editor-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const final = await editor.evaluate(element => ({ note: element.querySelector('.editor-footnote')!.getBoundingClientRect().bottom, footer: element.querySelector('.editor-footer')!.getBoundingClientRect().top, height: element.getBoundingClientRect().height })); expect(final.note).toBeLessThanOrEqual(final.footer + 1); expect(final.height).toBeLessThanOrEqual(448);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.evaluate(() => { document.documentElement.style.removeProperty('--app-safe-top'); document.documentElement.classList.add('native-app'); }); await openPhotoEditor(page); expect(await page.locator('.modal-overlay').evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(24);
});
