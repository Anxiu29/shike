import { openPhotoEditor } from './helpers/photo-editor';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { routeApkAssets } from './helpers/apk-assets';
import { personalProviders } from '@shike/shared';

test.beforeEach(async ({ page }) => { await routeApkAssets(page); });

async function tab(page: Page, name: 'settings' | 'diary') {
  const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click();
}
async function nativeBridge(page: Page) {
  // 模拟 Capacitor 契约，不安装产品后门，不使用真实 Key 或访问真实模型。
  // 这里只覆盖页面与桥接交互；Keystore/原生 HTTP 仍需 Android 真机验收。
  await page.addInitScript(() => {
    const nativeWindow = window as unknown as Record<string, any>;
    nativeWindow.androidBridge = {};
    const methods = ['getState', 'saveProfile', 'activate', 'deleteProfile', 'clearProfiles', 'testProfile', 'recognize'];
    const state = JSON.parse(sessionStorage.getItem('test-native-metadata') || '{"profiles":[],"activeId":null}');
    const persist = () => sessionStorage.setItem('test-native-metadata', JSON.stringify(state));
    nativeWindow.__nativeCalls = [];
    nativeWindow.Capacitor = {
      PluginHeaders: [{ name: 'PersonalVision', methods: methods.map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (plugin: string, method: string, input: any) => {
        nativeWindow.__nativeCalls.push({ method, id: input?.id, ...(method === 'activate' && input?.model !== undefined ? { model: input.model } : {}) });
        if (method === 'getState') return structuredClone(state);
        if (method === 'saveProfile') {
          if (nativeWindow.__holdProfileSave) await new Promise<void>(resolve => { nativeWindow.__continueProfileSave = resolve; });
          if (input.models?.length > 1 && sessionStorage.getItem('test-native-group-failure')) throw new Error('该Key暂无新模型权限，原配置已保留。');
          if (input.apiKey === 'invalid-key-example') throw new Error('API Key 无效，原配置已保留。');
          // LAN HTTP 没有 randomUUID；原生插件实际用 java.util.UUID。
          const id = input.id || `790650e2-3696-43d1-927a-${String(state.profiles.length + 1).padStart(12, '0')}`;
          const profile = { id, label: input.label, provider: input.provider, model: input.model, ...(input.models ? { models: input.models } : {}) };
          const index = state.profiles.findIndex((value: any) => value.id === id);
          if (index >= 0) state.profiles[index] = profile; else state.profiles.push(profile);
          if (state.activeId === null) state.activeId = id;
        }
        if (method === 'activate') {
          const profile = state.profiles.find((profile: any) => profile.id === input.id);
          if (!profile || (input.model && !(profile.models ?? [profile.model]).includes(input.model))) throw new Error('模型未加入本组');
          if (input.model) profile.model = input.model;
          state.activeId = input.id;
        }
        if (method === 'deleteProfile') { state.profiles = state.profiles.filter((p: any) => p.id !== input.id); if (state.activeId === input.id) state.activeId = null; }
        if (method === 'clearProfiles') { state.profiles = []; state.activeId = null; }
        if (method === 'recognize') {
          const failure = sessionStorage.getItem('test-native-recognition-error');
          if (failure) throw new Error(failure);
          const p = state.profiles.find((value: any) => value.id === input.id);
          const model = input.model ?? p.model;
          if (!(p.models ?? [p.model]).includes(model)) throw new Error('模型未加入本组');
          const rawContent = sessionStorage.getItem('test-native-recognition-content') || JSON.stringify({ isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] });
          const content = model === 'glm-4.1v-thinking-flash' ? `<think>分析</think><answer><|begin_of_box|>${rawContent}<|end_of_box|></answer>` : rawContent;
          const data = p.provider === 'gemini' ? { status: 'completed', output_text: content } : { choices: [{ finish_reason: 'stop', message: { content, ...(model.startsWith('glm-5.3-') ? { reasoning_content: '{"isFood":false}' } : {}) } }] };
          return { provider: p.provider, model, data: JSON.stringify(data) };
        }
        persist(); return structuredClone(state);
      },
    };
  });
}
async function add(page: Page, label: string, provider: string, key = 'example-personal-test-key', model?: string) {
  await page.getByTestId('add-model').click();
  await page.getByTestId('model-label').fill(label);
  await page.getByTestId('model-provider').selectOption(provider);
  if (model) await page.getByTestId('model-name').selectOption(model);
  await page.getByTestId('model-api-key').fill(key);
  await page.getByTestId('save-model').click();
}

test('修改立即打开独立弹窗并回填所选组，保存操作可见，取消后焦点回到原组', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  await add(page, '百炼第一组', 'qwen'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await add(page, '智谱第二组', 'glm', 'example-second-key', 'glm-4.6v-flashx'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await add(page, '百炼第三组', 'qwen'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  const profile = page.locator('.model-profile').filter({ hasText: '智谱第二组' }), edit = profile.getByTestId('edit-model');
  const before = await page.evaluate(() => JSON.stringify((window as any).__nativeCalls));
  await edit.click(); const sheet = page.getByTestId('model-config-sheet'); await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: '修改模型配置' })).toBeInViewport(); await expect(sheet).toContainText('正在修改「智谱第二组」');
  await expect(page.getByTestId('model-label')).toHaveValue('智谱第二组'); await expect(page.getByTestId('model-provider')).toHaveValue('glm'); await expect(page.getByTestId('model-provider')).toBeDisabled();
  await expect(page.getByTestId('model-name')).toHaveValue('glm-4.6v-flashx'); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify((window as any).__nativeCalls))).toBe(before);
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 568 }); expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const id of ['save-model', 'cancel-model']) { const button = page.getByTestId(id); await expect(button).toBeInViewport(); expect(await button.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true); }
  }
  await page.getByTestId('model-label').fill('尚未保存的新名称'); await page.getByTestId('model-api-key').fill('example-unsaved-secret'); await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible(); await expect(edit).toBeFocused(); await expect(profile).toContainText('智谱第二组');
  await edit.click(); await expect(page.getByTestId('model-label')).toHaveValue('智谱第二组'); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  if (test.info().project.name === 'Chrome 手机') { await page.setViewportSize({ width: 390, height: 844 }); await sheet.screenshot({ path: 'docs/screenshots/model-edit-mobile.png' }); }
  await page.getByTestId('cancel-model').click(); await expect(edit).toBeFocused(); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await edit.click(); await page.getByTestId('model-label').fill('智谱修改完成');
  await page.evaluate(() => { (window as any).__holdProfileSave = true; }); await page.getByTestId('save-model').click();
  await expect(page.getByTestId('save-model')).toHaveText('正在测试连接…'); await expect(page.getByTestId('cancel-model')).toBeDisabled(); await expect(sheet.getByTestId('close-sheet')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(sheet).toBeVisible(); await expect(page.getByTestId('model-form')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => { (window as any).__continueProfileSave(); }); await expect(sheet).not.toBeVisible(); await expect(page.locator('.model-profile').filter({ hasText: '智谱修改完成' })).toHaveCount(1);
});

