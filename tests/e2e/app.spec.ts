import { openSettingsPanel, closeSettingsPanel } from './helpers/settings';
import { openPhotoEditor } from './helpers/photo-editor';
import { openManualMeal } from './helpers/manual-food';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findFood, findRecipe, type MealRecord } from '@shike/shared';

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
  await closeSettingsPanel(page);
  const mobile = page.getByTestId(`tab-${tab}`);
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${tab}`)).click();
}

async function manualMeal(page: Page, name: string, source?: string) {
  await openManualMeal(page);
  await page.getByTestId('food-name-0').fill(name);
  await page.getByTestId('food-weight-0').fill('150');
  if (source) {
    await page.getByTestId('food-source-0').click();
    await page.getByTestId('food-picker-search').fill(name);
    await page.getByTestId(`food-option-${source}`).click();
  }
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  if (process.env.SHIKE_E2E_LAN === '1') {
    // 原问题仅在 LAN HTTP 出现；不能把 localhost 的通过结果当作手机局域网验证。
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  }
  await expect(page.getByTestId('daily-summary')).toBeVisible();
  await expect(page.getByTestId('header-mock')).toHaveText('模拟模式');
});

test('图片识别、修改、保存、刷新、编辑与删除形成完整闭环', async ({ page }, testInfo) => {
  const imageName = testInfo.project.name === 'Chrome 手机' ? 'mobile' : testInfo.project.name === 'Chrome 桌面' ? 'desktop' : 'edge';
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/${imageName}.png`, import.meta.url)), fullPage: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPhotoEditor(page);
  const picture = await sharp({ create: { width: 1400, height: 1000, channels: 3, background: '#e5efe8' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '测试照片.png', mimeType: 'image/png', buffer: picture });
  await expect(page.getByTestId('food-item-2')).toBeVisible();
  await expect(page.getByTestId('confirm-ai')).toHaveCount(0);
  await expect(page.getByTestId('mock-editor')).toContainText('模拟');
  await page.getByTestId('food-weight-0').fill('200');
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
  await selectDate(page, 'diary-date', date);
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
  await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('backup.json');
  await download.saveAs(path);
  const content = await readFile(path, 'utf8');
  const backup = JSON.parse(content);
  expect(Object.keys(backup).sort()).toEqual(['dailyPlans', 'estimatedFoods', 'exercises', 'exportedAt', 'meals', 'packagedFoods', 'schemaVersion', 'settings', 'water', 'weights']);
  expect(backup.schemaVersion).toBe(11);
  expect(backup.meals).toHaveLength(1);
  expect(backup.weights[0].weightKg).toBe(65.5);
  expect(backup.settings.targetWeightKg).toBe(60);
  await openTab(page, 'diary');
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('delete-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await openTab(page, 'settings');
  await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(content) });
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
  await openManualMeal(page);
  await page.getByTestId('food-name-0').fill('我的待保存餐食');
  await page.route('**/api/recognitions', route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AI_RATE_LIMITED', message: '模型当前繁忙，请稍后重试。', retryAfterSeconds: 5 } }) }));
  page.once('dialog', dialog => dialog.accept());
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#e5efe8' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '测试.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('繁忙');
  await expect(page.getByTestId('food-name-0')).toHaveValue('我的待保存餐食');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
});

