import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { test, expect, type Page } from '@playwright/test';
async function tab(page: Page, name: 'diary' | 'goals' | 'settings') {
  await closeSettingsPanel(page); const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click(); }
test('超出预算后按已完成俯卧撑记录，更新预算、编辑次数、刷新与备份恢复', async ({ page }, info) => {
  await page.goto('/'); await tab(page, 'goals'); await page.getByTestId('goal-step-1').click(); await page.getByTestId('calorie-mode').selectOption('manual'); await page.getByTestId('manual-calorie-goal').fill('1800'); await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await tab(page, 'diary');
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('超额测试餐'); await page.getByTestId('manual-food-weight').fill('200'); await page.locator('.manual-food-nutrition summary').click(); await page.getByTestId('manual-food-energyKcal').fill('1000'); await page.getByTestId('confirm-manual-food').click(); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('remaining-calories')).toContainText('200'); await page.getByTestId('record-extra-exercise').click(); await expect(page.getByTestId('exercise-activity')).toHaveValue('02022'); await expect(page.getByTestId('exercise-count')).toHaveValue(''); await expect(page.getByTestId('exercise-duration')).toHaveCount(0); await expect(page.getByTestId('exercise-include-budget')).toBeChecked();
  await page.getByTestId('exercise-weight').fill('70'); await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-error')).toContainText('整数'); await page.getByTestId('repetitions-30').click(); await expect(page.getByTestId('exercise-preview')).toContainText('4.9');
  if (info.project.name === 'Chrome 手机') await page.getByTestId('exercise-sheet').screenshot({ path: 'docs/screenshots/pushups-mobile.png' });
  await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 4.9'); await expect(page.getByTestId('remaining-calories')).toContainText('195.1'); await expect(page.getByTestId('pushup-count-total')).toContainText('30 个');
  await page.reload(); await page.getByTestId('open-exercise-history').click(); await expect(page.getByTestId('exercise-record')).toContainText('30 个'); await page.getByTestId('edit-exercise').click(); await expect(page.getByTestId('exercise-count')).toHaveValue('30'); await page.getByTestId('exercise-count').fill('50'); await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('8.17');
  await tab(page, 'settings'); const pending = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click(); const stream = await (await pending).createReadStream(); if (!stream) throw new Error('没有备份'); const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part)); const buffer = Buffer.concat(parts), backup = JSON.parse(buffer.toString());
  expect(backup.schemaVersion).toBe(11); expect(backup.exercises[0].repetitionSnapshot).toEqual({ count: 50, secondsPerRep: 3, formulaVersion: 'repetitions-met-v1' });
  await tab(page, 'diary'); await page.getByTestId('open-exercise-history').click(); await page.getByTestId('delete-exercise').click(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0');
  await tab(page, 'settings'); await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: 'pushups.json', mimeType: 'application/json', buffer }); await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复'); await tab(page, 'diary'); await expect(page.getByTestId('pushup-count-total')).toContainText('50 个'); await expect(page.getByTestId('exercise-budget-credit')).toContainText('8.17');
});

test('不足一分钟按次数保存，节奏可改，普通运动不带次数且可关闭计入预算', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-activity').selectOption('02022'); await page.getByTestId('exercise-weight').fill('70'); await expect(page.getByTestId('exercise-include-budget')).toBeChecked(); await page.getByTestId('exercise-include-budget').uncheck(); await page.getByTestId('exercise-count').fill('1.5'); await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-error')).toBeVisible();
  await page.getByTestId('exercise-count').fill('1'); await page.locator('.repetition-timing summary').click(); await page.getByTestId('exercise-seconds-per-rep').fill('4'); await expect(page.getByTestId('exercise-preview')).toContainText('0.22'); await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0');
  await page.getByTestId('open-exercise-history').click(); await expect(page.getByTestId('exercise-record')).toContainText('1 个'); await expect(page.getByTestId('exercise-record')).toContainText('4 秒／个'); await page.getByTestId('edit-exercise').click(); await page.getByTestId('exercise-activity').selectOption('17170'); await expect(page.getByTestId('exercise-count')).toHaveCount(0); await expect(page.getByTestId('exercise-duration')).toHaveValue('30'); await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await page.getByTestId('open-exercise-history').click(); await expect(page.getByTestId('exercise-record')).toContainText('30 分钟'); await expect(page.getByTestId('exercise-record')).not.toContainText('秒／个');
});