test('所有平台都有申请教程和共用Key说明，缺Key也能离线查看且不会测试模型', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  await page.getByTestId('open-model-key-guides').click();
  const sheet = page.getByTestId('model-key-help-sheet'); await expect(sheet).toBeVisible();
  await expect(page.getByTestId('key-guide-provider').locator('option')).toHaveCount(personalProviders.length);
  for (const platform of personalProviders) {
    await page.getByTestId('key-guide-provider').selectOption(platform.id);
    await expect(page.getByTestId('key-guide-title')).toContainText(platform.name);
    for (const model of platform.models) await expect(page.getByTestId('key-guide-models')).toContainText(model);
    await expect(sheet.locator('.key-guide-steps > li')).toHaveCount(4);
    await expect(sheet).toContainText('一把 Key 可以配多个模型');
    await expect(sheet).toContainText('2026-10-24');
    for (const link of await sheet.getByRole('link').all()) {
      expect(new URL((await link.getAttribute('href'))!).protocol).toBe('https:');
      await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', /noreferrer/);
    }
  }
  await page.getByTestId('key-guide-provider').selectOption('glm'); await expect(sheet).toContainText('模型标准 API');
  await expect(sheet).toContainText('个人编程套餐');
  await page.getByTestId('key-guide-provider').selectOption('gemini'); await expect(sheet).toContainText('项目');
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 568 : 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByTestId('key-guide-console').scrollIntoViewIfNeeded();
    expect(await page.getByTestId('key-guide-console').evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true);
  }
  if (test.info().project.name === 'Chrome 手机') { await page.setViewportSize({ width: 390, height: 844 }); await sheet.screenshot({ path: 'docs/screenshots/model-key-guide-mobile.png' }); }
  await page.keyboard.press('Escape'); await expect(sheet).not.toBeVisible(); await expect(page.getByTestId('open-model-key-guides')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => ['saveProfile', 'testProfile', 'recognize'].includes(call.method)))).toEqual([]);
});

