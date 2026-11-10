import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';
async function setup(page: Page, prepare = true) {
  await routeApkAssets(page);
  await page.addInitScript(() => {
    const w = window as any; w.androidBridge = {}; w.__offlineMealCalls = []; w.__cloudMealCalls = 0; w.__prepareCalls = 0;
    const state = { stage: 'ready', ready: true, loaded: false, busy: false, backend: '', text: '', bytes: 1597922856, downloadedBytes: 0, progressBytes: 0, loadMs: 5290, firstTextMs: 1010, responseMs: 1810, characters: 0, error: '', availableMemoryBytes: 3_070_000_000, totalMemoryBytes: 16_000_000_000, device: 'OPPO PLJ110（模拟桥）' };
    w.Capacitor = { PluginHeaders: [
      { name: 'PersonalVision', methods: ['getState', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) },
      { name: 'OfflineAi', methods: ['getState', 'prepareAssistant', 'describeMeal', 'cancel', 'unload'].map(name => ({ name, rtype: 'promise' })) },
    ], nativePromise: async (plugin: string, method: string, options: any) => {
      if (plugin === 'PersonalVision') { if (method === 'describeMeal') { w.__cloudMealCalls++; throw Error('不应自动调用在线记餐'); } return { profiles: [], activeId: null }; }
      if (plugin !== 'OfflineAi') return {};
      if (method === 'getState') return { ...structuredClone(state), ...(w.__releaseOffline ? { loaded: false } : {}) };
      if (method === 'prepareAssistant') { w.__prepareCalls++; w.__releaseOffline = false; Object.assign(state, { loaded: true, backend: options.backend, stage: 'loaded' }); return {}; }
      if (method === 'unload') { Object.assign(state, { loaded: false, stage: 'ready' }); return {}; }
      if (method === 'cancel') { Object.assign(state, { busy: false, stage: 'stopped' }); w.__cancelOffline?.(); return {}; }
      if (method === 'describeMeal') {
        w.__offlineMealCalls.push(structuredClone(options)); Object.assign(state, { busy: true, stage: 'generating' });
        if (w.__holdOffline) await new Promise((_resolve, reject) => { w.__cancelOffline = () => reject(new Error('本机操作已停止，原草稿已保留。')); });
        await new Promise(resolve => setTimeout(resolve, 100));
        const request = JSON.parse(options.prompt);
        let foods = request.previous ? structuredClone(request.previous.foods) : [{ name: '鸡蛋', amount: 2, unit: '个' }, { name: '米饭', amount: 1, unit: '碗' }, { name: '牛奶', amount: 1, unit: '杯' }];
        if (/改成一个/.test(request.text)) foods[0].amount = 1;
        if (/去掉牛奶/.test(request.text)) foods = foods.filter((food: any) => food.name !== '牛奶');
        const intent = /取消这餐/.test(request.text) ? 'clear' : /搭配|怎么样/.test(request.text) ? 'question' : 'update';
        const draft = { intent, date: request.date, mealType: request.mealType, foods: intent === 'update' ? foods : [], message: intent === 'question' ? '这是模拟问答回复，原草稿保留。' : '模型声称已保存。' };
        if (w.__wrongOfflineUnits) draft.foods = draft.foods.map((food: any) => ({ ...food, unit: 'g' }));
        Object.assign(state, { busy: false, stage: 'completed' });
        return { model: 'Qwen2.5-1.5B-Q8', backend: options.backend, text: w.__offlineText ?? JSON.stringify(draft) };
      }
      return {};
    } };
  });
  await page.goto('/'); await page.getByTestId('assistant-open').click();
  await page.getByTestId('assistant-ai-route').selectOption('offline');
  expect(await page.evaluate(() => (window as any).__prepareCalls)).toBe(0);
  if (prepare) { await page.getByTestId('assistant-offline-prepare').click(); await expect(page.getByTestId('assistant-offline-ready')).toContainText('已准备'); }
}
async function send(page: Page, text: string) {
  await page.getByTestId('assistant-input').fill(text); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-input')).toHaveValue('');
}
async function noCloud(page: Page) { expect(await page.evaluate(() => (window as any).__cloudMealCalls)).toBe(0); }

