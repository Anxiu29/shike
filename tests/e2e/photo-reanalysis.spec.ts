import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';

async function setup(page: Page) {
  await routeApkAssets(page);
  const jpeg = (await sharp({ create: { width: 720, height: 480, channels: 3, background: '#d7e8b8' } }).jpeg().toBuffer()).toString('base64');
  await page.addInitScript(({ jpeg }) => {
    const w = window as any, id = '790650e2-3696-43d1-927a-596f3e69de84';
    w.androidBridge = {}; w.__analysisCalls = []; w.__cameraCalls = 0;
    const state = { profiles: [{ id, label: '图片分析测试', provider: 'qwen', model: 'qwen3.7-flash', models: ['qwen3.7-flash', 'qwen3-vl-plus'] }], activeId: id };
    w.Capacitor = { PluginHeaders: [
      { name: 'PersonalVision', methods: ['getState', 'activate', 'recognize', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'SystemPhoto', methods: [{ name: 'capture', rtype: 'promise' }] },
    ], nativePromise: async (plugin: string, method: string, input: any) => {
      if (plugin === 'SystemPhoto') { w.__cameraCalls++; return { cancelled: false, jpegBase64: jpeg }; }
      if (method === 'getState') return structuredClone(state);
      if (method === 'activate') { state.profiles[0]!.model = input.model; return structuredClone(state); }
      w.__analysisCalls.push({ method, ...structuredClone(input) });
      if (w.__analysisFail) throw new Error('此模型暂不可用，原草稿保留。');
      const second = input.model === 'qwen3-vl-plus';
      const content = method === 'recognize' ? { isFood: true, foods: [{ name: second ? '鸡蛋' : '米饭', estimatedWeightG: second ? 100 : 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] }
        : { intent: 'update', date: JSON.parse(input.request).date, mealType: 'lunch', foods: [{ name: second ? '鸡蛋' : '米饭', amount: 1, unit: second ? '个' : '碗' }], message: '已重新分析，请核对草稿。' };
      return { provider: 'qwen', model: input.model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) };
    } };
  }, { jpeg });
  await page.goto('/');
}
async function chooseSecond(page: Page) {
  const selector = page.getByTestId('recognition-model');
  const value = await selector.locator('option').last().getAttribute('value');
  await selector.selectOption(value!);
  await expect(page.getByTestId('model-switch-feedback')).toContainText('已切换');
}

test('拍照后换模型分析同一张图，取消不覆盖，确认后替换且不再拍照', async ({ page }) => {
  await setup(page); await page.getByTestId('photo-lunch').click();
  await expect(page.getByTestId('food-name-0')).toHaveValue(/米饭/);
  await page.getByTestId('food-weight-0').fill('170'); await chooseSecond(page);
  expect(await page.evaluate(() => (window as any).__analysisCalls.length)).toBe(1);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByTestId('reanalyze-photo').click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('170');
  expect(await page.evaluate(() => (window as any).__analysisCalls.length)).toBe(1);
  page.once('dialog', dialog => dialog.accept()); await page.getByTestId('reanalyze-photo').click();
  await expect(page.getByTestId('food-name-0')).toHaveValue(/鸡蛋/);
  const calls = await page.evaluate(() => (window as any).__analysisCalls);
  expect(calls.map((call: any) => call.model)).toEqual(['qwen3.7-flash', 'qwen3-vl-plus']);
  expect(calls[1].imageBase64).toBe(calls[0].imageBase64);
  expect(await page.evaluate(() => (window as any).__cameraCalls)).toBe(1);
  await expect(page.getByTestId('enlarge-photo')).toBeVisible();
});

test('换模型重新分析失败保留已改份量与照片，可用当前模型重试', async ({ page }) => {
  await setup(page); await page.getByTestId('photo-lunch').click();
  await expect(page.getByTestId('food-weight-0')).toBeVisible(); await page.getByTestId('food-weight-0').fill('170');
  await chooseSecond(page); await page.evaluate(() => { (window as any).__analysisFail = true; });
  page.on('dialog', dialog => dialog.accept()); await page.getByTestId('reanalyze-photo').click();
  await expect(page.getByTestId('editor-error')).toContainText('此模型暂不可用');
  await expect(page.getByTestId('food-weight-0')).toHaveValue('170'); await expect(page.getByTestId('enlarge-photo')).toBeVisible();
  await page.evaluate(() => { (window as any).__analysisFail = false; }); await page.getByTestId('reanalyze-photo').click();
  await expect(page.getByTestId('food-name-0')).toHaveValue(/鸡蛋/);
});

test('AI记餐拍照后可换模型发送，也可用新模型重新分析上一张图', async ({ page }) => {
  await setup(page); await page.getByTestId('assistant-open').click();
  await page.getByTestId('assistant-take-photo').click(); await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await page.getByTestId('assistant-send').click(); await expect(page.getByTestId('assistant-food-0')).toContainText('米饭');
  await chooseSecond(page); await page.getByTestId('assistant-reanalyze-image').click();
  await expect(page.getByTestId('assistant-food-0')).toContainText('鸡蛋');
  const calls = await page.evaluate(() => (window as any).__analysisCalls);
  expect(calls.map((call: any) => call.model)).toEqual(['qwen3.7-flash', 'qwen3-vl-plus']);
  expect(JSON.parse(calls[1].request).imageBase64).toBe(JSON.parse(calls[0].request).imageBase64);
  expect(await page.evaluate(() => (window as any).__cameraCalls)).toBe(1);
  await page.getByTestId('assistant-take-photo').click(); await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  const first = await page.getByTestId('recognition-model').locator('option').first().getAttribute('value');
  await page.getByTestId('recognition-model').selectOption(first!); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-food-0')).toContainText('米饭');
  expect(await page.evaluate(() => (window as any).__analysisCalls.at(-1).model)).toBe('qwen3.7-flash');
});