test('每个模型的教程匹配平台，查看和切换教程保留未提交表单且不泄露输入Key', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings'); await page.getByTestId('add-model').click();
  await page.getByTestId('model-label').fill('尚未提交');
  for (const platform of personalProviders) for (const model of platform.models) {
    await page.getByTestId('model-provider').selectOption(platform.id); await page.getByTestId('model-name').selectOption(model);
    await page.getByTestId('model-api-key').fill('example-guide-only-key'); await page.getByTestId('model-key-help').click();
    const sheet = page.getByTestId('model-key-help-sheet'); await expect(sheet).toBeVisible();
    await expect(page.getByTestId('key-guide-provider')).toHaveValue(platform.id); await expect(page.getByTestId('key-guide-models')).toContainText(model);
    await expect(sheet).not.toContainText('example-guide-only-key');
    await page.getByTestId('key-guide-provider').selectOption(platform.id === 'glm' ? 'qwen' : 'glm');
    await page.keyboard.press('Escape'); await expect(sheet).not.toBeVisible(); await expect(page.getByTestId('model-key-help')).toBeFocused();
    await expect(page.getByTestId('model-provider')).toHaveValue(platform.id); await expect(page.getByTestId('model-name')).toHaveValue(model);
    await expect(page.getByTestId('model-label')).toHaveValue('尚未提交'); await expect(page.getByTestId('model-api-key')).toHaveValue('example-guide-only-key');
  }
  await page.getByTestId('model-provider').selectOption('qwen'); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => ['saveProfile', 'testProfile', 'recognize'].includes(call.method)))).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('example-guide-only-key');
});

test('一把Key直接管理多个模型，切换和更换Key共用同一组，旧单模型配置可原位扩展', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  await add(page, '一把百炼Key', 'qwen'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  const cards = page.locator('.model-profile'); await expect(cards).toHaveCount(1);
  await cards.getByTestId('manage-key-models').click(); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await page.getByTestId('enable-all-models').click(); await expect(page.getByTestId('model-enabled-list').getByRole('checkbox', { checked: true })).toHaveCount(4);
  await expect(page.getByTestId('model-provider')).toBeDisabled();
  await page.getByTestId('model-name').selectOption('qwen3-vl-plus');
  if (test.info().project.name === 'Chrome 手机') await page.getByTestId('model-form').screenshot({ path: 'docs/screenshots/model-key-group-mobile.png' });
  await page.evaluate(() => sessionStorage.setItem('test-native-group-failure', '1')); await page.getByTestId('save-model').click();
  await expect(page.getByTestId('model-error')).toContainText('暂无新模型权限'); await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('当前 qwen3.7-flash'); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await page.evaluate(() => sessionStorage.removeItem('test-native-group-failure')); await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(cards).toHaveCount(1); await expect(cards.locator('.profile-models .soft-tag')).toHaveCount(4);
  await tab(page, 'diary'); await openPhotoEditor(page);
  const id = '790650e2-3696-43d1-927a-000000000001', picker = page.getByTestId('recognition-model');
  await expect(picker.locator('option')).toHaveCount(4); await expect(picker).toHaveValue(id + '::qwen3-vl-plus');
  const before = await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => ['recognize', 'testProfile'].includes(call.method)).length);
  await picker.selectOption(id + '::qwen3.7-plus');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => ['recognize', 'testProfile'].includes(call.method)).length)).toBe(before);
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'group-test.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await page.reload(); await tab(page, 'settings');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('当前 qwen3.7-plus');
  await cards.getByTestId('edit-model').click(); await page.getByTestId('model-api-key').fill('example-rotated-group-key');
  await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(cards).toHaveCount(1); await expect(cards.locator('.profile-models .soft-tag')).toHaveCount(4);
  await cards.getByTestId('manage-key-models').click(); await page.getByTestId('enable-model-qwen3.7-plus').uncheck();
  await expect(page.getByTestId('model-name')).toHaveValue('qwen3.7-flash'); await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(cards.locator('.profile-models .soft-tag')).toHaveCount(3);
  await tab(page, 'diary'); await openPhotoEditor(page); await expect(picker.locator('option')).toHaveCount(3);
  await expect(picker.locator('option[value="' + id + '::qwen3.7-plus"]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭记录面板', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('example-rotated-group-key');
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('example-personal-test-key');
});

