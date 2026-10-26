import { openPhotoEditor } from './helpers/photo-editor';
import { openManualMeal } from './helpers/manual-food';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { parseOffProduct } from '@shike/shared';
const code = '3274080005003';
const product = () => parseOffProduct({ status: 1, product: { code, product_name_zh: '测试免费饮料', brands: '测试品牌', quantity: '250 ml', nutriments: { 'energy-kcal_100g': 40, proteins_100g: 1, fat_100g: 0, carbohydrates_100g: 9 } } }, code)!;
async function tab(page: Page, name: 'diary' | 'settings') { const button = page.getByTestId(`tab-${name}`); await (await button.isVisible() ? button : page.getByTestId(`desktop-tab-${name}`)).click(); }
async function library(page: Page) { await openPhotoEditor(page); await page.getByTestId('open-package-library').click(); await expect(page.getByTestId('packaged-library')).toBeVisible(); }

test('UPC补零查询后用原条码离线命中同一商品，不重复请求或收录', async ({ page }) => {
  const upc = '034000470693', ean = '0034000470693'; let calls = 0;
  const food = parseOffProduct({ status: 1, product: { code: ean, product_name: 'UPC合成测试', quantity: '100 g', nutriments: { 'energy-kcal_100g': 100 } } }, upc)!;
  await page.route('**/api/packaged-foods/**', route => { calls++; expect(route.request().url()).toContain(ean); return route.fulfill({ json: { product: food } }); });
  await page.goto('/'); await library(page); await page.getByTestId('catalog-barcode').fill(upc); await page.getByTestId('catalog-query').click(); await expect(page.getByTestId('catalog-preview')).toContainText('UPC合成测试'); await expect(page.getByTestId('catalog-barcode')).toHaveValue(ean);
  await page.getByTestId('save-catalog-product').click(); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1); await page.getByTestId('close-sheet').click(); await page.getByTestId('open-package-library').click(); await page.getByTestId('catalog-barcode').fill(upc); await page.getByTestId('catalog-query').click(); await expect(page.getByTestId('catalog-message')).toContainText('本地找到'); expect(calls).toBe(1); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1);
});

test('免费条码查询、显式入库、摄入量重填、离线复用与删除不改历史，v8备份保留来源', async ({ page }, info) => {
  let queries = 0;
  await page.route('**/api/packaged-foods/**', route => { queries++; return route.fulfill({ json: { product: product() } }); });
  await page.goto('/'); await library(page); await page.getByTestId('catalog-barcode').fill(code); await page.getByTestId('catalog-query').click();
  await expect(page.getByTestId('catalog-preview')).toContainText('测试品牌'); await expect(page.getByTestId('catalog-preview')).toContainText('ODbL-1.0');
  await expect(page.getByTestId('packaged-library-row')).toHaveCount(0); await page.getByTestId('save-catalog-product').click(); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1);
  if (info.project.name === 'Chrome 手机') await page.getByTestId('packaged-library').screenshot({ path: 'docs/screenshots/packaged-library-mobile.png' });
  await page.getByTestId('use-catalog-product').click(); await expect(page.getByTestId('package-amount-0')).toHaveValue(''); await expect(page.getByTestId('food-calories-0')).toHaveText('待补充');
  await page.getByTestId('package-half-0').click(); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('daily-calories')).toContainText('50'); await page.reload();
  await library(page); await page.getByTestId('package-library-search').fill('测试品牌'); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1);
  await page.getByTestId('catalog-barcode').fill(code); await page.getByTestId('catalog-query').click(); await expect(page.getByTestId('catalog-message')).toContainText('本地找到'); expect(queries).toBe(1);
  await page.getByTestId('use-packaged-food').click(); await expect(page.getByTestId('package-amount-0')).toHaveValue('');
  await page.getByRole('button', { name: '关闭记录面板', exact: true }).click();
  await tab(page, 'settings'); const downloadPending = page.waitForEvent('download'); await page.getByTestId('export-backup').click(); const stream = await (await downloadPending).createReadStream(); if (!stream) throw new Error('没有备份');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const buffer = Buffer.concat(chunks), backup = JSON.parse(buffer.toString());
  expect(backup.schemaVersion).toBe(10); expect(backup.packagedFoods[0].source.license).toBe('ODbL-1.0'); expect(backup.meals[0].items[0].packageSnapshot.consumedAmount).toBe(0.5);
  await page.getByTestId('manage-packaged-foods').click(); page.once('dialog', dialog => dialog.accept()); await page.getByTestId('delete-packaged-food').click(); await expect(page.getByTestId('packaged-library-row')).toHaveCount(0); await page.getByTestId('close-sheet').click();
  await tab(page, 'diary'); await expect(page.getByTestId('daily-calories')).toContainText('50');
  await tab(page, 'settings'); await page.getByTestId('backup-input').setInputFiles({ name: 'catalog.json', mimeType: 'application/json', buffer }); await expect(page.getByTestId('backup-preview')).toContainText('1 项包装食品'); await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复');
  await page.getByTestId('manage-packaged-foods').click(); await expect(page.getByTestId('packaged-library-row')).toHaveCount(1);
});

