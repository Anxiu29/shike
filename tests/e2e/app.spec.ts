import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findFood, type MealRecord } from '@shike/shared';

// 以下区间仅是隔离测试的情景数据，不代表经过测量的食品营养标准。
function testEstimateProfile(factor: 'sweetness' | 'oil', shift = 0) {
  const levels = ['low', 'medium', 'high'] as const;
  const energies = [[40, 60], [60, 90], [90, 120]];
  const labels = factor === 'sweetness' ? ['无糖、比较稀', '普通甜度', '糖多、杂粮浓稠'] : ['少油', '普通用油', '多油'];
  return { factor, options: levels.map((level, index) => ({
    level, label: labels[index],
    rangesPer100g: { energyKcal: { min: energies[index]![0]! + shift, max: energies[index]![1]! + shift }, proteinG: null, fatG: null, carbsG: null },
    assumptions: [`隔离测试中的${labels[index]}参考情景，非实测数据；糖、油与含水量需确认`],
  })) };
}

async function openTab(page: Page, tab: 'diary' | 'weight' | 'settings') {
  const mobile = page.getByTestId(`tab-${tab}`);
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${tab}`)).click();
}

async function manualMeal(page: Page, name: string, source?: string) {
  await page.getByTestId('manual-add').click();
  await page.getByTestId('food-name-0').fill(name);
  await page.getByTestId('food-weight-0').fill('150');
  if (source) await page.getByTestId('food-source-0').selectOption(source);
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('daily-summary')).toBeVisible();
  await expect(page.getByTestId('header-mock')).toHaveText('模拟模式');
});

test('图片识别、修改、保存、刷新、编辑与删除形成完整闭环', async ({ page }, testInfo) => {
  const imageName = testInfo.project.name === 'Chrome 手机' ? 'mobile' : testInfo.project.name === 'Chrome 桌面' ? 'desktop' : 'edge';
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/${imageName}.png`, import.meta.url)), fullPage: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByTestId('hero-camera').click();
  const picture = await sharp({ create: { width: 1400, height: 1000, channels: 3, background: '#e5efe8' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '测试照片.png', mimeType: 'image/png', buffer: picture });
  await expect(page.getByTestId('food-item-2')).toBeVisible();
  await expect(page.getByTestId('mock-editor')).toContainText('模拟');
  await page.getByTestId('food-weight-0').fill('200');
  await page.getByTestId('confirm-ai').check();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await expect(page.getByTestId('daily-mock')).toContainText('模拟');
  const before = await page.getByTestId('daily-calories').innerText();
  await page.reload();
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('200');
  await page.getByTestId('food-weight-0').fill('250');
  await page.getByTestId('confirm-ai').check();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await expect(page.getByTestId('daily-calories')).not.toHaveText(before);
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('delete-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('未知营养可保存并持续提示，历史日期独立查看', async ({ page }) => {
  await manualMeal(page, '自制复杂菜');
  await expect(page.getByTestId('meal-record')).toContainText('待补充');
  await expect(page.getByTestId('daily-summary')).toContainText('已知部分');
  const date = await page.getByTestId('diary-date').inputValue();
  await page.getByTestId('previous-date').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.getByTestId('diary-date').fill(date);
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
});

