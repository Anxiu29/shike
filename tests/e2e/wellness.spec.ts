import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { openManualMeal } from './helpers/manual-food';
import { test, expect, type Page } from '@playwright/test';

async function tab(page: Page, name: 'diary' | 'goals' | 'weight' | 'settings') {
  await closeSettingsPanel(page);
  const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}
async function openWater(page: Page) { if (!await page.getByTestId('water-sheet').isVisible()) await page.getByTestId('open-water').click(); await expect(page.getByTestId('water-sheet')).toBeVisible(); }
async function openExerciseHistory(page: Page) {
  // 保存事务结束前表单仍在弹窗中；先等保存完成，再重新打开历史。
  await expect(page.getByTestId('exercise-form')).not.toBeVisible();
  if (!await page.getByTestId('exercise-sheet').isVisible()) await page.getByTestId('open-exercise-history').click();
  await expect(page.getByTestId('exercise-sheet')).toBeVisible();
}
async function closeSheet(page: Page) { await page.getByTestId('close-sheet').click(); }
async function setupGoals(page: Page) {
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  await tab(page, 'goals'); await page.getByTestId('enable-profile').check();
  await page.getByTestId('profile-sex').selectOption('male'); await page.getByTestId('profile-age').fill('30');
  await page.getByTestId('profile-height').fill('175'); await page.getByTestId('profile-weight').fill('70');
  await page.getByTestId('goal-step-1').click();
  await page.getByTestId('purpose-lose').click(); await page.getByTestId('calorie-adjustment').fill('200');
  await page.getByTestId('goal-step-2').click();
  await page.getByTestId('water-goal').fill('1800'); await page.getByTestId('exercise-goal').fill('30'); await page.getByTestId('goal-target-weight').fill('65');
  await expect(page.getByTestId('budget-preview')).toContainText('2,108.25');
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await tab(page, 'diary');
}

test('个人资料生成预算，饮水杯子与自定义量可增删改并刷新恢复，目标和备份兼容', async ({ page }, info) => {
  await setupGoals(page);
  await expect(page.getByTestId('base-calorie-budget')).toContainText('2,108.25');
  await openWater(page); await page.getByTestId('cup-350').click(); await page.getByTestId('sheet-add-cup').click(); await expect(page.getByTestId('water-total')).toHaveText('350');
  await openWater(page); await page.getByTestId('custom-water').fill('175.5'); await page.getByTestId('save-custom-water').click();
  await expect(page.getByTestId('water-total')).toHaveText('525.5');
  await page.getByTestId('edit-water').first().click(); await page.getByTestId('custom-water').fill('200.25'); await page.getByTestId('save-custom-water').click();
  await expect(page.getByTestId('water-total')).toHaveText('550.25');
  await page.getByTestId('delete-water').first().click(); await expect(page.getByTestId('water-total')).toHaveText('350');
  await page.reload(); await expect(page.getByTestId('water-total')).toHaveText('350');
  await expect(page.getByRole('progressbar', { name: '饮水目标进度' })).toBeVisible();
  if (info.project.name === 'Chrome 手机') await page.getByTestId('daily-wellness').screenshot({ path: '.data-cache/wellness-mobile.png' });
  await tab(page, 'weight'); await expect(page.getByTestId('target-weight')).toHaveValue('65');
  await page.getByTestId('target-weight').fill('64'); await page.getByTestId('save-target').click();
  await tab(page, 'goals'); await expect(page.getByTestId('profile-height')).toHaveValue('175'); await expect(page.getByTestId('water-goal')).toHaveValue('1800');
  await tab(page, 'settings');
  const downloaded = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click(); const download = await downloaded;
  const stream = await download.createReadStream(); if (!stream) throw new Error('没有备份内容');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(backup.schemaVersion).toBe(10); expect(backup.water).toHaveLength(1); expect(backup.settings.personalInfo.heightCm).toBe(175);
  await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: 'wellness.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByTestId('backup-preview')).toContainText('1 条饮水'); await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复');
  await tab(page, 'diary'); await expect(page.getByTestId('water-total')).toHaveText('350');
});

