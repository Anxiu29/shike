import { test, expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { routeApkAssets } from './helpers/apk-assets'
import { openPhotoEditor } from './helpers/photo-editor'

async function tab(page: Page, name: 'diary' | 'settings') { const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click() }
test.beforeEach(async ({ page }) => { await routeApkAssets(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible() })

test('添加直接进入可搜索食品库；收藏不误添加，刷新后可从收藏加入并取消收藏', async ({ page }, info) => {
  await page.getByTestId('manual-add').click(); await expect(page.getByTestId('food-picker')).toBeVisible(); await expect(page.getByTestId('manual-food-sheet')).not.toBeVisible()
  await page.getByTestId('food-picker-search').fill('肉包')
  const first = page.locator('[data-testid^="food-option-"]').first(), id = (await first.getAttribute('data-testid'))!.slice('food-option-'.length)
  await page.getByTestId(`food-favorite-${id}`).click(); await expect(page.getByTestId(`food-favorite-${id}`)).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByTestId('food-picker')).toBeVisible()
  await page.getByTestId('food-category-收藏').click(); await expect(page.getByTestId('food-category-收藏')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('[data-testid^="food-option-"]')).toHaveCount(1)
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/food-favorites-mobile.png' })
  await page.keyboard.press('Escape'); await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(0)
  await page.reload(); await page.getByTestId('manual-add').click(); await page.getByTestId('food-category-收藏').click(); await page.getByTestId(`food-option-${id}`).click()
  await page.getByTestId('manual-food-unit').selectOption('个'); await page.getByTestId('confirm-manual-food').click(); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('meal-record')).toContainText('80 g')
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-category-收藏').click(); await page.getByTestId(`food-favorite-${id}`).click(); await expect(page.getByTestId('food-search-empty')).toBeVisible()
})

test('包装食品也能搜索收藏，手动填写保留作为无结果时的入口', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-category-包装食品').click()
  const item = page.locator('[data-testid^="food-option-package:"]').first(), id = (await item.getAttribute('data-testid'))!.slice('food-option-'.length)
  await page.getByTestId(`food-favorite-${id}`).click(); await page.getByTestId('food-category-收藏').click(); await expect(page.getByTestId(`food-option-${id}`)).toBeVisible()
  await page.getByTestId('food-picker-search').fill('不存在的自制点心'); await expect(page.getByTestId('food-search-empty')).toBeVisible()
  await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('自制点心'); await page.getByTestId('manual-food-weight').fill('50'); await page.getByTestId('confirm-manual-food').click()
  await page.getByTestId('save-library-food-0').click(); await expect(page.getByTestId('stored-food-message-0')).toContainText('已存入食品库')
  await page.getByTestId('add-food').click(); await page.getByTestId('food-category-我的食物').click(); await page.getByTestId('food-picker-search').fill('自制点心'); await expect(page.locator('[data-testid^="food-option-saved:"]')).toHaveCount(1)
})

test('AI识别可单独存库、搜索收藏和再次使用，三档范围保留，修改本餐不改已存食品，备份恢复完整', async ({ page }) => {
  // 仅模拟原生插件契约，不包含真实Key，不调用付费模型；结果明确为测试情景。
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, any>; win.androidBridge = {}
    win.Capacitor = { PluginHeaders: [{ name: 'PersonalVision', methods: ['getState', 'recognize'].map(name => ({ name, rtype: 'promise' })) }, { name: 'Filesystem', methods: [{ name: 'writeFile', rtype: 'promise' }] }, { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] }], nativePromise: async (plugin: string, method: string, input: any) => {
      if (plugin === 'Filesystem') { win.__libraryBackup = input.data; return { uri: 'content://test/library.json' } }
      if (plugin === 'Share') return {}
      if (method === 'getState') return { activeId: '11111111-1111-4111-8111-111111111111', profiles: [{ id: '11111111-1111-4111-8111-111111111111', label: '测试模型', provider: 'qwen', model: 'qwen3.7-flash' }] }
      const profile = { factor: 'sweetness', options: ['low', 'medium', 'high'].map((level, index) => ({ level, label: ['少糖', '普通甜度', '较甜'][index], rangesPer100g: { energyKcal: { min: [40, 60, 90][index], max: [60, 90, 120][index] }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['隔离测试情景，非实测营养，糖量未知'] })) }
      const content = JSON.stringify({ isFood: true, foods: [{ name: '自制红豆粥测试款', estimatedWeightG: 200, visibleIngredients: [], uncertainties: ['糖量需确认'], estimatedNutrientsPer100g: { energyKcal: 75, proteinG: null, fatG: null, carbsG: null }, nutritionAssumptions: ['测试情景非实测'], nutritionEstimateProfile: profile }], uncertainties: [] })
      return { provider: 'qwen', model: 'qwen3.7-flash', data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
    } }
  })
  await page.reload(); await openPhotoEditor(page)
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#dde8dd' } }).png().toBuffer()
  await page.getByTestId('gallery-input').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: photo }); await expect(page.getByTestId('recognition-summary')).toBeVisible()
  // 识别先匹配可靠库；主动选本次AI候选，验证其原始范围能完整存入。
  await page.getByTestId('food-source-0').click(); await page.getByTestId('food-option-ai-current').click()
  await page.getByTestId('save-library-food-0').click(); await expect(page.getByTestId('stored-food-message-0')).toContainText('已存入食品库')
  await page.getByTestId('save-library-food-0').click(); await page.getByTestId('food-weight-0').fill('300'); await page.getByTestId('save-meal').click()
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-category-我的食物').click(); await page.getByTestId('food-picker-search').fill('自制红豆粥测试款')
  const own = page.locator('[data-testid^="food-option-saved:"]'); await expect(own).toHaveCount(1)
  const id = (await own.getAttribute('data-testid'))!.slice('food-option-'.length)
  await page.getByTestId(`food-favorite-${id}`).click(); await own.click(); await expect(page.getByTestId('manual-food-weight')).toHaveValue('200'); await expect(page.getByTestId('manual-food-preview')).toContainText('150 kcal')
  await page.getByTestId('confirm-manual-food').click(); await page.getByTestId('save-meal').click(); await tab(page, 'settings')
  await page.getByTestId('export-backup').click(); await expect(page.getByTestId('toast')).toContainText('备份已导出')
  const bytes = Buffer.from(await page.evaluate(() => (window as any).__libraryBackup) as string), backup = JSON.parse(bytes.toString())
  expect(backup.schemaVersion).toBe(10); expect(backup.libraryFoods).toHaveLength(1); expect(backup.libraryFoods[0]).toMatchObject({ favorite: true, entry: { weightG: 200, estimateProfile: { factor: 'sweetness' } } })
  await page.getByTestId('backup-input').setInputFiles({ name: 'library.json', mimeType: 'application/json', buffer: bytes }); await page.getByTestId('confirm-restore').click(); await expect(page.getByTestId('toast')).toContainText('备份已完整恢复')
  await tab(page, 'diary'); await page.reload(); await page.getByTestId('manual-add').click(); await page.getByTestId('food-category-收藏').click(); await expect(page.getByTestId(`food-option-${id}`)).toBeVisible()
})
