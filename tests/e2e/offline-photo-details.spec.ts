import { test, expect } from '@playwright/test';
import { setupOfflineImage, openOfflineLabel, offlineLabelFixture } from './helpers/offline-photo';
import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';

test('本机估重进入待核对清单，保留未知，修改后保存及刷新恢复，不请求云端', async ({ page }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await setupOfflineImage(page); await page.getByTestId('photo-lunch').click();
  await expect(page.getByTestId('recognition-summary')).toContainText('2 项照片估重（试验）');
  await expect(page.getByTestId('photo-offline-detail')).toHaveValue('estimate');
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('food-weight-2')).toHaveValue('');
  await expect(page.getByTestId('food-calories-2')).toHaveText('待补充');
  await page.getByTestId('food-weight-0').fill('170'); await expect(page.getByTestId('recognition-weight-0')).toContainText('已手动调整');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__offlinePhotoCalls[0].task)).toBe('food_estimate');
  for (const width of [320, 390, 820, 1440]) { await page.setViewportSize({ width, height: 800 }); expect(await page.getByTestId('food-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); }
  if (test.info().project.name === 'Chrome 手机') { await page.setViewportSize({ width: 390, height: 844 }); await page.getByTestId('recognition-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/android/offline-photo-estimate-mobile.png' }); }
  await page.getByTestId('save-meal').click(); await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await expect(page.getByTestId('view-meal-photo')).toBeVisible();
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('170'); await expect(page.getByTestId('food-weight-2')).toHaveValue('');
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0); expect(posts).toEqual([]);
});

test('本机标签保留kJ与零，未默认吃整包，修正后保存包装库及备份恢复', async ({ page }) => {
  test.setTimeout(60_000);
  await setupOfflineImage(page); await openOfflineLabel(page, offlineLabelFixture);
  await expect(page.getByTestId('package-label-0')).toContainText('本机识读（试验）'); await expect(page.getByTestId('package-label-0')).toContainText('2,092 kJ');
  await expect(page.getByTestId('package-amount-0')).toHaveValue(''); await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
  expect(await page.evaluate(() => (window as any).__offlinePhotoCalls[0].task)).toBe('package_label');
  await page.getByTestId('package-correction-0').locator('summary').click(); await expect(page.getByTestId('package-carbsG-0')).toHaveValue('0');
  await page.getByTestId('package-energy-0').fill('1673.6'); await page.getByTestId('package-half-0').click();
  await expect(page.getByTestId('food-calories-0')).toHaveText('约 200 kcal');
  if (test.info().project.name === 'Chrome 手机') { await page.getByTestId('package-label-0').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/android/offline-label-mobile.png' }); }
  await page.getByTestId('save-package-library-0').click(); await page.getByTestId('confirm-save-package').click();
  await expect(page.getByTestId('packaged-library-row')).toContainText('测试饼干'); await page.getByTestId('packaged-library').getByTestId('close-sheet').click();
  await page.getByTestId('save-meal').click(); await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('0.5 包');
  await page.locator('[data-testid="tab-settings"]:visible, [data-testid="desktop-tab-settings"]:visible').click(); await openSettingsPanel(page, 'backup');
  await page.getByTestId('export-backup').click();
  await expect.poll(() => page.evaluate(() => (window as any).__backupText ?? '')).not.toBe('');
  const buffer = Buffer.from(await page.evaluate(() => (window as any).__backupText)), backup = JSON.parse(buffer.toString());
  expect(await page.evaluate(() => (window as any).__sharedFiles)).toEqual(['file:///mock-cache/backups/local-label.json']);
  expect(backup.meals[0].items[0].packageSnapshot).toMatchObject({ provider: 'offline', manuallyEdited: true, consumedAmount: 0.5, label: { energy: { value: 1673.6, unit: 'kJ' }, carbsG: 0 } });
  expect(backup.packagedFoods[0].provider).toBe('offline');
  await page.getByTestId('backup-input').setInputFiles({ name: 'local-label.json', mimeType: 'application/json', buffer }); await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复');
  await closeSettingsPanel(page); await page.locator('[data-testid="tab-diary"]:visible, [data-testid="desktop-tab-diary"]:visible').click();
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('package-amount-0')).toHaveValue('0.5');
  await page.getByTestId('package-correction-0').locator('summary').click(); await expect(page.getByTestId('package-energy-unit-0')).toHaveValue('kJ');
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0);
});