test('新增OpenRouter视觉模型共用一把Key，提示隐私及预览到期，受限不自动换模型', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  const nvidia = 'nvidia/nemotron-3.5-super-vl:free', dots = 'dots-studio/dots-3-note-preview:free';
  await page.getByTestId('add-model').click(); await page.getByTestId('model-provider').selectOption('openrouter');
  await expect(page.getByTestId('model-name')).toHaveValue(nvidia);
  await expect(page.getByTestId('model-name').locator('option')).toHaveCount(2);
  await expect(page.getByTestId('model-enabled-list')).not.toContainText('google/');
  await expect(page.getByTestId('model-cost-note')).toContainText('请勿上传人脸');
  await expect(page.getByTestId('model-enabled-list')).toContainText('2026-12-31');
  await expect(page.getByTestId('model-enabled-list')).not.toContainText('nano-omni');
  await expect(page.getByTestId('model-enabled-list')).not.toContainText('content-safety');
  await page.getByTestId('enable-model-' + dots).check();
  await page.getByTestId('model-label').fill('免费视觉共用Key'); await page.getByTestId('model-api-key').fill('new-openrouter-group-test-key');
  if (test.info().project.name === 'Chrome 手机') await page.getByTestId('model-form').screenshot({ path: 'docs/screenshots/openrouter-new-models-mobile.png' });
  await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(page.locator('.model-profile')).toHaveCount(1); await expect(page.locator('.profile-models .soft-tag')).toHaveCount(2);
  await tab(page, 'diary'); await openPhotoEditor(page);
  const id = '790650e2-3696-43d1-927a-000000000001', picker = page.getByTestId('recognition-model');
  await expect(picker.locator('option')).toHaveCount(2); await expect(picker).toHaveValue(id + '::' + nvidia);
  await expect(page.getByTestId('model-usage-notice')).toContainText('请勿上传人脸');
  await picker.selectOption(id + '::' + dots); await expect(page.getByTestId('model-usage-notice')).toContainText('2026-12-31');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize'))).toEqual([]);
  await page.evaluate(() => sessionStorage.setItem('test-native-recognition-error', '该模型暂不可用（403），请检查平台权限。'));
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'free-vision.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('403'); await expect(picker).toHaveValue(id + '::' + dots);
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize').length)).toBe(1);
  await page.evaluate(() => sessionStorage.removeItem('test-native-recognition-error'));
  await picker.selectOption(id + '::' + nvidia); await expect(page.getByTestId('model-usage-notice')).toContainText('请勿上传人脸');
  await page.getByRole('button', { name: '重试识别' }).click();
  await expect(page.getByTestId('food-name-0')).toHaveValue('白米饭（熟）'); await expect(page.getByTestId('food-weight-0')).toHaveValue('150');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  await expect(page.locator('.model-profile')).toHaveCount(1); await expect(page.locator('.model-profile')).toContainText('当前 ' + nvidia);
  await expect(page.locator('.profile-models .soft-tag')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('new-openrouter-group-test-key');
});