test('百炼估算兼容旧 Gemini 缓存，中值切档保存、历史保留及改名清除', async ({ page }, testInfo) => {
  // 模拟用户升级前已有单值个人条目：新三档不能被旧缓存遮住。
  const legacyTime = '2026-10-13T04:00:00.000Z';
  const legacyBackup = { schemaVersion: 2, exportedAt: legacyTime, meals: [], weights: [], settings: { targetWeightKg: null }, estimatedFoods: [{
    id: 'legacy-porridge-estimate', name: '杂粮粥', nutrientsPer100g: { energyKcal: 45, proteinG: 1.2, fatG: 0.5, carbsG: 8.5 }, provenance: '测试中的旧 AI 单值粗估，非实测数据', assumptions: ['测试旧条目，尚无三档资料'], provider: 'gemini', model: 'legacy-test-model', createdAt: legacyTime, updatedAt: legacyTime,
  }] };
  await openTab(page, 'settings');
  await openSettingsPanel(page, 'backup'); await page.getByTestId('backup-input').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyBackup)) });
  await page.getByTestId('confirm-restore').click();
  await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  await openTab(page, 'diary');
  let inference = 0;
  await page.route('**/api/recognitions', route => {
    inference++;
    // 此响应只在隔离的浏览器测试里模拟，不发送真实模型请求。
    const porridge = { name: '杂粮粥', estimatedWeightG: 300, visibleIngredients: ['谷物'], uncertainties: ['含水量与用糖需确认'], estimatedNutrientsPer100g: { energyKcal: inference === 1 ? 75 : 135, proteinG: null, fatG: null, carbsG: null }, nutritionAssumptions: ['参考普通甜度情景，含水量未知，并非测量值'], nutritionEstimateProfile: testEstimateProfile('sweetness', inference === 1 ? 0 : 60) };
    const rice = { name: '米饭', estimatedWeightG: 100, visibleIngredients: [], uncertainties: [], estimatedNutrientsPer100g: { energyKcal: 999, proteinG: 1, fatG: 1, carbsG: 1 }, nutritionAssumptions: ['测试中的故意偏高值，应该被数据库值替代'] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { isFood: true, foods: inference === 1 ? [rice, porridge] : [porridge], uncertainties: [] }, mode: 'live', provider: 'qwen', model: 'qwen3.7-flash' }) });
  });
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#eee8db' } }).png().toBuffer();
  const upload = async () => {
    await openPhotoEditor(page);
    await page.getByTestId('gallery-input').setInputFiles({ name: '测试粥.png', mimeType: 'image/png', buffer });
    await expect(page.getByTestId('food-item-0')).toBeVisible();
  };
  await upload();
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', findFood('米饭')!.id);
  await expect(page.getByTestId('food-source-1')).toHaveAttribute('data-source-id', 'ai-current');
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
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await openTab(page, 'settings');
  await expect(page.getByTestId('estimated-food-count')).toHaveText('1 项');
  await page.getByTestId('manage-estimates').click();
  await expect(page.getByTestId('estimated-food-0')).toContainText('杂粮粥');
  await page.keyboard.press('Escape');
  await openTab(page, 'diary');
  await page.reload();
  await expect(page.getByTestId('daily-range')).toBeVisible();
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-calories-1')).toContainText('315');
  await page.getByTestId('food-weight-1').fill('400');
  await expect(page.getByTestId('food-calories-1')).toContainText('420');
  await expect(page.getByTestId('food-range-1')).toContainText('360');
  await expect(page.getByTestId('food-range-1')).toContainText('480');
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await upload();
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', /^personal:/);
  await expect(page.getByTestId('food-calories-0')).toContainText('225');
  await page.getByTestId('food-name-0').fill('燕麦片');
  await page.getByTestId('food-weight-0').focus();
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', findFood('燕麦片')!.id);
  await page.getByTestId('food-name-0').fill('自制新菜');
  await page.getByTestId('food-weight-0').focus();
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', '');
  await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
  await expect(page.getByTestId('food-range-0')).toHaveCount(0);
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await openTab(page, 'settings');
  const downloadPromise = page.waitForEvent('download');
  await openSettingsPanel(page, 'backup'); await page.getByTestId('export-backup').click();
  const download = await downloadPromise;
  const path = await download.path();
  const backup = JSON.parse(await readFile(path!, 'utf8'));
  expect(backup.estimatedFoods).toHaveLength(1);
  expect(backup.estimatedFoods[0].id).toBe('legacy-porridge-estimate');
  expect(backup.estimatedFoods[0].createdAt).toBe(legacyTime);
  expect(backup.estimatedFoods[0].nutrientsPer100g.energyKcal).toBe(105);
  expect(backup.estimatedFoods[0].estimateProfile.options).toHaveLength(3);
  expect(backup.estimatedFoods[0].provider).toBe('qwen');
  const original = backup.meals.find((meal: MealRecord) => meal.items.some(item => item.name === '杂粮粥'));
  expect(original.items[1].estimateLevel).toBe('high');
  expect(original.items[1].weightG).toBe(400);
  expect(original.items[1].aiEstimateSnapshot.provider).toBe('qwen');
});