test('新运动默认计入额外预算，可关闭，编辑保留选择并支持删除', async ({ page }) => {
  await setupGoals(page); await page.getByTestId('add-exercise').click();
  await expect(page.getByTestId('exercise-include-budget')).toBeChecked();
  await page.getByTestId('exercise-include-budget').uncheck();
  await expect(page.getByTestId('exercise-weight')).toHaveValue('70'); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('exercise-calories-total')).toContainText('70 kcal'); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0 kcal');
  await openExerciseHistory(page); await page.getByTestId('edit-exercise').click(); await expect(page.getByTestId('exercise-include-budget')).not.toBeChecked(); await page.getByTestId('exercise-include-budget').check(); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('remaining-calories')).toContainText('2,178.25');
  await openExerciseHistory(page); await page.getByTestId('edit-exercise').click(); await page.getByTestId('exercise-duration').fill('60'); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('exercise-calories-total')).toContainText('140 kcal');
  await page.reload(); await openExerciseHistory(page); await expect(page.getByTestId('exercise-record')).toContainText('60 分钟'); await closeSheet(page);
  await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-method').selectOption('manual'); await page.getByTestId('exercise-scope').selectOption('session');
  await expect(page.getByTestId('exercise-include-budget')).toBeChecked(); await page.getByTestId('exercise-include-budget').uncheck();
  await page.getByTestId('exercise-name').fill('游泳'); await page.getByTestId('exercise-manual-kcal').fill('123.45'); await page.getByTestId('save-exercise').click();
  await openExerciseHistory(page); await expect(page.getByTestId('exercise-record')).toHaveCount(2); await expect(page.getByTestId('exercise-calories-total')).toContainText('263.45');
  await page.getByTestId('exercise-record').filter({ hasText: '平地步行' }).getByTestId('delete-exercise').click();
  await expect(page.getByTestId('remaining-calories')).toContainText('2,108.25');
});

test('已知摄入扣除预算，缺失热量不显示剩余，手动目标和历史日期独立', async ({ page }) => {
  await setupGoals(page);
  const initialDate = await page.getByTestId('diary-date').inputValue();
  await openManualMeal(page); await page.getByTestId('food-name-0').fill('测试食物'); await page.getByTestId('food-weight-0').fill('100');
  await page.getByTestId('nutrition-details-0').locator('summary').click(); await page.getByTestId('food-energyKcal-0').fill('200'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('remaining-calories')).toContainText('1,908.25');
  await openManualMeal(page); await page.getByTestId('food-name-0').fill('未知食物'); await page.getByTestId('food-weight-0').fill('50'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('budget-incomplete')).toContainText('1 项'); await expect(page.getByTestId('remaining-calories')).toContainText('—');
  await page.getByTestId('previous-date').click(); const previousDate = await page.getByTestId('diary-date').inputValue(); expect(previousDate).not.toBe(initialDate);
  await page.getByTestId('add-cup').click(); await expect(page.getByTestId('water-total')).toHaveText('250');
  await page.getByTestId('next-date').click(); await expect(page.getByTestId('diary-date')).toHaveValue(initialDate); await expect(page.getByTestId('water-total')).toHaveText('0');
  await tab(page, 'goals'); await page.getByTestId('goal-step-1').click(); await page.getByTestId('calorie-mode').selectOption('manual'); await page.getByTestId('manual-calorie-goal').fill('1800'); await page.getByTestId('save-goals').click();
  await expect(page.getByTestId('toast')).toContainText('目标已保存'); await tab(page, 'diary'); await expect(page.getByTestId('base-calorie-budget')).toContainText('1,800');
  await page.getByTestId('previous-date').click(); await expect(page.getByTestId('base-calorie-budget')).toHaveCount(0);
  await expect(page.getByTestId('calorie-budget')).toContainText('使用已保存的当日资料与目标');
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport);
});

test('目标体重偏低时暂停自动减重预算，饮水等日常记录仍可用', async ({ page }) => {
  await setupGoals(page); await tab(page, 'goals');
  await page.getByTestId('goal-target-weight').fill('50');
  await expect(page.getByTestId('budget-preview')).toContainText('体重偏低');
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('目标已保存');
  await tab(page, 'diary'); await expect(page.getByTestId('calorie-budget')).toContainText('暂停自动减重预算');
  await expect(page.getByTestId('remaining-calories')).toContainText('—');
  await page.getByTestId('add-cup').click(); await expect(page.getByTestId('water-total')).toHaveText('250');
});
