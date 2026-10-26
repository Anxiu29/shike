import { test, expect } from '@playwright/test'
import { routeApkAssets } from './helpers/apk-assets'

test.beforeEach(async ({ page }) => { await routeApkAssets(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible() })

test('一个包子估重，多次编辑数量和单个大小，刷新与v9备份恢复完整快照', async ({ page }, info) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('肉包')
  await page.getByTestId('manual-food-unit').selectOption('个'); await expect(page.getByTestId('manual-food-summary')).toContainText('80 g')
  await page.getByTestId('manual-food-quantity').fill('2'); await page.getByTestId('confirm-manual-food').click()
  await expect(page.getByTestId('food-portion-0-summary')).toContainText('160 g'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('meal-record')).toContainText('2 个'); await page.reload(); await page.getByTestId('edit-meal').click()
  await expect(page.getByTestId('food-portion-0-quantity')).toHaveValue('2')
  await page.getByTestId('food-portion-0-quantity').fill('0.5'); await page.getByTestId('food-portion-0-per-unit').fill('95')
  await expect(page.getByTestId('food-portion-0-summary')).toContainText('47.5 g')
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/portion-mobile.png' })
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('47.5 g')
  const settings = page.getByTestId('tab-settings'); await (await settings.isVisible() ? settings : page.getByTestId('desktop-tab-settings')).click()
  const pending = page.waitForEvent('download'); await page.getByTestId('export-backup').click(); const stream = await (await pending).createReadStream()
  if (!stream) throw Error('没有备份流'); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks), backup = JSON.parse(bytes.toString())
  expect(backup.schemaVersion).toBe(10); expect(backup.meals[0].items[0]).toMatchObject({ weightG: 47.5, portionSnapshot: { quantity: .5, unit: '个', amountPerUnit: 95 } })
  await page.getByTestId('backup-input').setInputFiles({ name: 'portion.json', mimeType: 'application/json', buffer: bytes }); await page.getByTestId('confirm-restore').click()
  await expect(page.getByTestId('toast')).toContainText('备份已完整恢复')
  const diary = page.getByTestId('tab-diary'); await (await diary.isVisible() ? diary : page.getByTestId('desktop-tab-diary')).click()
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-portion-0-quantity')).toHaveValue('0.5'); await expect(page.getByTestId('food-portion-0-per-unit')).toHaveValue('95')
})

test('数量缺失时热量保持待补充，切回克数可直接填写确定重量', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('菜包'); await page.getByTestId('manual-food-unit').selectOption('个')
  await page.getByTestId('manual-food-quantity').fill(''); await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-calories-0')).toContainText('待补充')
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload(); await expect(page.getByTestId('daily-summary')).toContainText('未补全')
  await page.getByTestId('edit-meal').click(); await page.getByTestId('food-portion-0-unit').selectOption('g'); await page.getByTestId('food-weight-0').fill('88.88')
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('88.88 g')
})

test('已有称重换单位不被通用估重覆盖，改变个数后再按份量换算', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('肉包'); await page.getByTestId('manual-food-weight').fill('88.88'); await page.getByTestId('confirm-manual-food').click()
  const calories = await page.getByTestId('food-calories-0').textContent()
  await page.getByTestId('food-portion-0-unit').selectOption('个'); await expect(page.getByTestId('food-portion-0-per-unit')).toHaveValue('88.88')
  await expect(page.getByTestId('food-calories-0')).toHaveText(calories!)
  await page.getByTestId('food-portion-0-quantity').fill('2'); await expect(page.getByTestId('food-portion-0-summary')).toContainText('177.76 g')
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('177.76 g')
})

test('普通饮品按杯计算mL，不把每100g库值套成容量营养', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('自制牛奶饮品')
  await page.getByTestId('manual-food-unit').selectOption('ml'); await page.locator('.manual-food-nutrition summary').click(); await page.getByTestId('manual-food-energyKcal').fill('60')
  await page.getByTestId('manual-food-unit').selectOption('杯'); await expect(page.getByTestId('manual-food-summary')).toContainText('250 mL')
  await expect(page.getByTestId('manual-food-preview')).toContainText('150 kcal'); await page.getByTestId('confirm-manual-food').click()
  await expect(page.getByTestId('food-calories-0')).toContainText('150 kcal'); await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0); await page.reload()
  await expect(page.getByTestId('meal-record')).toContainText('1 杯'); await expect(page.getByTestId('meal-record')).toContainText('250 mL')
})

test('米饭按碗、吐司按片、油按勺分别估重，保存多个食物互不影响', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click()
  for (const [index, name, unit, quantity, expected] of [[0, '米饭', '碗', '1', '150 g'], [1, '吐司', '片', '2', '50 g'], [2, '橄榄油', '勺', '0.5', '7.5 g']] as const) {
    if (index) { await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click() }
    await page.getByTestId('manual-food-name').fill(name); await page.getByTestId('manual-food-unit').selectOption(unit); await page.getByTestId('manual-food-quantity').fill(quantity)
    await expect(page.getByTestId('manual-food-summary')).toContainText(expected); await page.getByTestId('confirm-manual-food').click()
  }
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('150 g'); await expect(page.getByTestId('meal-record')).toContainText('50 g'); await expect(page.getByTestId('meal-record')).toContainText('7.5 g')
})
