import { test, expect, type Page } from '@playwright/test';
import { routeApkAssets } from './helpers/apk-assets';
import sharp from 'sharp';
test.beforeEach(async ({ page }) => { await routeApkAssets(page); });
test.use({ timezoneId: 'Asia/Shanghai' });
async function native(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, id = '790650e2-3696-43d1-927a-596f3e69de84';
    w.androidBridge = {}; w.__assistantCalls = [];
    w.Capacitor = { PluginHeaders: [{ name: 'PersonalVision', methods: ['getState', 'activate', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) }], nativePromise: async (_plugin: string, method: string, input: any) => {
      if (method === 'getState' || method === 'activate') return { profiles: [{ id, label: '测试模型', provider: 'qwen', model: 'qwen3.7-flash' }], activeId: id };
      if (method === 'describeMeal') {
        w.__assistantCalls.push(input.request);
        if (w.__assistantFail) throw new Error('网络暂时不可用，草稿已保留。');
        const request = JSON.parse(input.request), amount = /三个/.test(request.text) ? 3 : 2;
        const intent = /取消/.test(request.text) ? 'clear' : /问一下/.test(request.text) ? 'question' : 'update';
        // 模拟模型遵守输入餐次上下文；真实语言理解不由这个测试证明。
        const mealType = /早餐/.test(request.text) ? 'breakfast' : request.previous?.mealType ?? request.mealType;
        const draft = { intent, date: request.date, mealType, foods: intent === 'update' ? [{ name: '肉包', amount, unit: '个' }, { name: '鸡蛋', amount: null, unit: '份' }] : [], message: intent === 'question' ? '这餐可以搭配蔬菜，份量仍需核对。' : '已整理这一餐草稿，请核对后保存。' };
        return { provider: 'qwen', model: 'qwen3.7-flash', data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }) };
      }
    } };
  });
}
async function open(page: Page) { await native(page); await page.goto('/'); await page.getByTestId('assistant-open').click(); await expect(page.getByTestId('meal-assistant')).toBeVisible(); }
async function send(page: Page, text: string) { await page.getByTestId('assistant-input').fill(text); await page.getByTestId('assistant-send').click(); await expect(page.getByTestId('assistant-input')).toHaveValue(''); await expect(page.getByTestId('assistant-draft')).toBeVisible(); }