test('首页俯卧撑快捷按个数添加，独立草稿不覆盖普通运动，有手环累计仍额外计入', async ({ page }, info) => {
  await page.goto('/'); await tab(page, 'goals'); await page.getByTestId('goal-step-1').click();
  await page.getByTestId('calorie-mode').selectOption('manual'); await page.getByTestId('manual-calorie-goal').fill('1800'); await page.getByTestId('save-goals').click();
  await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await tab(page, 'diary');
  // 普通运动有未完成草稿时，快捷记录不能将它覆盖。
  await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-method').selectOption('manual'); await page.getByTestId('exercise-scope').selectOption('session');
  await page.getByTestId('exercise-name').fill('未保存的散步'); await page.getByTestId('exercise-manual-kcal').fill('20'); await page.getByTestId('close-sheet').click();
  await expect(page.getByTestId('daily-summary').getByTestId('add-pushups')).toHaveCount(1);
  await expect(page.getByTestId('exercise-card').getByTestId('add-pushups')).toHaveCount(0);
  await expect(page.getByTestId('add-pushups')).toHaveText(''); await expect(page.getByRole('button', { name: '添加俯卧撑', exact: true })).toBeVisible();
  await page.getByTestId('add-pushups').click(); await expect(page.getByTestId('pushup-quick-sheet')).toBeVisible();
  await expect(page.getByTestId('pushup-quick-form').locator('select:visible')).toHaveCount(0); await expect(page.getByTestId('pushup-quick-include-budget')).toBeChecked();
  await page.getByTestId('pushup-quick-weight').fill('70'); await page.getByTestId('save-pushups').click(); await expect(page.getByTestId('pushup-quick-error')).toContainText('整数');
  await page.getByTestId('pushup-quick-30').click(); await page.getByTestId('close-sheet').click();
  await page.getByTestId('add-pushups').click(); await expect(page.getByTestId('pushup-quick-count')).toHaveValue('30');
  await expect(page.getByTestId('pushup-quick-preview')).toContainText('4.9');
  if (info.project.name === 'Chrome 手机') await page.getByTestId('pushup-quick-sheet').screenshot({ path: 'docs/screenshots/pushups-quick-mobile.png' });
  await page.getByTestId('save-pushups').click(); await expect(page.getByTestId('pushup-quick-sheet')).not.toBeVisible(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 4.9');
  await page.getByTestId('add-exercise').click(); await expect(page.getByTestId('exercise-name')).toHaveValue('未保存的散步'); await expect(page.getByTestId('exercise-manual-kcal')).toHaveValue('20');
  await page.getByTestId('exercise-scope').selectOption('day'); await page.getByTestId('exercise-manual-kcal').fill('500'); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 504.9');
  await page.getByTestId('add-pushups').click(); await expect(page.getByTestId('pushup-quick-count')).toHaveValue(''); await expect(page.getByTestId('pushup-quick-weight')).toHaveValue('70');
  await page.getByTestId('pushup-quick-20').click(); await page.getByTestId('save-pushups').click(); await expect(page.getByTestId('pushup-quick-sheet')).not.toBeVisible();
  await expect(page.getByTestId('pushup-count-total')).toContainText('50 个'); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 508.17');
  await page.reload(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 508.17');
  await page.getByTestId('open-exercise-history').click(); const first = page.getByTestId('exercise-record').filter({ hasText: '30 个' });
  await first.getByTestId('delete-exercise').click(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 503.27');
  await expect(page.getByTestId('pushup-count-total')).toContainText('20 个');
});
