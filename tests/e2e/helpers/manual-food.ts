import { expect, type Page } from '@playwright/test';
/** 打开一餐草稿，后续场景可继续验证原有名称编辑、食物选择和营养换算。 */
export async function openManualMeal(page: Page, name = '手动测试食物') {
  await page.getByTestId('manual-add').click();
  await page.getByTestId('food-picker-manual').click();
  await page.getByTestId('manual-food-name').fill(name);
  await page.getByTestId('confirm-manual-food').click();
  await expect(page.getByTestId('manual-food-sheet')).toHaveCount(0);
}