test('GLM营养格式异常仍可确认食物并保存，错误重量继续拒绝且不自动重试', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings'); await add(page, '智谱识别', 'glm');
  const content = { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: ['重量为照片估算'], estimatedNutrientsPer100g: { energyKcal: 99999 }, nutritionEstimateProfile: { factor: 'general', options: [] } }], uncertainties: [] };
  await page.evaluate(value => sessionStorage.setItem('test-native-recognition-content', value), JSON.stringify(content));
  await tab(page, 'diary'); await openPhotoEditor(page);
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  const image = { name: 'test.png', mimeType: 'image/png', buffer };
  await page.getByTestId('gallery-input').setInputFiles(image);
  await expect(page.getByTestId('food-name-0')).toHaveValue('白米饭（熟）'); await expect(page.getByTestId('food-weight-0')).toHaveValue('150');
  await expect(page.getByTestId('food-editor')).toContainText('已舍弃该项AI营养数值');
  const warning = page.locator('.food-warnings').filter({ hasText: '已舍弃该项AI营养数值' });
  await warning.scrollIntoViewIfNeeded(); await expect(warning).toBeInViewport();
  if (test.info().project.name === 'Chrome 手机') await page.getByTestId('food-editor').screenshot({ path: 'docs/screenshots/glm-recognition-partial-mobile.png' });
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.evaluate(value => sessionStorage.setItem('test-native-recognition-content', value), JSON.stringify({ ...content, foods: [{ ...content.foods[0], estimatedWeightG: '150克' }] }));
  await openPhotoEditor(page); await page.getByTestId('gallery-input').setInputFiles(image);
  await expect(page.getByTestId('food-editor')).toContainText('第1项食物的重量');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize').length)).toBe(1);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('meal-record')).toHaveCount(1);
});

test('GLM两款免费视觉共用Key，4.6V繁忙可手动换4.1V并保存记录', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  await page.getByTestId('add-model').click(); await page.getByTestId('model-provider').selectOption('glm');
  await expect(page.getByTestId('model-name')).toHaveValue('glm-4.1v-thinking-flash');
  await expect(page.getByTestId('model-name').locator('option')).toHaveCount(5);
  await expect(page.getByTestId('model-cost-note')).toContainText('内置思考');
  await page.getByTestId('enable-model-glm-4.6v-flash').check(); await page.getByTestId('model-name').selectOption('glm-4.6v-flash');
  await page.getByTestId('model-label').fill('智谱共用Key'); await page.getByTestId('model-api-key').fill('glm-group-test-key');
  await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(page.locator('.profile-models .soft-tag')).toHaveCount(2);
  await tab(page, 'diary'); await openPhotoEditor(page);
  const id = '790650e2-3696-43d1-927a-000000000001', picker = page.getByTestId('recognition-model');
  await expect(picker).toHaveValue(id + '::glm-4.6v-flash');
  await page.evaluate(() => sessionStorage.setItem('test-native-recognition-error', '智谱模型当前访问量过大（1305），请稍后重试或手动选择其他模型。'));
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'glm.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('1305'); await expect(picker).toHaveValue(id + '::glm-4.6v-flash');
  await picker.selectOption(id + '::glm-4.1v-thinking-flash');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize').length)).toBe(1);
  await page.evaluate(() => sessionStorage.removeItem('test-native-recognition-error'));
  await page.getByRole('button', { name: '重试识别' }).click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('150');
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  await expect(page.locator('.model-profile')).toContainText('当前 glm-4.1v-thinking-flash'); await expect(page.locator('.profile-models .soft-tag')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('glm-group-test-key');
});