test('进入离线助手、切后端、关闭重开均不自动准备；未准备和已释放时保留输入', async ({ page }) => {
  await setup(page, false);
  await page.getByTestId('assistant-input').fill('午餐两个鸡蛋，一碗米饭，一杯牛奶'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toContainText('准备模型');
  await expect(page.getByTestId('assistant-input')).toHaveValue('午餐两个鸡蛋，一碗米饭，一杯牛奶');
  await page.getByTestId('assistant-offline-backend').selectOption('cpu');
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click(); await page.getByTestId('assistant-open').click();
  expect(await page.evaluate(() => (window as any).__prepareCalls)).toBe(0);
  expect(await page.evaluate(() => (window as any).__offlineMealCalls.length)).toBe(0);
  await page.getByTestId('assistant-offline-prepare').click(); await send(page, '午餐两个鸡蛋，一碗米饭，一杯牛奶');
  await page.evaluate(() => { (window as any).__releaseOffline = true; });
  await page.getByTestId('assistant-input').fill('鸡蛋改成一个'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toContainText('准备模型');
  await expect(page.getByTestId('assistant-amount-0')).toHaveValue('2');
  expect(await page.evaluate(() => (window as any).__prepareCalls)).toBe(1);
  expect(await page.evaluate(() => (window as any).__offlineMealCalls.length)).toBe(1);
  await page.getByTestId('assistant-offline-prepare').click(); await send(page, '鸡蛋改成一个');
  await expect(page.getByTestId('assistant-amount-0')).toHaveValue('1'); await noCloud(page);
});

test('无Key也能离线整理三种食物、修改数量及删除单项，核对后保存并刷新恢复', async ({ page }) => {
  const posts: string[] = []; page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await setup(page);
  // 复现Find X9回报：模型保留2/1/1，却把三项单位全写成g。
  await page.evaluate(() => { (window as any).__wrongOfflineUnits = true; });
  await expect(page.getByTestId('assistant-choose-photo')).toBeDisabled();
  await send(page, '午餐吃了两个鸡蛋、一碗米饭和一杯牛奶。');
  await expect(page.locator('[data-testid^="assistant-food-"]')).toHaveCount(3);
  await expect(page.getByTestId('assistant-amount-0')).toHaveValue('2');
  await expect(page.getByTestId('assistant-amount-1')).toHaveValue('1');
  await expect(page.getByTestId('assistant-amount-2')).toHaveValue('1');
  await expect(page.getByTestId('assistant-food-0').locator('label > span').last()).toHaveText('个');
  await expect(page.getByTestId('assistant-food-1').locator('label > span').last()).toHaveText('碗');
  await expect(page.getByTestId('assistant-food-2').locator('label > span').last()).toHaveText('杯');
  await expect(page.getByTestId('assistant-food-0')).toContainText('2 个 · 约 100 g');
  await expect(page.getByTestId('assistant-food-1')).toContainText('1 碗 · 约 150 g');
  await expect(page.getByTestId('assistant-meal-type')).toHaveValue('lunch');
  await expect(page.getByTestId('assistant-messages')).not.toContainText('模型声称已保存');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await send(page, '鸡蛋改成一个，去掉牛奶');
  await expect(page.locator('[data-testid^="assistant-food-"]')).toHaveCount(2);
  await expect(page.getByTestId('assistant-amount-0')).toHaveValue('1');
  await expect(page.getByTestId('assistant-food-0').locator('label')).toContainText('个');
  await expect(page.getByTestId('assistant-food-1').locator('label')).toContainText('碗');
  const context = await page.evaluate(() => JSON.parse((window as any).__offlineMealCalls[1].prompt));
  expect(context.previous.foods).toHaveLength(3); expect(context.previous.foods[0]).toMatchObject({ amount: 2, unit: '个' });
  expect(context.history).toHaveLength(2);
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.getByTestId('meal-assistant').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  if (test.info().project.name === 'Chrome 手机') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('assistant-draft').scrollIntoViewIfNeeded();
    await page.getByTestId('meal-assistant').screenshot({ path: 'artifacts/android/offline-meal-draft-mobile.png' });
  }
  await page.getByTestId('assistant-save').click();
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await expect(page.getByTestId('meal-record')).toContainText('鸡蛋');
  await expect(page.getByTestId('meal-record')).not.toContainText('牛奶');
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-ai-route')).toHaveValue('offline');
  await noCloud(page); expect(posts).toEqual([]);
});

test('自然语言或错误结构不覆盖旧草稿，停止保留输入；问答不修改，清空仅作用于草稿', async ({ page }) => {
  await setup(page); await send(page, '午餐两个鸡蛋，一碗米饭，一杯牛奶');
  for (const bad of ['午餐吃了两个鸡蛋，一碗米饭，一杯牛奶。', '{"intent":"update"']) {
    await page.evaluate(value => { (window as any).__offlineText = value; }, bad);
    await page.getByTestId('assistant-input').fill('鸡蛋改成三个'); await page.getByTestId('assistant-send').click();
    await expect(page.getByTestId('assistant-error')).toContainText('原草稿已保留');
    await expect(page.getByTestId('assistant-amount-0')).toHaveValue('2');
    await expect(page.getByTestId('assistant-input')).toHaveValue('鸡蛋改成三个');
  }
  await page.evaluate(() => { (window as any).__offlineText = undefined; (window as any).__holdOffline = true; });
  await page.getByTestId('assistant-send').click(); await page.getByTestId('assistant-offline-stop').click();
  await expect(page.getByTestId('assistant-error')).toContainText('停止');
  await expect(page.getByTestId('assistant-amount-0')).toHaveValue('2');
  await expect(page.getByTestId('assistant-input')).toHaveValue('鸡蛋改成三个');
  await page.evaluate(() => { (window as any).__holdOffline = false; });
  await send(page, '这餐怎么搭配？'); await expect(page.getByTestId('assistant-amount-0')).toHaveValue('2');
  await send(page, '取消这餐'); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await expect(page.getByTestId('meal-record')).toHaveCount(0); await noCloud(page);
});

test('在线选择的待发图片在切本机后被拒绝，附件与输入保留且不自动上传', async ({ page }) => {
  await setup(page); await page.getByTestId('assistant-ai-route').selectOption('online');
  const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#789b69' } }).jpeg().toBuffer();
  await page.getByTestId('assistant-image-input').setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await page.getByTestId('assistant-ai-route').selectOption('offline');
  await expect(page.getByTestId('assistant-offline-ready')).toContainText('点击');
  await page.getByTestId('assistant-input').fill('这是什么？'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toContainText('只支持文字');
  await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await expect(page.getByTestId('assistant-input')).toHaveValue('这是什么？');
  expect(await page.evaluate(() => (window as any).__offlineMealCalls.length)).toBe(0); await noCloud(page);
});