test('详细编辑取消后返回助手保留原草稿，重新编辑保存后清理草稿', async ({ page }) => {
  await open(page); await send(page, '早餐两个肉包');
  await page.getByTestId('assistant-review').click();
  await expect(page.getByTestId('food-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('meal-assistant')).toBeVisible();
  await expect(page.getByTestId('assistant-food-0')).toContainText('160 g');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.getByTestId('assistant-review').click();
  await page.getByTestId('food-portion-0-unit').selectOption('g');
  await page.getByTestId('food-weight-0').fill('180');
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await expect(page.getByTestId('assistant-messages')).toContainText('已保存');
});

test('未说餐次按发送时间预选，跨时段保留手选，下一餐重算并可明确覆盖', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T10:59:00+08:00'));
  await open(page); await send(page, '两个肉包');
  await expect(page.getByTestId('assistant-meal-type')).toHaveValue('breakfast');
  expect(await page.evaluate(() => JSON.parse((window as any).__assistantCalls[0]).mealType)).toBe('breakfast');
  await page.getByTestId('assistant-meal-type').selectOption('dinner');
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00+08:00'));
  await send(page, '包子改成三个');
  await expect(page.getByTestId('assistant-meal-type')).toHaveValue('dinner');
  expect(await page.evaluate(() => JSON.parse((window as any).__assistantCalls[1]).previous.mealType)).toBe('dinner');
  await page.getByTestId('assistant-new').click(); await send(page, '两个肉包');
  await expect(page.getByTestId('assistant-meal-type')).toHaveValue('lunch');
  await page.getByTestId('assistant-new').click(); await send(page, '早餐两个肉包');
  await expect(page.getByTestId('assistant-meal-type')).toHaveValue('breakfast');
  expect(await page.evaluate(() => JSON.parse((window as any).__assistantCalls[3]).mealType)).toBe('lunch');
  // 窗口一直打开到深夜，新的第一条请求也必须读取最新时间。
  await page.getByTestId('assistant-new').click();
  await page.clock.setFixedTime(new Date('2026-10-21T23:00:00+08:00'));
  await send(page, '两个肉包'); await expect(page.getByTestId('assistant-meal-type')).toHaveValue('snack');
});
test('聊天修改数量、未知份量默认、确认保存与刷新恢复', async ({ page }) => {
  await open(page); await send(page, '早餐吃了两个肉包和鸡蛋');
  await expect(page.getByTestId('assistant-food-0')).toContainText('160 g'); await expect(page.getByTestId('assistant-food-1')).toContainText('50 g');
  await expect(page.getByTestId('assistant-amount-1')).toHaveValue('1');
  await send(page, '包子改成三个'); await expect(page.getByTestId('assistant-food-0')).toContainText('240 g');
  await expect(page.getByTestId('assistant-save')).toBeInViewport();
  expect(await page.evaluate(() => JSON.parse((window as any).__assistantCalls[1]).previous.foods[0].amount)).toBe(2);
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'artifacts/android/meal-assistant-mobile.png' });
  await page.getByTestId('assistant-save').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0); await expect(page.getByTestId('assistant-messages')).toContainText('已保存');
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth })); expect(width.scroll).toBeLessThanOrEqual(width.viewport);
});
test('失败保留输入草稿，悬浮窗关闭重开不丢失，也不会自动写记录', async ({ page }) => {
  await open(page); await send(page, '早餐两个肉包'); await expect(page.getByTestId('assistant-draft')).toBeVisible();
  await page.evaluate(() => { (window as any).__assistantFail = true; });
  await page.getByTestId('assistant-input').fill('包子改三个'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toContainText('草稿已保留'); await expect(page.getByTestId('assistant-input')).toHaveValue('包子改三个'); await expect(page.getByTestId('assistant-food-0')).toContainText('160 g');
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click(); await expect(page.getByTestId('meal-record')).toHaveCount(0); await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-food-0')).toContainText('160 g'); await page.evaluate(() => { (window as any).__assistantFail = false; });
  await send(page, '问一下这餐'); await expect(page.getByTestId('assistant-food-0')).toContainText('160 g');
  await page.getByTestId('assistant-input').fill('取消这餐'); await page.getByTestId('assistant-send').click(); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
});
test('转到详细编辑后可修改克数保存，旧助手草稿不重复提交', async ({ page }) => {
  await open(page); await send(page, '早餐两个肉包'); await page.getByTestId('assistant-review').click();
  await expect(page.getByTestId('food-editor')).toBeVisible();
  await page.getByTestId('food-portion-0-unit').selectOption('g'); await page.getByTestId('food-weight-0').fill('180'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.getByTestId('assistant-open').click(); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
});
test('网页版没有Key时也能明确演示文字助手', async ({ page }) => {
  test.skip(Boolean(process.env.SHIKE_E2E_APK_ASSETS), '独立APK没有本机后端，此场景仅验证H5');
  await page.goto('/'); await page.getByTestId('assistant-open').click(); await page.getByTestId('assistant-input').fill('早餐两个肉包和鸡蛋'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-messages')).toContainText('模拟模式'); await expect(page.getByTestId('assistant-draft')).toBeVisible(); await expect(page.getByTestId('assistant-store-food-0')).toBeDisabled(); await page.getByTestId('assistant-save').click(); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
});

test('文字AI草稿可以单独存为常用，并从首页带原份量重新添加', async ({ page }) => {
  await open(page); await send(page, '两个肉包')
  await page.getByTestId('assistant-store-food-0').click()
  await expect(page.getByTestId('assistant-store-food-0')).toContainText('已存为常用')
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click()
  await expect(page.getByTestId('meal-record')).toHaveCount(0)
  await page.reload(); await page.getByTestId('open-personal-library').click()
  await page.getByTestId('personal-filter-AI 识别').click()
  const item = page.locator('article[data-testid^="personal-food-"]')
  await expect(item).toHaveCount(1); await expect(item).toContainText('160 g')
  await item.getByRole('button', { name: '加入这一餐' }).click()
  await expect(page.getByTestId('food-name-0')).toHaveValue(/肉包/)
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('160 g')
})

test('照片加描述发送后可连续追问，问答保留草稿；新对话清空图片和历史', async ({ page }) => {
  await open(page);
  const image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#bcd9aa' } }).png().toBuffer();
  await page.getByTestId('assistant-image-input').setInputFiles({ name: '合成餐食.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await page.getByRole('button', { name: '查看待发送图片' }).click(); await expect(page.getByTestId('assistant-image-preview')).toBeVisible(); await page.keyboard.press('Escape');
  await send(page, '早餐吃了两个肉包，这是照片');
  await expect(page.getByTestId('assistant-attachment')).toHaveCount(0);
  await expect(page.getByTestId('assistant-messages').locator('img')).toHaveCount(1);
  let calls = await page.evaluate(() => (window as any).__assistantCalls.map((item: string) => JSON.parse(item)));
  expect(calls[0].imageBase64).toMatch(/^\/9j\//); expect(calls[0].history).toEqual([]);
  await send(page, '问一下刚才照片的搭配');
  await expect(page.getByTestId('meal-assistant').getByTestId('close-sheet')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'AI记餐助手' })).toBeInViewport();
  await expect(page.getByTestId('assistant-messages').locator('.assistant-bubble.assistant').last()).toBeInViewport();
  calls = await page.evaluate(() => (window as any).__assistantCalls.map((item: string) => JSON.parse(item)));
  expect(calls[1].imageBase64).toBeUndefined(); expect(calls[1].history[0]).toMatchObject({ role: 'user', text: '早餐吃了两个肉包，这是照片', imageBase64: calls[0].imageBase64 });
  await expect(page.getByTestId('assistant-food-0')).toContainText('160 g'); await expect(page.getByTestId('meal-record')).toHaveCount(0);
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/meal-assistant-images-mobile.png' });
  await page.getByTestId('assistant-new').click(); await expect(page.getByTestId('assistant-messages').locator('img')).toHaveCount(0); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await send(page, '两个肉包');
  expect(await page.evaluate(() => JSON.parse((window as any).__assistantCalls.at(-1)).history)).toEqual([]);
});

test('单独发图片可发送，失败保留图片和描述，移除附件与无效文件校验', async ({ page }) => {
  await open(page);
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ad5' } }).png().toBuffer();
  await page.getByTestId('assistant-image-input').setInputFiles({ name: '合成图片.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByTestId('assistant-send')).toBeEnabled();
  await page.evaluate(() => { (window as any).__assistantFail = true; });
  await page.getByTestId('assistant-input').fill('这是我的午饭'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toBeVisible(); await expect(page.getByTestId('assistant-attachment')).toBeVisible(); await expect(page.getByTestId('assistant-input')).toHaveValue('这是我的午饭');
  await page.evaluate(() => { (window as any).__assistantFail = false; }); await page.getByTestId('assistant-input').fill(''); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-attachment')).toHaveCount(0); await expect(page.getByTestId('assistant-draft')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse((window as any).__assistantCalls.at(-1)).text)).toBe('');
  await page.getByTestId('assistant-image-input').setInputFiles({ name: '伪装.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await expect(page.getByTestId('assistant-error')).toContainText('无法读取'); await expect(page.getByTestId('assistant-attachment')).toHaveCount(0);
  await page.getByTestId('assistant-image-input').setInputFiles({ name: '合成图片.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByTestId('assistant-attachment')).toBeVisible(); await page.getByTestId('assistant-remove-photo').click(); await expect(page.getByTestId('assistant-send')).toBeDisabled();
});

for (const detailed of [false, true]) test(`图片记餐${detailed ? '转详细编辑' : '直接保存'}保留多图，保存后查看与新餐不串图`, async ({ page }) => {
  await open(page);
  const image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#bcd9aa' } }).png().toBuffer();
  const another = await sharp({ create: { width: 500, height: 700, channels: 3, background: '#e8ccaa' } }).png().toBuffer();
  for (const [index, buffer] of [image, another].entries()) {
    await page.getByTestId('assistant-image-input').setInputFiles({ name: `餐食${index}.png`, mimeType: 'image/png', buffer });
    await expect(page.getByTestId('assistant-attachment')).toBeVisible();
    await send(page, index === 0 ? '早餐两个肉包，这是照片' : '补充另一张照片，份量不变');
  }
  if (detailed) {
    await page.getByTestId('assistant-review').click(); await expect(page.getByTestId('enlarge-photo')).toBeVisible();
    await page.getByTestId('enlarge-photo').click(); await expect(page.getByTestId('photo-page')).toHaveText('1 / 2');
    await page.keyboard.press('Escape'); await page.getByTestId('save-meal').click();
  } else {
    await page.getByTestId('assistant-save').click(); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
    await page.getByTestId('meal-assistant').getByTestId('close-sheet').click();
  }
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await page.reload();
  await page.getByTestId('view-meal-photo').click(); await expect(page.getByTestId('photo-page')).toHaveText('1 / 2');
  const first = await page.getByTestId('meal-photo-image').getAttribute('src');
  await page.getByRole('button', { name: '下一张照片' }).click(); await expect(page.getByTestId('photo-page')).toHaveText('2 / 2');
  expect(await page.getByTestId('meal-photo-image').getAttribute('src')).not.toBe(first);
  await page.keyboard.press('Escape'); await page.getByTestId('assistant-open').click(); await send(page, '两个肉包');
  await page.getByTestId('assistant-save').click(); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(2); await expect(page.getByTestId('view-meal-photo')).toHaveCount(1);
});