test('FlashX复用旧Key且明确计费，充值教程不发模型请求，欠费时不自动换型号', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  await add(page, '智谱标准Key', 'glm', 'flashx-example-test-key'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await page.getByTestId('manage-key-models').click(); await expect(page.getByTestId('model-name')).toHaveValue('glm-4.1v-thinking-flash');
  await expect(page.getByTestId('enable-model-glm-4.6v-flashx')).not.toBeChecked();
  await page.getByTestId('enable-model-glm-4.6v-flashx').check(); await page.getByTestId('model-name').selectOption('glm-4.6v-flashx');
  await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await expect(page.getByTestId('model-cost-note')).toContainText('按量计费'); await expect(page.getByTestId('model-cost-note')).toContainText('0.15／1.5');
  const before = await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => ['saveProfile', 'testProfile', 'recognize'].includes(call.method)).length);
  await page.getByTestId('model-key-help').click(); const payment = page.getByTestId('key-guide-payment');
  await expect(payment).toContainText('先用适用资源包'); await expect(payment).toContainText('模型标准API');
  await expect(payment).toContainText('最低充值金额'); await expect(payment).toContainText('Key留空保留原Key');
  await expect(page.getByTestId('key-guide-payment-console')).toHaveAttribute('href', 'https://bigmodel.cn/console/overview');
  await expect(page.getByTestId('key-guide-payment-pricing')).toHaveAttribute('href', 'https://docs.bigmodel.cn/cn/guide/start/pricing');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => ['saveProfile', 'testProfile', 'recognize'].includes(call.method)).length)).toBe(before);
  if (test.info().project.name === 'Chrome 手机') await payment.screenshot({ path: 'docs/screenshots/glm-flashx-payment-mobile.png' });
  await page.keyboard.press('Escape'); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(page.locator('.model-profile')).toHaveCount(1); await expect(page.locator('.profile-models .soft-tag')).toHaveCount(2);
  await tab(page, 'diary'); await openPhotoEditor(page);
  const id = '790650e2-3696-43d1-927a-000000000001', picker = page.getByTestId('recognition-model');
  await expect(picker).toHaveValue(id + '::glm-4.6v-flashx'); await expect(page.getByTestId('model-usage-notice')).toContainText('测试连接也可能扣费');
  await page.evaluate(() => sessionStorage.setItem('test-native-recognition-error', '智谱账户欠费（1113），请到平台检查余额；不是模型下线。'));
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'paid-model.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('1113'); await expect(picker).toHaveValue(id + '::glm-4.6v-flashx');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize').length)).toBe(1);
  await page.evaluate(() => sessionStorage.removeItem('test-native-recognition-error')); await page.getByRole('button', { name: '重试识别' }).click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  await expect(page.locator('.model-profile')).toHaveCount(1); await expect(page.locator('.model-profile')).toContainText('当前 glm-4.6v-flashx');
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('flashx-example-test-key');
});

test('5.3资源包型号共用标准Key，额度提示与轻度思考结果可保存，用量错误不自动换模型', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await tab(page, 'settings');
  await add(page, '智谱资源包Key', 'glm', 'glm53-resource-example-key'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await page.getByTestId('manage-key-models').click(); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await expect(page.getByTestId('model-name').locator('option')).toHaveCount(5);
  for (const model of ['glm-5.3-flash', 'glm-5.3-flashx']) await page.getByTestId('enable-model-' + model).check();
  await page.getByTestId('model-name').selectOption('glm-5.3-flash'); await expect(page.getByTestId('model-cost-note')).toContainText('资源包／按量');
  await expect(page.getByTestId('model-cost-note')).toContainText('无法完全关闭');
  await page.getByTestId('model-key-help').click(); await expect(page.getByTestId('key-guide-payment')).toContainText('不把不同模型额度相加');
  await expect(page.getByTestId('key-guide-payment')).toContainText('glm-5.3-flashx'); await page.keyboard.press('Escape');
  await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(page.locator('.model-profile')).toHaveCount(1); await expect(page.locator('.profile-models .soft-tag')).toHaveCount(3);
  await tab(page, 'diary'); await openPhotoEditor(page); const id = '790650e2-3696-43d1-927a-000000000001', picker = page.getByTestId('recognition-model');
  await expect(picker).toHaveValue(id + '::glm-5.3-flash'); await expect(page.getByTestId('model-usage-notice')).toContainText('只用赠送额度');
  await picker.selectOption(id + '::glm-5.3-flashx');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize'))).toEqual([]);
  await page.evaluate(() => sessionStorage.setItem('test-native-recognition-error', '已达到智谱使用上限（1308），请到平台查看重置时间。'));
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'grant-vision.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('1308'); await expect(picker).toHaveValue(id + '::glm-5.3-flashx');
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize').length)).toBe(1);
  await page.evaluate(() => sessionStorage.removeItem('test-native-recognition-error')); await page.getByRole('button', { name: '重试识别' }).click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  await expect(page.locator('.model-profile')).toContainText('当前 glm-5.3-flashx');
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('glm53-resource-example-key');
});

