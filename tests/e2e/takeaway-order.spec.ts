import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';

// 模型替身只验证调用链和交互，不宣称能够测出真实OCR/套餐理解准确率。
async function openOrder(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, id = '790650e2-3696-43d1-927a-596f3e69de84';
    w.androidBridge = {}; w.__orderCalls = [];
    w.Capacitor = { PluginHeaders: [{ name: 'PersonalVision', methods: ['getState', 'activate', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) }], nativePromise: async (_plugin: string, method: string, input: any) => {
      if (method === 'getState' || method === 'activate') return { profiles: [{ id, label: '订单测试模型', provider: 'qwen', model: 'qwen3.7-flash' }], activeId: id };
      if (method === 'describeMeal') {
        w.__orderCalls.push(input);
        if (w.__orderFail) throw new Error('订单识读失败，原草稿已保留。');
        const request = JSON.parse(input.request);
        const question = /问一下/.test(request.text);
        const draft = { intent: question ? 'question' : 'update', date: request.date, mealType: request.previous?.mealType ?? request.mealType,
          foods: question ? [] : [{ name: '肉包', amount: /只吃两个/.test(request.text) ? 2 : 6, unit: '个' }],
          message: question ? '请按实际吃下的数量调整。' : '已整理订单草稿，下单数量不等于实际摄入，请核对。' };
        return { provider: 'qwen', model: 'qwen3.7-flash', data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }) };
      }
    } };
  });
  await page.goto('/');
  await page.getByTestId('assistant-open').click();
  await page.getByTestId('assistant-input-kind').selectOption('order');
  await expect(page.getByTestId('assistant-order-notice')).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-input')).toHaveValue('');
  await expect(page.getByTestId('assistant-draft')).toBeVisible();
}
const screenshot = async () => ({ name: '合成订单.png', mimeType: 'image/png', buffer: await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="white"/><text x="40" y="80" font-size="32">Order test: buns (2 pcs) x 3</text></svg>')).png().toBuffer() });

test.beforeEach(async ({ page }) => { await routeApkAssets(page); });

test('订单文字生成待核对草稿，修改后重新确认，重复点击只保存一次', async ({ page }) => {
  await openOrder(page); await send(page, '肉包（2个装）×3，配送费3元，餐具1份');
  await expect(page.getByTestId('assistant-food-0')).toContainText('480 g');
  await expect(page.getByTestId('assistant-save')).toBeDisabled();
  await expect(page.getByTestId('assistant-input-kind')).toBeDisabled();
  // 即使绕过按钮禁用，保存函数也应挡住未核对的订单。
  await page.getByTestId('assistant-save').evaluate((button: HTMLButtonElement) => { button.disabled = false; button.click(); });
  await expect(page.getByTestId('assistant-error')).toContainText('按实际食用量核对');
  await expect(page.getByTestId('meal-record')).toHaveCount(0);
  await page.getByTestId('assistant-order-reviewed').check();
  await page.getByTestId('assistant-amount-0').fill('2'); await page.getByTestId('assistant-amount-0').press('Tab');
  await expect(page.getByTestId('assistant-order-reviewed')).not.toBeChecked();
  await expect(page.getByTestId('assistant-food-0')).toContainText('160 g');
  await page.getByTestId('assistant-order-reviewed').check();
  await page.getByTestId('assistant-save').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click();
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await expect(page.getByTestId('meal-record')).toContainText('160 g');
  await expect(page.getByTestId('view-meal-photo')).toHaveCount(0);
});

test('订单截图失败保留附件，追问保留草稿，修改后重新核对，保存不存截图', async ({ page }) => {
  await openOrder(page);
  await page.getByTestId('assistant-image-input').setInputFiles(await screenshot());
  await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await page.evaluate(() => { (window as any).__orderFail = true; });
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toContainText('订单识读失败');
  await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await page.evaluate(() => { (window as any).__orderFail = false; });
  await send(page, '');
  const call = await page.evaluate(() => (window as any).__orderCalls.at(-1));
  expect(JSON.parse(call.request)).toMatchObject({ inputKind: 'order', text: '', imageBase64: expect.stringMatching(/^\/9j\//) });
  expect(call.prompt).toContain('本次inputKind=order');
  await expect(page.getByTestId('assistant-retained-photos')).toHaveCount(0);
  await page.getByTestId('assistant-order-reviewed').check();
  await send(page, '问一下怎样调整数量');
  await expect(page.getByTestId('assistant-order-reviewed')).toBeChecked();
  await send(page, '我只吃两个');
  await expect(page.getByTestId('assistant-amount-0')).toHaveValue('2');
  await expect(page.getByTestId('assistant-save')).toBeDisabled();
  const followup = await page.evaluate(() => JSON.parse((window as any).__orderCalls.at(-1).request));
  expect(followup.history[0].imageBase64).toMatch(/^\/9j\//);
  if (test.info().project.name === 'Chrome 手机') await page.screenshot({ path: 'artifacts/takeaway-order-mobile.png' });
  await page.getByTestId('assistant-order-reviewed').check(); await page.getByTestId('assistant-save').click();
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
  await send(page, '肉包×6');
  expect(await page.evaluate(() => JSON.parse((window as any).__orderCalls.at(-1).request).history)).toEqual([]);
  await page.getByTestId('assistant-new').click();
  await expect(page.getByTestId('assistant-input-kind')).toHaveValue('meal');
  await expect(page.getByTestId('assistant-messages').locator('img')).toHaveCount(0);
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click();
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await expect(page.getByTestId('view-meal-photo')).toHaveCount(0);
});

test('订单转详细编辑保留来源警告，可以修改克数，截图不写入餐次', async ({ page }) => {
  await openOrder(page);
  await page.getByTestId('assistant-image-input').setInputFiles(await screenshot());
  await expect(page.getByTestId('assistant-attachment')).toBeVisible();
  await send(page, '整理订单'); await page.getByTestId('assistant-review').click();
  await expect(page.getByTestId('food-editor')).toBeVisible();
  await expect(page.getByTestId('food-editor')).toContainText('下单数量不等于实际摄入');
  await expect(page.getByTestId('enlarge-photo')).toHaveCount(0);
  await page.getByTestId('food-portion-0-unit').selectOption('g'); await page.getByTestId('food-weight-0').fill('180');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('180 g');
  await page.getByTestId('assistant-open').click(); await expect(page.getByTestId('assistant-draft')).toHaveCount(0);
});

test('Mock订单模式明确拒绝识读，不拿固定演示份量创建订单记录', async ({ page }) => {
  test.skip(Boolean(process.env.SHIKE_E2E_APK_ASSETS), '此场景使用H5的Mock服务');
  await page.goto('/'); await page.getByTestId('assistant-open').click();
  await page.getByTestId('assistant-input-kind').selectOption('order');
  await page.getByTestId('assistant-input').fill('肉包×6'); await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-messages')).toContainText('不能识别外卖订单');
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(0);
});