test('百炼结果用油三档采用中值，手填确定热量覆盖区间并刷新保留', async ({ page }) => {
  await page.route('**/api/recognitions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    result: { isFood: true, foods: [{ name: '自制炒时蔬', estimatedWeightG: 300, visibleIngredients: [], uncertainties: ['用油需确认'], estimatedNutrientsPer100g: { energyKcal: 75, proteinG: null, fatG: null, carbsG: null }, nutritionAssumptions: ['测试普通用油情景，非实测数据'], nutritionEstimateProfile: testEstimateProfile('oil') }], uncertainties: [] },
    mode: 'live', provider: 'qwen', model: 'qwen3.7-flash',
  }) }));
  await openPhotoEditor(page);
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
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('daily-calories')).toContainText('240');
  await openTab(page, 'settings');
  await expect(page.getByTestId('estimated-food-count')).toHaveText('0 项');
});

test('参考配方油档替换原油量，换份量缩放，确定油克数撤销区间', async ({ page }) => {
  await openManualMeal(page);
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

test('食物弹窗推荐、分类搜索、取消返回及更换后保存刷新', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/recognitions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    result: { isFood: true, foods: [{ name: '西红柿炒鸡蛋', estimatedWeightG: 230, visibleIngredients: ['番茄', '鸡蛋'], uncertainties: ['油量需确认'], estimatedNutrientsPer100g: { energyKcal: 75, proteinG: null, fatG: null, carbsG: null }, nutritionAssumptions: ['隔离测试情景，非实测'], nutritionEstimateProfile: testEstimateProfile('oil') }], uncertainties: [] },
    mode: 'mock', provider: 'mock', model: 'mock',
  }) }));
  await openPhotoEditor(page);
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#efe8db' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '测试菜.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('food-name-0')).toHaveValue(findRecipe('番茄炒蛋')!.name);
  const trigger = page.getByTestId('food-source-0');
  await trigger.click();
  const picker = page.getByTestId('food-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('模拟数据 · 示例食物：西红柿炒鸡蛋');
  await expect(page.getByTestId(`food-recommendation-${findRecipe('番茄炒蛋')!.id}`)).toBeVisible();
  await expect(page.getByTestId('food-editor')).toHaveAttribute('inert', '');
  const imageName = testInfo.project.name === 'Chrome 手机' ? 'mobile' : testInfo.project.name === 'Chrome 桌面' ? 'desktop' : 'edge';
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/picker-${imageName}.png`, import.meta.url)) });
  expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  // 焦点留在当前弹窗，Escape 只关闭食物选择，返回原编辑位置。
  await page.getByTestId('food-picker-manual').focus();
  await page.keyboard.press('Tab');
  expect(await picker.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId('food-editor')).toBeVisible();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('230');
  await trigger.click();
  await page.getByTestId('food-category-蔬菜').click();
  await page.getByTestId('food-picker-search').fill('苦瓜');
  await expect(page.getByTestId('food-result-count')).toContainText('1 项');
  await expect(picker).not.toContainText('苦瓜（生）');
  await page.getByTestId('include-raw-ingredients').check();
  await expect(page.getByTestId('food-result-count')).toContainText('2 项');
  await expect(picker).toContainText('生重');
  await expect(picker).toContainText('熟重');
  await page.getByTestId(`food-option-${findFood('苦瓜')!.id}`).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('food-name-0')).toHaveValue(findFood('苦瓜')!.name);
  await expect(page.getByTestId('food-weight-0')).toHaveValue('230');
  await trigger.click();
  await page.getByTestId('food-picker-search').fill('不存在的菜123');
  await expect(page.getByTestId('food-search-empty')).toBeVisible();
  await page.getByTestId('clear-food-search').click();
  await page.getByTestId('food-picker-search').fill('米饭');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('data-source-id', findFood('苦瓜')!.id);
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('edit-meal').click();
  await expect(trigger).toHaveAttribute('data-source-id', findFood('苦瓜')!.id);
  await expect(page.getByTestId('food-weight-0')).toHaveValue('230');
  await trigger.click();
  await page.getByTestId('food-picker-manual').click();
  await expect(page.getByTestId('food-energyKcal-0')).toBeVisible();
  await expect(page.getByTestId('food-energyKcal-0')).toBeFocused();
  await page.getByTestId('food-energyKcal-0').fill('80');
  await expect(page.getByTestId('food-calories-0')).toContainText('184');
  expect(errors).toEqual([]);
});

test('五千条食物分批浏览、中文搜索及膳食参考保存后保持来源与重量', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openManualMeal(page);
  await page.getByTestId('food-weight-0').fill('150.5');
  await page.getByTestId('food-source-0').click();
  const picker = page.getByTestId('food-picker');
  expect(Number((await page.getByTestId('food-result-count').innerText()).replace(/\D/g, ''))).toBeGreaterThan(5000);
  await expect(picker.locator('[data-testid^="food-option-"]')).toHaveCount(60);
  await page.getByTestId('food-load-more').click();
  await expect(picker.locator('[data-testid^="food-option-"]')).toHaveCount(120);
  await page.getByTestId('food-category-熟食菜肴').click();
  await page.getByTestId('food-picker-search').fill('蒸饺');
  await expect(page.getByTestId('food-option-fdc-2708708')).toBeVisible();
  await page.getByTestId('food-picker-search').fill('包子');
  await expect(page.getByTestId('food-option-fdc-2708724')).toContainText('膳食参考');
  const imageName = testInfo.project.name === 'Chrome 手机' ? 'mobile' : testInfo.project.name === 'Chrome 桌面' ? 'desktop' : 'edge';
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/library-${imageName}.png`, import.meta.url)) });
  expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.getByTestId('food-option-fdc-2708724').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150.5');
  await expect(page.getByTestId('food-source-0')).toContainText('USDA 膳食参考');
  await expect(page.getByTestId('food-calories-0')).toContainText('410.87');
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('daily-calories')).toContainText('410.87');
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150.5');
  await expect(page.getByTestId('food-source-0')).toHaveAttribute('data-source-id', 'fdc-2708724');
  await expect(page.getByTestId('food-item-0')).toContainText('美国常见配方');
  expect(errors).toEqual([]);
});