test('手机多 Key 多模型：添加、切换、识别保存、刷新和删除不自动改选', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible();
  await tab(page, 'settings'); await expect(page.getByTestId('personal-models')).toBeVisible();
  await add(page, '我的百炼', 'qwen'); await expect(page.getByTestId('active-model')).toHaveCount(1);
  await add(page, 'Gemini 备用', 'gemini'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  const cards = page.locator('.model-profile'); await expect(cards).toHaveCount(2);
  await cards.filter({ hasText: 'Gemini 备用' }).getByTestId('activate-model').click();
  await expect(cards.filter({ hasText: 'Gemini 备用' }).getByTestId('active-model')).toBeVisible();
  const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stores).not.toContain('example-personal-test-key');
  await tab(page, 'diary'); await openPhotoEditor(page);
  await expect(page.getByTestId('recognition-model')).toHaveValue('790650e2-3696-43d1-927a-000000000002');
  await page.getByTestId('recognition-model').selectOption('790650e2-3696-43d1-927a-000000000001');
  await page.getByTestId('recognition-model').selectOption('790650e2-3696-43d1-927a-000000000002');
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await expect(page.getByTestId('food-editor')).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  await expect(cards.filter({ hasText: 'Gemini 备用' }).getByTestId('active-model')).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
  await cards.filter({ hasText: 'Gemini 备用' }).getByTestId('delete-model').click();
  await expect(cards).toHaveCount(1); await expect(page.getByTestId('active-model')).toHaveCount(0);
  await tab(page, 'diary'); await expect(page.getByTestId('meal-record')).toHaveCount(1);
});

test('免费视觉模型标注额度、手动切换，新来源识别保存后可恢复', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible(); await tab(page, 'settings');
  await page.getByTestId('add-model').click();
  await page.getByTestId('model-provider').selectOption('siliconflow');
  await expect(page.getByTestId('model-name')).toHaveValue('Qwen/Qwen3.5-4B');
  await expect(page.getByTestId('model-cost-note')).toContainText('平台免费');
  if (test.info().project.name === 'Chrome 手机') await page.getByTestId('model-form').screenshot({ path: 'artifacts/android/free-model-form-mobile.png' });
  await page.getByTestId('model-label').fill('硅基免费'); await page.getByTestId('model-api-key').fill('new-free-test-key'); await page.getByTestId('save-model').click();
  await expect(page.getByTestId('model-form')).toHaveCount(0);
  await add(page, 'OpenRouter免费', 'openrouter', 'example-personal-test-key', 'nvidia/nemotron-3.5-super-vl:free'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  const cards = page.locator('.model-profile');
  const gemma = cards.filter({ hasText: 'OpenRouter免费' });
  await gemma.getByTestId('edit-model').click();
  await expect(page.getByTestId('model-cost-note')).toContainText('零价格');
  await page.getByTestId('model-name').selectOption('dots-studio/dots-3-note-preview:free'); await page.getByTestId('save-model').click();
  await expect(page.getByTestId('model-form')).toHaveCount(0);
  await add(page, '百炼视觉', 'qwen', 'qwen-visual-test-key', 'qwen3-vl-plus'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await expect(cards).toHaveCount(3); await expect(cards.filter({ hasText: '百炼视觉' })).toContainText('赠送额度');
  await tab(page, 'diary'); await openPhotoEditor(page);
  const picker = page.getByTestId('recognition-model');
  await picker.selectOption('790650e2-3696-43d1-927a-000000000002');
  await expect(picker).toHaveValue('790650e2-3696-43d1-927a-000000000002');
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'free-model.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  await expect(gemma.getByTestId('active-model')).toBeVisible(); await expect(gemma).toContainText('dots-studio/dots-3-note-preview:free');
  const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stores).not.toContain('new-free-test-key'); expect(stores).not.toContain('qwen-visual-test-key'); expect(stores).not.toContain('example-personal-test-key');
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport);
});

