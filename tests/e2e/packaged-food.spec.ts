import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { openPhotoEditor } from './helpers/photo-editor';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { emptyPackageLabel, type PackageLabel } from '@shike/shared';

// 隔离的合成包装标签，不是真实商品的营养标准，不消耗任何模型额度。
const cookie: PackageLabel = { basis: '100g', energy: { value: 2092, unit: 'kJ' }, proteinG: 8, fatG: 20, carbsG: 65, servingSize: { amount: 25, unit: 'g' }, netContent: { amount: 100, unit: 'g' } };
async function recognize(page: Page, labels: Array<{ name: string; label: PackageLabel }>) {
  await page.route('**/api/recognitions', route => route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'synthetic-label-test', result: { isFood: true, foods: labels.map(value => ({ name: value.name, estimatedWeightG: null, visibleIngredients: [], uncertainties: [], packageLabel: value.label })), uncertainties: [] } } }));
  await page.goto('/'); await openPhotoEditor(page);
  const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#eee' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '合成包装测试.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByTestId('package-label-0')).toBeVisible();
}
async function tab(page: Page, name: 'diary' | 'settings') {
  await closeSettingsPanel(page); const button = page.getByTestId(`tab-${name}`); await (await button.isVisible() ? button : page.getByTestId(`desktop-tab-${name}`)).click() }

test('包装kJ识别后填半包，修正标签、保存刷新和改克数，模拟来源保留', async ({ page }) => {
  await recognize(page, [{ name: '测试饼干', label: cookie }]);
  await expect(page.getByTestId('package-label-0')).toContainText('2,092 kJ');
  // 既有常见份量功能为饼干带入30g，明确提示估算；不会把100g整包净含量当作已吃完。
  await expect(page.getByTestId('package-amount-0')).toHaveValue('30'); await expect(page.getByTestId('food-calories-0')).toContainText('150 kcal');
  await expect(page.getByTestId('food-item-0')).toContainText('份量估算');
  await expect(page.getByTestId('food-weight-0')).toHaveCount(0);
  await page.getByTestId('package-half-0').click(); await expect(page.getByTestId('food-calories-0')).toContainText('250 kcal');
  await page.getByTestId('package-correction-0').locator('summary').click(); await page.getByTestId('package-energy-0').fill('1673.6');
  await expect(page.getByTestId('food-calories-0')).toContainText('200 kcal');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await expect(page.getByTestId('meal-record')).toContainText('0.5 包'); await expect(page.getByTestId('daily-mock')).toBeVisible();
  await page.reload(); await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('package-unit-0')).toHaveValue('package');
  await page.getByTestId('package-correction-0').locator('summary').click(); await expect(page.getByTestId('package-energy-0')).toHaveValue('1673.6');
  await expect(page.getByTestId('package-energy-unit-0')).toHaveValue('kJ');
  await page.getByTestId('package-unit-0').selectOption('g'); await expect(page.getByTestId('package-amount-0')).toHaveValue('');
  await page.getByTestId('package-amount-0').fill('25'); await expect(page.getByTestId('food-calories-0')).toContainText('100 kcal');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('25 g');
});
test('体积包装与不清晰标签可同时识别，mL不当g，缺失数据不当零', async ({ page }) => {
  await recognize(page, [{ name: '测试牛奶', label: { ...cookie, basis: '100ml', energy: { value: 250, unit: 'kJ' }, proteinG: 3, fatG: 3, carbsG: 5, servingSize: null, netContent: { amount: 250, unit: 'ml' } } }, { name: '包装食品（名称待确认）', label: emptyPackageLabel() }]);
  await page.getByTestId('package-amount-0').fill('200'); await expect(page.getByTestId('food-calories-0')).toContainText('119.5 kcal');
  await page.getByTestId('package-unit-0').selectOption('g'); await page.getByTestId('package-amount-0').fill('200');
  await expect(page.getByTestId('package-conversion-warning-0')).toContainText('mL 不会直接当作 g'); await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
  await page.getByTestId('package-unit-0').selectOption('ml'); await page.getByTestId('package-amount-0').fill('200');
  await expect(page.getByTestId('package-label-1')).toContainText('基准待确认'); await expect(page.getByTestId('food-calories-1')).toHaveText('待补充');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('200 mL');
  await expect(page.getByTestId('daily-calories')).toContainText('119.5'); await expect(page.getByTestId('budget-incomplete')).toContainText('1 项');
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport);
});
test('手填每份包装按份计算，v8备份恢复原标签和摄入快照，不污染个人估算库', async ({ page }) => {
  await page.goto('/'); await openPhotoEditor(page); await page.getByTestId('add-package').click();
  await page.getByTestId('food-name-0').fill('测试能量棒'); await page.getByTestId('package-correction-0').locator('summary').click();
  await page.getByTestId('package-basis-0').selectOption('serving'); await page.getByTestId('package-energy-unit-0').selectOption('kcal');
  await page.getByTestId('package-energy-0').fill('120'); await page.getByTestId('package-servingSize-0').fill('30'); await page.getByTestId('package-netContent-0').fill('90');
  await page.getByTestId('package-unit-0').selectOption('serving'); await page.getByTestId('package-amount-0').fill('2');
  await expect(page.getByTestId('food-calories-0')).toContainText('240 kcal'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await tab(page, 'settings'); await expect(page.getByTestId('estimated-food-count')).toHaveText('0 项');
  const pending = page.waitForEvent('download'); await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click(); const download = await pending; const stream = await download.createReadStream();
  if (!stream) throw new Error('没有备份'); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const buffer = Buffer.concat(chunks), backup = JSON.parse(buffer.toString());
  expect(backup.schemaVersion).toBe(11); expect(backup.meals[0].items[0].packageSnapshot.label.basis).toBe('serving'); expect(backup.meals[0].items[0].packageSnapshot.consumedAmount).toBe(2);
  await tab(page, 'diary'); await page.getByTestId('edit-meal').click(); await page.getByTestId('package-amount-0').fill('1'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await tab(page, 'settings'); await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: '包装备份.json', mimeType: 'application/json', buffer }); await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复');
  await tab(page, 'diary'); await expect(page.getByTestId('meal-record')).toContainText('2 份'); await expect(page.getByTestId('daily-calories')).toContainText('240');
});