test('熟食默认筛选、扩充早餐与数字最多两位小数', async ({ page }) => {
  await openManualMeal(page);
  await page.getByTestId('food-weight-0').fill('333.33');
  await page.getByTestId('food-source-0').click();
  const picker = page.getByTestId('food-picker');
  await expect(page.getByTestId('include-raw-ingredients')).not.toBeChecked();
  await page.getByTestId('food-picker-search').fill('生鸡蛋');
  await expect(page.getByTestId('food-search-empty')).toBeVisible();
  await page.getByTestId('include-raw-ingredients').check();
  await expect(page.getByTestId(`food-option-${findFood('生鸡蛋')!.id}`)).toBeVisible();
  await page.getByTestId('include-raw-ingredients').uncheck();
  await page.getByTestId('food-picker-search').fill('苹果');
  await expect(page.getByTestId(`food-option-${findFood('苹果')!.id}`)).toBeVisible();
  await page.getByTestId('food-picker-search').fill('三明治');
  await page.getByTestId('food-category-轻食早餐').click();
  await expect(page.getByTestId('food-result-count')).toHaveText('3 项');
  await page.getByTestId(`food-option-${findRecipe('鸡蛋三明治')!.id}`).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('food-weight-0')).toHaveValue('333.33');
  await expect(page.getByTestId('food-range-0')).toHaveCount(0);
  await page.getByTestId('food-name-0').fill('蛋炒饭');
  await page.getByTestId('food-weight-0').focus();
  await page.getByTestId('estimate-high-0').click();
  const numeric = /^\d+(\.\d{1,2})?$/;
  for (const ingredient of await page.getByTestId('food-item-0').locator('.ingredient-grid input').all()) await expect(ingredient).toHaveValue(numeric);
  await page.getByTestId('nutrition-details-0').locator('summary').click();
  for (const input of await page.getByTestId('nutrition-details-0').locator('input').all()) await expect(input).toHaveValue(numeric);
  const oil = await page.getByTestId('recipe-ingredient-oil-0').inputValue();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('333.33');
  await expect(page.getByTestId('recipe-ingredient-oil-0')).toHaveValue(oil);
  await expect(page.getByTestId('estimate-high-0')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await openTab(page, 'weight');
  await page.getByTestId('weight-input').fill('65.555');
  await expect(page.getByTestId('weight-input')).toHaveValue('65.56');
  await page.getByTestId('save-weight').click();
  await expect(page.getByTestId('weight-record')).toContainText('65.56');
  await page.getByTestId('target-weight').fill('60.555');
  await expect(page.getByTestId('target-weight')).toHaveValue('60.56');
  await page.getByTestId('save-target').click();
  await expect(page.getByTestId('toast')).toContainText('目标');
  await page.reload();
  await openTab(page, 'weight');
  await expect(page.getByTestId('weight-record')).toContainText('65.56');
  await expect(page.getByTestId('target-weight')).toHaveValue('60.56');
});