test('测试失败保留配置、输入框清 Key，可改模型且默认隐藏自建服务', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible(); await tab(page, 'settings');
  await add(page, '百炼日常', 'qwen'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await page.getByTestId('edit-model').click();
  await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await page.getByTestId('model-api-key').fill('invalid-key-example'); await page.getByTestId('save-model').click();
  await expect(page.getByTestId('model-error')).toContainText('原配置已保留'); await expect(page.getByTestId('model-api-key')).toHaveValue('');
  await expect(page.locator('.model-profile')).toHaveCount(1);
  await page.getByTestId('model-name').selectOption('qwen3.7-plus'); await page.getByTestId('save-model').click();
  await expect(page.locator('.model-profile')).toContainText('qwen3.7-plus');
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); expect(size.width).toBeLessThanOrEqual(size.viewport);
  await expect(page.getByTestId('ai-route-service')).toHaveCount(0); await expect(page.getByTestId('service-connection')).toHaveCount(0); await expect(page.locator('.model-profile')).toHaveCount(1);
});

test('DeepSeek视觉配置明确计费，余额错误保留模型，手动重试后可编辑保存', async ({ page }) => {
  await nativeBridge(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible(); await tab(page, 'settings');
  await page.getByTestId('add-model').click(); await page.getByTestId('model-provider').selectOption('deepseek');
  await expect(page.getByTestId('model-name')).toHaveValue('deepseek-flash');
  await expect(page.getByTestId('model-name').locator('option')).toHaveCount(1);
  await expect(page.getByTestId('model-cost-note')).toContainText('按量计费');
  await expect(page.getByTestId('model-cost-note').getByRole('link')).toHaveAttribute('href', 'https://platform.deepseek.com/api_keys');
  if (test.info().project.name === 'Chrome 手机') await page.getByTestId('model-form').screenshot({ path: 'artifacts/android/deepseek-model-form-mobile.png' });
  await page.getByTestId('model-label').fill('我的DeepSeek'); await page.getByTestId('model-api-key').fill('deepseek-example-test-key'); await page.getByTestId('save-model').click(); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await add(page, '硅基备用', 'siliconflow'); await expect(page.getByTestId('model-form')).toHaveCount(0);
  await tab(page, 'diary'); await openPhotoEditor(page);
  const selectedId = '790650e2-3696-43d1-927a-000000000001';
  await expect(page.getByTestId('recognition-model')).toHaveValue(selectedId);
  await page.evaluate(() => sessionStorage.setItem('test-native-recognition-error', '模型账户余额不足（402），请到提供商控制台检查。'));
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
  await page.getByTestId('gallery-input').setInputFiles({ name: 'deepseek.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('editor-error')).toContainText('余额不足'); await expect(page.getByTestId('recognition-model')).toHaveValue(selectedId);
  expect(await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize').length)).toBe(1);
  await page.evaluate(() => sessionStorage.removeItem('test-native-recognition-error'));
  await page.getByRole('button', { name: '重试识别' }).click();
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('food-weight-0').fill('125'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(1);
  const calls = await page.evaluate(() => (window as any).__nativeCalls.filter((call: any) => call.method === 'recognize'));
  expect(calls).toEqual([{ method: 'recognize', id: selectedId }, { method: 'recognize', id: selectedId }]);
  await page.reload(); await expect(page.getByTestId('meal-record')).toHaveCount(1); await tab(page, 'settings');
  const deepseek = page.locator('.model-profile').filter({ hasText: '我的DeepSeek' });
  await expect(deepseek.getByTestId('active-model')).toBeVisible(); await expect(deepseek).toContainText('按量计费');
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('deepseek-example-test-key');
});