test('手工标签入库后可搜索复用，模拟标签不能入真实库', async ({ page }) => {
  await page.goto('/'); await openPhotoEditor(page); await page.getByTestId('add-package').click(); await page.getByTestId('food-name-0').fill('手填测试饼干');
  await page.getByTestId('package-correction-0').locator('summary').click(); await page.getByTestId('package-basis-0').selectOption('100g'); await page.getByTestId('package-energy-unit-0').selectOption('kcal'); await page.getByTestId('package-energy-0').fill('400');
  await page.getByTestId('save-package-library-0').click(); await page.getByTestId('library-brand').fill('手工品牌'); await page.getByTestId('library-save-barcode').fill(code); await page.getByTestId('confirm-save-package').click(); await expect(page.getByTestId('catalog-message')).toContainText('已保存');
  await page.getByTestId('close-sheet').click(); await page.getByRole('button', { name: '关闭记录面板', exact: true }).click(); await library(page); await page.getByTestId('package-library-search').fill('手工品牌'); await page.getByTestId('use-packaged-food').click(); await expect(page.getByTestId('food-name-0')).toHaveValue('手填测试饼干'); await expect(page.getByTestId('package-amount-0')).toHaveValue('');
  await page.getByRole('button', { name: '关闭记录面板', exact: true }).click();
  await page.route('**/api/recognitions', route => route.fulfill({ json: { mode: 'mock', provider: 'mock', model: 'synthetic', result: { isFood: true, foods: [{ name: '模拟饼干', estimatedWeightG: null, visibleIngredients: [], uncertainties: [], packageLabel: product().label }], uncertainties: [] } } }));
  await openPhotoEditor(page); const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer(); await page.getByTestId('gallery-input').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image }); await expect(page.getByTestId('save-package-library-0')).toBeDisabled();
});

test('本地读取EAN13照片只请求条码数字，查不到时不调用AI', async ({ page }) => {
  let queries = 0, ai = 0;
  await page.route('**/api/packaged-foods/**', route => { queries++; expect(route.request().url()).toContain(code); expect(route.request().method()).toBe('GET'); expect(route.request().postData()).toBeNull(); return route.fulfill({ json: { product: null } }); });
  await page.route('**/api/recognitions', route => { ai++; return route.abort(); });
  // 公开条码的标准EAN13黑白条纹；合成测试图，不含商品照片或个人内容。
  const left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const odd = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'][Number(code[0])]!;
  let bits = '101'; for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? left : odd)[Number(code[i])]; bits += '01010'; for (let i = 7; i <= 12; i++) bits += left[Number(code[i])]!.replace(/[01]/g, value => value === '1' ? '0' : '1'); bits += '101';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="220"><rect width="460" height="220" fill="white"/>${[...bits].map((bit, i) => bit === '1' ? `<rect x="${40 + i * 4}" y="20" width="4" height="180"/>` : '').join('')}</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer(); await page.goto('/'); await library(page); await page.getByTestId('barcode-photo-input').setInputFiles({ name: 'public-barcode.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('catalog-barcode')).toHaveValue(code); await expect(page.getByTestId('catalog-message')).toContainText('尚未收录'); expect(queries).toBe(1); expect(ai).toBe(0);
});

test('摄入与剩余切换保留偏好，未设预算不伪造剩余', async ({ page }) => {
  await page.goto('/'); await openManualMeal(page); await page.getByTestId('food-name-0').fill('测试食物'); await page.getByTestId('food-weight-0').fill('100'); await page.getByTestId('nutrition-details-0').locator('summary').click(); await page.getByTestId('food-energyKcal-0').fill('123.45'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('energy-view-consumed')).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByTestId('daily-calories')).toContainText('123.45');
  await page.getByTestId('energy-view-remaining').click(); await expect(page.getByTestId('remaining-calories')).toContainText('—'); await expect(page.getByTestId('daily-calories')).toContainText('123.45');
  await page.reload(); await expect(page.getByTestId('energy-view-remaining')).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByTestId('daily-summary')).toContainText('尚未设置热量预算'); await page.getByTestId('energy-view-consumed').click(); await page.reload(); await expect(page.getByTestId('energy-view-consumed')).toHaveAttribute('aria-pressed', 'true');
});

test('识别面板可手动切已配置模型，失败不自动切换，选择刷新保留', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/models', route => route.fulfill({ json: { defaultId: 'default', models: [{ id: 'default', provider: 'mock', model: 'mock-demo-v1', mode: 'mock' }, { id: 'qwen:qwen3.7-plus', provider: 'qwen', model: 'qwen3.7-plus', mode: 'live' }] } }));
  let calls = 0; await page.route('**/api/recognitions', route => { calls++; expect(route.request().postDataBuffer()!.toString()).toContain('qwen:qwen3.7-plus'); return calls === 1 ? route.fulfill({ json: { mode: 'live', provider: 'qwen', model: 'qwen3.7-plus', result: { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] } } }) : route.fulfill({ status: 429, json: { error: { message: '测试限流，请稍后重试' } } }); });
  await page.goto('/'); await openPhotoEditor(page); await page.getByTestId('recognition-model').selectOption('qwen:qwen3.7-plus'); const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer(); const file = { name: 'test.png', mimeType: 'image/png', buffer };
  await page.getByTestId('gallery-input').setInputFiles(file); await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await page.getByTestId('gallery-input').setInputFiles(file); await expect(page.getByTestId('food-editor')).toContainText('测试限流'); await expect(page.getByTestId('food-weight-0')).toHaveValue('150'); await expect(page.getByTestId('recognition-model')).toHaveValue('qwen:qwen3.7-plus'); expect(calls).toBe(2);
  await page.reload(); await openPhotoEditor(page); await expect(page.getByTestId('recognition-model')).toHaveValue('qwen:qwen3.7-plus');
});
