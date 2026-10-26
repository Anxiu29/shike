import { test, expect, type Page } from '@playwright/test';

async function tab(page: Page, name: 'diary' | 'goals' | 'settings') {
  const mobile = page.getByTestId(`tab-${name}`);
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}
async function manualBudget(page: Page) {
  await page.goto('/'); await tab(page, 'goals'); await page.getByTestId('goal-step-1').click();
  await page.getByTestId('calorie-mode').selectOption('manual'); await page.getByTestId('manual-calorie-goal').fill('1800');
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await tab(page, 'diary');
}
async function dailyForm(page: Page) {
  await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-method').selectOption('manual');
  await expect(page.getByTestId('exercise-scope')).toHaveValue('day');
}
async function save(page: Page) {
  await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-form')).not.toBeVisible();
}

test('手环保留完整读数，无个人资料时不增加预算，更新和备份恢复不全量叠加', async ({ page }, info) => {
  await manualBudget(page); await dailyForm(page);
  await expect(page.getByTestId('exercise-duration')).toHaveCount(0); await expect(page.getByTestId('exercise-name')).toHaveCount(0);
  await expect(page.getByTestId('exercise-device-reading')).toHaveCount(0); await expect(page.getByTestId('device-reading-help')).toHaveCount(0);
  await expect(page.getByTestId('exercise-day-budget')).toHaveCount(0);
  await expect(page.getByTestId('exercise-form')).not.toContainText('全天活动水平已包含通常的运动');
  await expect(page.getByTestId('exercise-form')).not.toContainText('只填预算之外');
  await expect(page.getByTestId('daily-activity-help')).toContainText('默认不含静息');
  await expect(page.getByTestId('exercise-include-budget')).toBeChecked();
  await page.getByTestId('exercise-manual-kcal').fill('500');
  if (info.project.name === 'Chrome 手机') {
    await page.locator('.sheet-body').evaluate(element => element.scrollTop = 0);
    await page.getByTestId('exercise-sheet').screenshot({ path: 'docs/screenshots/device-activity-mobile.png' });
  }
  await save(page); await expect(page.getByTestId('exercise-minutes-total')).toHaveText('—');
  await expect(page.getByTestId('exercise-calories-total')).toContainText('500'); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0');
  await expect(page.getByTestId('remaining-calories')).toContainText('1,800'); await expect(page.getByTestId('daily-budget-summary')).toContainText('500');
  await dailyForm(page); await expect(page.getByTestId('exercise-manual-kcal')).toHaveValue('500');
  await expect(page.getByTestId('exercise-day-budget')).toHaveCount(0); await expect(page.getByTestId('daily-activity-update')).toBeVisible();
  await page.getByTestId('exercise-manual-kcal').fill('650'); await save(page);
  await page.reload(); await expect(page.getByTestId('exercise-calories-total')).toContainText('650'); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0');
  await page.getByTestId('open-exercise-history').click(); await expect(page.getByTestId('exercise-record')).toHaveCount(1);
  await expect(page.getByTestId('exercise-record')).toContainText('当天累计 · 未记时'); await page.getByTestId('close-sheet').click();
  await tab(page, 'settings'); const pending = page.waitForEvent('download'); await page.getByTestId('export-backup').click();
  const stream = await (await pending).createReadStream(); if (!stream) throw new Error('没有备份流');
  const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part)); const buffer = Buffer.concat(parts), backup = JSON.parse(buffer.toString());
  expect(backup.schemaVersion).toBe(10); expect(backup.exercises).toHaveLength(1);
  expect(backup.exercises[0]).toMatchObject({ manualScope: 'day', deviceReading: 'active', minutes: null, activeKcal: 650, dayBudgetKcal: 650 });
  await tab(page, 'diary'); await page.getByTestId('open-exercise-history').click(); await page.getByTestId('delete-exercise').click();
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0');
  await tab(page, 'settings'); await page.getByTestId('backup-input').setInputFiles({ name: 'activity.json', mimeType: 'application/json', buffer });
  await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复');
  await tab(page, 'diary'); await expect(page.getByTestId('exercise-calories-total')).toContainText('650'); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0');
});

test('全天累计覆盖步行但俯卧撑另计；关闭计入或删除汇总后保留单项预算', async ({ page }) => {
  await manualBudget(page); await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-weight').fill('70'); await save(page);
  await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-activity').selectOption('02022');
  await page.getByTestId('exercise-weight').fill('70'); await page.getByTestId('exercise-count').fill('30'); await save(page);
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 74.9');
  await dailyForm(page);
  await page.getByTestId('exercise-manual-kcal').fill('500'); await save(page);
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 74.9'); await expect(page.getByTestId('exercise-calories-total')).toContainText('504.9');
  await expect(page.getByTestId('daily-budget-summary')).toContainText('俯卧撑另计 4.9');
  await expect(page.getByTestId('exercise-minutes-total')).toHaveText('31.5'); await expect(page.getByTestId('pushup-count-total')).toContainText('30 个');
  await page.getByTestId('open-exercise-history').click(); const daily = page.getByTestId('exercise-record').filter({ hasText: '当天累计活动' });
  await expect(page.getByTestId('exercise-record')).toHaveCount(3); await daily.getByTestId('edit-exercise').click();
  await page.getByTestId('exercise-include-budget').uncheck(); await expect(page.getByTestId('exercise-day-budget')).toHaveCount(0);
  // 关闭计入后仍能更新读数，但不会增加饮食预算。
  await page.getByTestId('exercise-manual-kcal').fill('50'); await save(page);
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 74.9'); await expect(page.getByTestId('exercise-calories-total')).toContainText('54.9');
  await dailyForm(page); await expect(page.getByTestId('exercise-include-budget')).not.toBeChecked(); await page.getByTestId('save-exercise').click();
  await expect(page.getByTestId('exercise-form')).not.toBeVisible(); await page.reload(); await page.getByTestId('open-exercise-history').click();
  await daily.getByTestId('delete-exercise').click(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 74.9');
  await expect(page.getByTestId('exercise-calories-total')).toContainText('74.9'); await expect(page.getByTestId('daily-activity-note')).toHaveCount(0);
});
