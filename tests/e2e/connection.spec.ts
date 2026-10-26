import { openManualMeal } from './helpers/manual-food';
import { test, expect, type Page } from '@playwright/test';

async function tab(page: Page, name: 'settings' | 'diary') {
  const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}
test('AI 后端不可达时仍立即打开、离线手动记录并刷新恢复', async ({ page }) => {
  await page.route('**/api/health', route => route.abort('internetdisconnected'));
  await page.goto('/');
  await expect(page.getByTestId('daily-summary')).toBeVisible();
  await openManualMeal(page);
  await page.getByTestId('food-name-0').fill('米饭');
  await page.getByTestId('food-weight-0').fill('150');
  await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await tab(page, 'settings'); await expect(page.getByTestId('local-ai-service')).toBeVisible();
  await expect(page.getByTestId('service-connection')).toHaveCount(0);
});

test('默认停用自建云端，旧地址与令牌不会触发外部请求或影响本地记录', async ({ page }) => {
  let external = 0;
  await page.addInitScript(() => { localStorage.setItem('shike-api-connection-v1', JSON.stringify({ baseUrl: 'https://old-service.example.test', token: 'old.signature', expiresAt: '2099-01-01T00:00:00Z' })); localStorage.setItem('shike-ai-route-v1', 'service'); });
  await page.route('https://old-service.example.test/**', route => { external++; return route.abort(); });
  await page.goto('/'); await openManualMeal(page);
  await page.getByTestId('food-name-0').fill('米饭'); await page.getByTestId('food-weight-0').fill('100'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await tab(page, 'settings'); await expect(page.getByTestId('local-ai-service')).toContainText('自建云端连接暂未启用'); await expect(page.getByTestId('service-connection')).toHaveCount(0);
  expect(external).toBe(0);
});

test('网页版缺Key且AI服务不可达时可查看各平台教程，正确展示服务端配置且不调用模型', async ({ page }) => {
  const modelRequests: string[] = [];
  const origin = new URL(test.info().project.use.baseURL!).origin;
  page.on('request', request => { if (request.method() === 'POST' || new URL(request.url()).origin !== origin) modelRequests.push(request.url()); });
  await page.route('**/api/health', route => route.abort('internetdisconnected'));
  await page.goto('/'); await tab(page, 'settings');
  await expect(page.getByTestId('personal-models')).toHaveCount(0);
  const opener = page.getByTestId('open-web-model-key-guides'); await opener.click();
  const sheet = page.getByTestId('web-model-key-help-sheet'); await expect(sheet).toBeVisible();
  const platforms = [
    { id: 'qwen', name: '阿里云百炼', env: 'DASHSCOPE_API_KEY', host: 'bailian.console.aliyun.com' },
    { id: 'deepseek', name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', host: 'platform.deepseek.com' },
    { id: 'siliconflow', name: '硅基流动', env: 'SILICONFLOW_API_KEY', host: 'cloud.siliconflow.cn' },
    { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY', host: 'openrouter.ai' },
    { id: 'gemini', name: 'Google Gemini', env: 'GEMINI_API_KEY', host: 'aistudio.google.com' },
    { id: 'glm', name: '智谱 GLM', env: 'ZHIPU_API_KEY', host: 'bigmodel.cn' },
  ];
  await expect(sheet.getByTestId('key-guide-provider').locator('option')).toHaveCount(platforms.length);
  for (const platform of platforms) {
    await sheet.getByTestId('key-guide-provider').selectOption(platform.id);
    await expect(sheet.getByTestId('key-guide-title')).toContainText(platform.name);
    await expect(sheet.getByTestId('key-guide-env')).toHaveText(`AI_PROVIDER=${platform.id}\nAI_MODE=auto\n${platform.env}=替换为你申请的Key`);
    await expect(sheet.locator('.key-guide-steps > li')).toHaveCount(4);
    await expect(sheet.locator('.key-guide-steps')).toContainText('重启食刻的 Node 服务');
    await expect(sheet).toContainText('一把 Key 可以配多个模型');
    await expect(sheet).toContainText('服务会列出食刻已适配的型号');
    await expect(sheet).not.toContainText('管理可用模型'); await expect(sheet).not.toContainText('测试并保存');
    expect(new URL((await sheet.getByTestId('key-guide-console').getAttribute('href'))!).hostname).toBe(platform.host);
    for (const link of await sheet.getByRole('link').all()) {
      expect(new URL((await link.getAttribute('href'))!).protocol).toBe('https:');
      await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', /noreferrer/);
    }
  }
  await expect(sheet.locator('input')).toHaveCount(0);
  await sheet.locator('.key-guide-errors summary').click(); await expect(sheet).toContainText('仍显示模拟模式');
  await sheet.getByTestId('key-guide-provider').selectOption('qwen');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await sheet.locator('.sheet-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await sheet.getByTestId('key-guide-env').scrollIntoViewIfNeeded(); await expect(sheet.getByTestId('key-guide-env')).toBeInViewport();
  }
  if (test.info().project.name === 'Chrome 手机') {
    await sheet.locator('.sheet-body').evaluate(element => { element.scrollTop = 0; });
    await sheet.screenshot({ path: 'docs/screenshots/web-model-key-guide-mobile.png' });
  }
  await page.keyboard.press('Escape'); await expect(sheet).not.toBeVisible(); await expect(opener).toBeFocused();
  expect(modelRequests).toEqual([]);
});