test('本机饮料标签不把mL当g，未知基准和单位保持空缺', async ({ page }) => {
  await setupOfflineImage(page); await openOfflineLabel(page, { ...offlineLabelFixture, name: '测试牛奶', basis: '100ml', netAmount: 250, netUnit: 'ml', servingAmount: null, servingUnit: null, energyValue: 250, proteinG: 3, fatG: 3, carbsG: 5 });
  await expect(page.getByTestId('package-unit-0')).toHaveValue('ml'); await page.getByTestId('package-amount-0').fill('200');
  await expect(page.getByTestId('food-calories-0')).toHaveText('约 119.5 kcal');
  await page.getByTestId('package-unit-0').selectOption('g'); await page.getByTestId('package-amount-0').fill('200');
  await expect(page.getByTestId('package-conversion-warning-0')).toContainText('mL 不会直接当作 g'); await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
  await page.getByTestId('save-meal').click(); await page.reload(); await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('package-unit-0')).toHaveValue('g');
  await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
});

test('坏JSON、重复食物和取消均保留已改草稿', async ({ page }) => {
  const jpeg = await setupOfflineImage(page); await page.getByTestId('photo-lunch').click(); await page.getByTestId('food-weight-0').fill('175');
  page.on('dialog', dialog => dialog.accept());
  for (const [text, message] of [['{"foods":[', '格式不完整'], ['{"foods":[{"name":"米饭","estimatedWeightG":10},{"name":"米饭","estimatedWeightG":20}]}', '重复食物']]) {
    await page.evaluate(text => { (window as any).__photoText = text; }, text); await page.getByTestId('gallery-input').setInputFiles({ name: 'bad.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.getByTestId('editor-error')).toContainText(message); await expect(page.getByTestId('food-weight-0')).toHaveValue('175');
  }
  await page.evaluate(() => { (window as any).__holdVision = true; }); await page.getByTestId('gallery-input').setInputFiles({ name: 'hold.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByTestId('offline-photo-stop').click(); await expect(page.getByTestId('editor-error')).toContainText('停止'); await expect(page.getByTestId('food-weight-0')).toHaveValue('175');
  expect(await page.evaluate(() => (window as any).__cloudPhotoCalls)).toBe(0); await expect(page.getByTestId('meal-record')).toHaveCount(0);
});

test('主动改为仅名称后沿用旧短清单流程，刷新仍保留选择', async ({ page }) => {
  await setupOfflineImage(page); await page.evaluate(() => { (window as any).__cameraCancelled = true; }); await page.getByTestId('photo-lunch').click();
  await page.getByTestId('photo-offline-detail').selectOption('names');
  await page.evaluate(() => { (window as any).__cameraCancelled = false; }); await page.getByTestId('system-photo-take').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue(''); await expect(page.getByTestId('recognition-summary')).toContainText('重量与份量待填写');
  expect(await page.evaluate(() => (window as any).__offlinePhotoCalls[0].namesOnly)).toBe(true);
  await page.reload(); await page.getByTestId('photo-lunch').click(); await expect(page.getByTestId('photo-offline-detail')).toHaveValue('names');
  await expect(page.getByTestId('food-weight-0')).toHaveValue('');
});

test('标签读不清时不伪造数字；部分可用时显示待补基准和原单位提示', async ({ page }) => {
  await setupOfflineImage(page); await openOfflineLabel(page, { ...offlineLabelFixture, energyValue: null, energyUnit: null, proteinG: null, fatG: null, carbsG: null });
  await expect(page.getByTestId('editor-error')).toContainText('没有读清可用的营养数值'); await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.evaluate(value => { (window as any).__photoText = JSON.stringify(value); }, { ...offlineLabelFixture, basis: 'unknown', energyUnit: null });
  await page.getByTestId('editor-error').getByRole('button', { name: '重试识别' }).click();
  await expect(page.getByTestId('package-label-0')).toContainText('基准待确认'); await expect(page.getByTestId('food-editor')).toContainText('能量读到 2092，原单位未读清');
  await page.getByTestId('package-correction-0').locator('summary').click(); await expect(page.getByTestId('package-energy-0')).toHaveValue('');
  await page.getByTestId('package-amount-0').fill('50'); await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
});
