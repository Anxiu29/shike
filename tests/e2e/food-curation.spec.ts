import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { test, expect, type Page } from '@playwright/test';
import { createFoodEntry, foods } from '@shike/shared';

async function tab(page: Page, name: 'diary' | 'settings') {
  await closeSettingsPanel(page);
  const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}

test('近似食物合并后按旧名称搜索只有代表项，选择保存与刷新正常', async ({ page }, info) => {
  await page.goto('/'); await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('短粒米饭');
  await page.getByTestId('manual-food-weight').fill('200'); await expect(page.getByTestId('manual-food-preview')).toContainText('白米饭');
  await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-name-0')).toHaveValue('白米饭（熟）');
  await page.getByTestId('food-source-0').click();
  for (const name of ['短粒米饭', '中粒米饭']) {
    await page.getByTestId('food-picker-search').fill(name); await expect(page.getByTestId('food-option-fdc-168878')).toBeVisible();
    await expect(page.getByTestId('food-option-fdc-168880')).toHaveCount(0); await expect(page.getByTestId('food-option-fdc-168882')).toHaveCount(0);
    await expect(page.getByTestId('food-result-count')).toHaveText('1 项');
  }
  if (info.project.name === 'Chrome 手机') await page.getByTestId('food-picker').screenshot({ path: 'docs/screenshots/food-curation-mobile.png' });
  await page.getByTestId('food-option-fdc-168878').click(); await expect(page.getByTestId('food-calories-0')).toContainText('260');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload();
  await expect(page.getByTestId('daily-calories')).toContainText('260'); await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', 'fdc-168878');
});

test('旧版米饭快照恢复后保留旧ID和蛋白质，不因合并被重算', async ({ page }) => {
  await page.goto('/'); const date = await page.getByTestId('diary-date').inputValue(), now = new Date().toISOString();
  const food = foods.find(item => item.id === 'fdc-168882')!, entry = createFoodEntry(food, 200);
  const backup = { schemaVersion: 8, exportedAt: now, settings: { targetWeightKg: null }, meals: [{ id: 'legacy-rice', date, mealType: 'lunch', items: [entry], mode: 'manual', createdAt: now, updatedAt: now }], weights: [], water: [], exercises: [], dailyPlans: [], estimatedFoods: [], packagedFoods: [] };
  await tab(page, 'settings'); await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: 'legacy-rice.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复'); await tab(page, 'diary');
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-name-0')).toHaveValue('短粒米饭（熟）');
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', food.id); await page.getByTestId('food-source-0').click();
  await expect(page.getByTestId('food-option-fdc-168882')).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await tab(page, 'settings');
  const pending = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click(); const stream = await (await pending).createReadStream(); if (!stream) throw Error('没有备份流');
  const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part)); const restored = JSON.parse(Buffer.concat(parts).toString()).meals[0].items[0];
  expect(restored.referenceId).toBe(food.id); expect(restored.nutrientsPer100g.proteinG).toBe(2.36); expect(restored.weightG).toBe(200); expect(restored.provenance).toContain('168882');
});