test('体重、目标和JSON备份能导出并完整恢复', async ({ page }, testInfo) => {
  await manualMeal(page, '米饭', findFood('米饭')!.id);
  await openTab(page, 'weight');
  await page.getByTestId('weight-input').fill('65.5');
  await page.getByTestId('save-weight').click();
  await expect(page.getByTestId('weight-record')).toHaveCount(1);
  await page.getByTestId('target-weight').fill('60');
  await page.getByTestId('save-target').click();
  await expect(page.getByTestId('toast')).toContainText('目标');
  await openTab(page, 'settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-backup').click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('backup.json');
  await download.saveAs(path);
  const content = await readFile(path, 'utf8');
  const backup = JSON.parse(content);
  expect(Object.keys(backup).sort()).toEqual(['estimatedFoods', 'exportedAt', 'meals', 'schemaVersion', 'settings', 'weights']);
  expect(backup.schemaVersion).toBe(2);
  expect(backup.meals).toHaveLength(1);
  expect(backup.weights[0].weightKg).toBe(65.5);
  expect(backup.settings.targetWeightKg).toBe(60);
  await openTab(page, 'diary');
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('delete-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await openTab(page, 'settings');
  await page.getByTestId('backup-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await expect(page.getByTestId('backup-preview')).toContainText('1');
  await page.getByTestId('confirm-restore').click();
  await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  await openTab(page, 'diary');
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload();
  await openTab(page, 'weight');
  await expect(page.getByTestId('weight-record')).toContainText('65.5');
  await expect(page.getByTestId('target-weight')).toHaveValue('60');
});

test('识别失败保留已编辑的草稿并给出可理解提示', async ({ page }) => {
  await page.getByTestId('manual-add').click();
  await page.getByTestId('food-name-0').fill('我的待保存餐食');
  await page.route('**/api/recognitions', route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AI_RATE_LIMITED', message: '模型当前繁忙，请稍后重试。', retryAfterSeconds: 5 } }) }));
  page.once('dialog', dialog => dialog.accept());
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#e5efe8' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '测试.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('繁忙');
  await expect(page.getByTestId('food-name-0')).toHaveValue('我的待保存餐食');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
});

test('估算默认中档中值、切档保存、历史保留、复用重置中档及改名清除', async ({ page }, testInfo) => {
  // 模拟用户升级前已有单值个人条目：新三档不能被旧缓存遮住。
  const legacyTime = '2026-10-13T04:00:00.000Z';
  const legacyBackup = { schemaVersion: 2, exportedAt: legacyTime, meals: [], weights: [], settings: { targetWeightKg: null }, estimatedFoods: [{
    id: 'legacy-porridge-estimate', name: '杂粮粥', nutrientsPer100g: { energyKcal: 45, proteinG: 1.2, fatG: 0.5, carbsG: 8.5 }, provenance: '测试中的旧 AI 单值粗估，非实测数据', assumptions: ['测试旧条目，尚无三档资料'], provider: 'gemini', model: 'legacy-test-model', createdAt: legacyTime, updatedAt: legacyTime,
  }] };
  await openTab(page, 'settings');
  await page.getByTestId('backup-input').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyBackup)) });
  await page.getByTestId('confirm-restore').click();
  await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  await openTab(page, 'diary');
  let inference = 0;
  await page.route('**/api/recognitions', route => {
    inference++;
    // 此响应只在隔离的浏览器测试里模拟，不发送真实模型请求。
    const porridge = { name: '杂粮粥', estimatedWeightG: 300, visibleIngredients: ['谷物'], uncertainties: ['含水量与用糖需确认'], estimatedNutrientsPer100g: { energyKcal: inference === 1 ? 75 : 135, proteinG: null, fatG: null, carbsG: null }, nutritionAssumptions: ['参考普通甜度情景，含水量未知，并非测量值'], nutritionEstimateProfile: testEstimateProfile('sweetness', inference === 1 ? 0 : 60) };
    const rice = { name: '米饭', estimatedWeightG: 100, visibleIngredients: [], uncertainties: [], estimatedNutrientsPer100g: { energyKcal: 999, proteinG: 1, fatG: 1, carbsG: 1 }, nutritionAssumptions: ['测试中的故意偏高值，应该被数据库值替代'] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { isFood: true, foods: inference === 1 ? [rice, porridge] : [porridge], uncertainties: [] }, mode: 'live', provider: 'gemini', model: 'gemini-3.5-flash-lite' }) });
  });
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#eee8db' } }).png().toBuffer();
  const upload = async () => {
    await page.getByTestId('hero-camera').click();
    await page.getByTestId('gallery-input').setInputFiles({ name: '测试粥.png', mimeType: 'image/png', buffer });
    await expect(page.getByTestId('food-item-0')).toBeVisible();
  };
  await upload();
  await expect(page.getByTestId('food-source-0')).toHaveValue(findFood('米饭')!.id);
  await expect(page.getByTestId('food-source-1')).toHaveValue('ai-current');
  await expect(page.getByTestId('food-calories-1')).toContainText('225');
  await expect(page.getByTestId('food-range-1')).toContainText('180');
  await expect(page.getByTestId('food-range-1')).toContainText('270');
  await expect(page.getByTestId('estimate-medium-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('estimate-medium-1').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const rangeImageName = testInfo.project.name === 'Chrome 手机' ? 'mobile' : testInfo.project.name === 'Chrome 桌面' ? 'desktop' : 'edge';
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/ranges-${rangeImageName}.png`, import.meta.url)), fullPage: true });
  await page.getByTestId('estimate-low-1').click();
  await expect(page.getByTestId('food-calories-1')).toContainText('150');
  await page.getByTestId('estimate-high-1').click();
  await expect(page.getByTestId('food-calories-1')).toContainText('315');
  await page.getByTestId('confirm-ai').check();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await openTab(page, 'settings');
  await expect(page.getByTestId('estimated-food-count')).toHaveText('1 项');
  await expect(page.getByTestId('estimated-food-0')).toContainText('杂粮粥');
  await openTab(page, 'diary');
  await page.reload();
  await expect(page.getByTestId('daily-range')).toBeVisible();
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-calories-1')).toContainText('315');
  await page.getByTestId('food-weight-1').fill('400');
  await expect(page.getByTestId('food-calories-1')).toContainText('420');
  await expect(page.getByTestId('food-range-1')).toContainText('360');
  await expect(page.getByTestId('food-range-1')).toContainText('480');
  await page.getByTestId('confirm-ai').check();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await upload();
  await expect(page.getByTestId('food-source-0')).toHaveValue(/^personal:/);
  await expect(page.getByTestId('food-calories-0')).toContainText('225');
  await page.getByTestId('food-name-0').fill('燕麦片');
  await page.getByTestId('food-weight-0').focus();
  await expect(page.getByTestId('food-source-0')).toHaveValue(findFood('燕麦片')!.id);
  await page.getByTestId('food-name-0').fill('自制新菜');
  await page.getByTestId('food-weight-0').focus();
  await expect(page.getByTestId('food-source-0')).toHaveValue('');
  await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
  await expect(page.getByTestId('food-range-0')).toHaveCount(0);
  await page.getByTestId('confirm-ai').check();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await openTab(page, 'settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-backup').click();
  const download = await downloadPromise;
  const path = await download.path();
  const backup = JSON.parse(await readFile(path!, 'utf8'));
  expect(backup.estimatedFoods).toHaveLength(1);
  expect(backup.estimatedFoods[0].id).toBe('legacy-porridge-estimate');
  expect(backup.estimatedFoods[0].createdAt).toBe(legacyTime);
  expect(backup.estimatedFoods[0].nutrientsPer100g.energyKcal).toBe(105);
  expect(backup.estimatedFoods[0].estimateProfile.options).toHaveLength(3);
  const original = backup.meals.find((meal: MealRecord) => meal.items.some(item => item.name === '杂粮粥'));
  expect(original.items[1].estimateLevel).toBe('high');
  expect(original.items[1].weightG).toBe(400);
});

test('用油三档采用中值，手填确定热量覆盖区间并刷新保留', async ({ page }) => {
  await page.route('**/api/recognitions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    result: { isFood: true, foods: [{ name: '自制炒时蔬', estimatedWeightG: 300, visibleIngredients: [], uncertainties: ['用油需确认'], estimatedNutrientsPer100g: { energyKcal: 75, proteinG: null, fatG: null, carbsG: null }, nutritionAssumptions: ['测试普通用油情景，非实测数据'], nutritionEstimateProfile: testEstimateProfile('oil') }], uncertainties: [] },
    mode: 'live', provider: 'gemini', model: 'gemini-3.5-flash-lite',
  }) }));
  await page.getByTestId('hero-camera').click();
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#e5efe8' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '测试菜.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('food-calories-0')).toContainText('225');
  await page.getByTestId('estimate-high-0').click();
  await expect(page.getByTestId('food-calories-0')).toContainText('315');
  await page.getByTestId('use-known-energy-0').click();
  await page.getByTestId('food-energyKcal-0').fill('80');
  await expect(page.getByTestId('food-calories-0')).toContainText('240');
  await expect(page.getByTestId('food-range-0')).toHaveCount(0);
  await expect(page.getByTestId('estimate-high-0')).toHaveCount(0);
  await page.getByTestId('confirm-ai').check();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('daily-calories')).toContainText('240');
  await openTab(page, 'settings');
  await expect(page.getByTestId('estimated-food-count')).toHaveText('0 项');
});

test('参考配方油档替换原油量，换份量缩放，确定油克数撤销区间', async ({ page }) => {
  await page.getByTestId('manual-add').click();
  await page.getByTestId('food-name-0').fill('清炒西兰花');
  await page.getByTestId('food-weight-0').fill('208');
  await expect(page.getByTestId('recipe-ingredient-oil-0')).toHaveValue('8');
  const normal = await page.getByTestId('food-calories-0').innerText();
  await page.getByTestId('estimate-high-0').click();
  await expect(page.getByTestId('recipe-ingredient-oil-0')).toHaveValue('11.2');
  await expect(page.getByTestId('food-calories-0')).not.toHaveText(normal);
  await page.getByTestId('food-weight-0').fill('');
  await expect(page.getByTestId('estimate-high-0')).toBeDisabled();
  await page.getByTestId('food-weight-0').fill('416');
  await expect(page.getByTestId('estimate-high-0')).toBeEnabled();
  await expect(page.getByTestId('recipe-ingredient-oil-0')).toHaveValue('22.4');
  const oilEstimate = await page.getByTestId('food-calories-0').innerText();
  await page.getByTestId('recipe-ingredient-oil-0').fill('5');
  await expect(page.getByTestId('food-range-0')).toHaveCount(0);
  await expect(page.getByTestId('estimate-high-0')).toHaveCount(0);
  await expect(page.getByTestId('food-calories-0')).not.toHaveText(oilEstimate);
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('recipe-ingredient-oil-0')).toHaveValue('5');
  await expect(page.getByTestId('food-range-0')).toHaveCount(0);
});
