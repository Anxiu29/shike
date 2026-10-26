import { test, expect, type Page } from '@playwright/test';
async function tab(page: Page, name: 'diary' | 'goals' | 'weight') {
  const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}
test('快捷饮水可撤销，弹窗支持 Escape 关闭、恢复焦点和锁定背景', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  await page.getByTestId('add-cup').click(); await expect(page.getByTestId('water-total')).toHaveText('250');
  await page.getByTestId('toast-undo').click(); await expect(page.getByTestId('water-total')).toHaveText('0');
  await page.getByTestId('open-water').click(); await expect(page.getByTestId('water-sheet')).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Tab'); await expect(page.getByTestId('close-sheet')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.getAttribute('data-testid'))).toBe('water-sheet');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('water-sheet')).not.toBeVisible();
  await expect(page.getByTestId('open-water')).toBeFocused(); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.getByTestId('open-water').click(); await page.getByTestId('custom-water').fill('180.5'); await page.getByTestId('save-custom-water').click();
  await page.getByTestId('sheet-undo-water').click(); await expect(page.getByTestId('water-total')).toHaveText('0');
});
test('目标分组填写，切页保留未保存输入，错误自动定位到对应分组', async ({ page }) => {
  await page.goto('/'); await tab(page, 'goals');
  await page.getByTestId('enable-profile').check(); await page.getByTestId('profile-age').fill('30');
  await page.getByTestId('profile-height').fill('175'); await page.getByTestId('profile-weight').fill('70');
  await tab(page, 'diary'); await tab(page, 'goals'); await expect(page.getByTestId('profile-height')).toHaveValue('175');
  await page.getByTestId('goal-step-2').click(); await page.getByTestId('water-goal').fill('100'); await page.getByTestId('save-goals').click();
  await expect(page.getByTestId('goals-error')).toContainText('250–6000'); await expect(page.getByTestId('water-goal')).toBeFocused();
  await page.getByTestId('water-goal').fill('1800'); await page.getByTestId('save-goals').click();
  // 保存中也会禁用按钮；等待事务成功提示后才能刷新，避免把“正在保存”误认作“已保存”。
  await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await expect(page.getByTestId('save-goals')).toBeDisabled();
  await page.reload(); await tab(page, 'goals'); await page.getByTestId('goal-step-2').click(); await expect(page.getByTestId('water-goal')).toHaveValue('1800');
});
test('运动快捷时长和稍后继续保留输入，短视口下弹窗内容可滚动且保存可达', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('add-exercise').click();
  await page.getByTestId('exercise-weight').fill('70'); await page.getByTestId('duration-45').click();
  await page.getByTestId('close-sheet').click(); await page.getByTestId('add-exercise').click(); await expect(page.getByTestId('exercise-duration')).toHaveValue('45');
  await page.setViewportSize({ width: 360, height: 480 });
  await expect(page.getByTestId('save-exercise')).toBeInViewport();
  await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-minutes-total')).toHaveText('45');
  await page.getByTestId('open-exercise-history').click(); await page.getByTestId('delete-exercise').click();
  await expect(page.getByTestId('exercise-minutes-total')).toHaveText('0'); await page.getByTestId('toast-undo').click(); await expect(page.getByTestId('exercise-minutes-total')).toHaveText('45');
  await page.setViewportSize({ width: 320, height: 720 });
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport);
});