test('一张照片逐项匹配多个食物和对应重量，混合菜不拆重，删除修改后可保存', async ({ page }, testInfo) => {
  const detected = [
    { name: '一小碗白米饭', estimatedWeightG: 165.5, visibleIngredients: ['大米'] },
    { name: '西红柿炒鸡蛋', estimatedWeightG: 240.25, visibleIngredients: ['番茄', '鸡蛋'] },
    { name: '一根香蕉', estimatedWeightG: 90, visibleIngredients: [] },
    { name: '冬瓜豆腐汤', estimatedWeightG: null, visibleIngredients: ['冬瓜', '豆腐'] },
  ];
  await page.route('**/api/recognitions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    result: { isFood: true, foods: detected.map(food => ({ ...food, uncertainties: ['隔离测试示例，非真实照片测量'], estimatedNutrientsPer100g: null, nutritionAssumptions: [], nutritionEstimateProfile: null })), uncertainties: [] },
    mode: 'mock', provider: 'mock', model: 'mock',
  }) }));
  await openPhotoEditor(page);
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#e5efe8' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: '多食物示例.png', mimeType: 'image/png', buffer });
  const summary = page.getByTestId('recognition-summary');
  await expect(summary).toContainText('模拟识别 4 项食物');
  await expect(summary).toContainText('已自动匹配 4 项');
  await expect(summary).toContainText('3 项已带入示例重量');
  await expect(page.getByTestId('food-item-4')).toHaveCount(0);
  const sources = [findFood('米饭')!.id, findRecipe('番茄炒蛋')!.id, findFood('香蕉')!.id, findRecipe('冬瓜豆腐汤')!.id];
  for (let index = 0; index < detected.length; index++) {
    await expect(page.getByTestId(`food-source-${index}`)).toHaveAttribute('data-source-id', sources[index]!);
    await expect(page.getByTestId(`food-weight-${index}`)).toHaveValue(detected[index]!.estimatedWeightG === null ? '' : String(detected[index]!.estimatedWeightG));
    await expect(page.getByTestId(`recognition-match-${index}`)).toContainText(detected[index]!.name);
  }
  await expect(page.getByTestId('recognition-weight-1')).toContainText('240.25 g');
  await expect(page.getByTestId('food-calories-3')).toHaveText('待补充');
  await expect(page.getByTestId('recognition-weight-3')).toContainText('请填写');
  await expect(page.getByTestId('recognized-row-0')).toContainText('165.5 g');
  await expect(page.getByTestId('recognized-row-1')).toContainText('240.25 g');
  await expect(page.getByTestId('recognized-row-3')).toContainText('重量待补充');
  await summary.scrollIntoViewIfNeeded();
  const imageName = testInfo.project.name === 'Chrome 手机' ? 'mobile' : testInfo.project.name === 'Chrome 桌面' ? 'desktop' : 'edge';
  await page.screenshot({ path: fileURLToPath(new URL(`../../docs/screenshots/multi-food-${imageName}.png`, import.meta.url)) });
  await page.getByTestId('food-weight-1').fill('250.55');
  await expect(page.getByTestId('recognition-weight-1')).toContainText('已手动调整');
  await expect(page.getByTestId('food-weight-0')).toHaveValue('165.5');
  await expect(page.getByTestId('food-weight-2')).toHaveValue('90');
  await page.getByRole('button', { name: '删除食物 2', exact: true }).click();
  await expect(page.getByTestId('food-item-3')).toHaveCount(0);
  await expect(page.getByTestId('food-name-1')).toHaveValue(findFood('香蕉')!.name);
  await expect(page.getByTestId('food-weight-1')).toHaveValue('90');
  await expect(summary).toContainText('模拟识别 3 项食物');
  await page.getByTestId('food-weight-2').fill('300.25');
  await expect(page.getByTestId('recognition-weight-2')).toHaveText('已手动填写 300.25 g');
  await page.getByTestId('recognized-row-0').click();
  await expect(page.getByTestId('food-name-0')).toBeInViewport();
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('edit-meal').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('165.5');
  await expect(page.getByTestId('food-weight-1')).toHaveValue('90');
  await expect(page.getByTestId('food-weight-2')).toHaveValue('300.25');
  await expect(page.getByTestId('food-source-2')).toHaveAttribute('data-source-id', findRecipe('冬瓜豆腐汤')!.id);
  await expect(page.getByTestId('food-item-3')).toHaveCount(0);
});
import { selectDate } from './helpers/calendar';
