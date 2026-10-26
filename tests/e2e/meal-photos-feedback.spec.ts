import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { routeApkAssets } from './helpers/apk-assets'
import { openPhotoEditor } from './helpers/photo-editor'
import { openSettingsPanel, closeSettingsPanel } from './helpers/settings'
test.beforeEach(async ({ page }) => { await routeApkAssets(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible() })
async function tab(page: Page, name: 'settings' | 'diary') {
  await closeSettingsPanel(page)
  const mobile = page.getByTestId(`tab-${name}`)
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click()
}
test('拍照餐次刷新后查看大图、编辑保留、复用不带图、删除撤销和备份恢复', async ({ page }, info) => {
  test.setTimeout(60000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const image = await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#c9e4bc' } }).png().toBuffer()
  await openPhotoEditor(page)
  await page.getByTestId('gallery-input').setInputFiles({ name: '合成餐食.png', mimeType: 'image/png', buffer: image })
  await expect(page.getByTestId('recognition-summary')).toBeVisible(); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('meal-record')).toHaveCount(1); await page.reload()
  await page.getByTestId('view-meal-photo').click()
  const viewer = page.getByTestId('meal-photo-viewer'), picture = page.getByTestId('meal-photo-image')
  await expect(viewer).toBeVisible(); await expect(page.getByTestId('photo-page')).toHaveText('1 / 1')
  await expect(picture).toHaveAttribute('src', /^data:image\/jpeg;base64,\/9j\//)
  expect(await picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await page.getByTestId('zoom-meal-photo').click(); await expect(page.locator('.photo-viewer-frame')).toHaveClass(/zoomed/)
  await page.getByRole('button', { name: '还原照片大小' }).click()
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/meal-photo-viewer-mobile.png' })
  await page.keyboard.press('Escape'); await expect(viewer).toHaveCount(0); await expect(page.getByTestId('view-meal-photo')).toBeFocused()
  if (info.project.name === 'Chrome 手机') await page.getByTestId('meal-record').screenshot({ path: 'docs/screenshots/meal-photo-record-mobile.png' })
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('enlarge-photo')).toBeVisible()
  await page.getByTestId('food-weight-0').fill('173'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('view-meal-photo')).toBeVisible()
  await page.getByTestId('reuse-meal').click(); await expect(page.getByTestId('enlarge-photo')).toHaveCount(0); await page.keyboard.press('Escape')
  page.once('dialog', dialog => dialog.accept()); await page.getByTestId('delete-meal').click(); await expect(page.getByTestId('meal-record')).toHaveCount(0)
  await page.getByTestId('toast-undo').click(); await expect(page.getByTestId('view-meal-photo')).toBeVisible()
  await tab(page, 'settings'); await openSettingsPanel(page, 'backup')
  const downloadEvent = page.waitForEvent('download'); await page.getByTestId('export-backup').click()
  const download = await downloadEvent, data = await readFile((await download.path())!)
  const backup = JSON.parse(data.toString()); expect(backup.schemaVersion).toBe(11); expect(backup.mealPhotos).toHaveLength(1)
  await expect(page.getByTestId('settings-detail').getByTestId('toast')).toContainText('备份已导出')
  await page.getByTestId('backup-input').setInputFiles({ name: '餐次照片.json', mimeType: 'application/json', buffer: data })
  await expect(page.getByTestId('backup-preview')).toContainText('张餐次照片'); await page.getByTestId('confirm-restore').click()
  await expect(page.getByTestId('toast')).toContainText('备份已完整恢复'); await tab(page, 'diary')
  await page.getByTestId('view-meal-photo').click(); await expect(picture).toHaveAttribute('src', backup.mealPhotos[0].dataUrl)
  expect(errors).toEqual([])
})
test('个人库收藏反馈与撤销提示位于弹窗上层，可实际点击；失败不伪报成功', async ({ page }, info) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click()
  await page.getByTestId('manual-food-name').fill('反馈检查燕麦'); await page.getByTestId('manual-food-weight').fill('80')
  await page.getByTestId('confirm-manual-food').click(); await page.getByTestId('save-library-food-0').click()
  await expect(page.getByTestId('stored-food-message-0')).toContainText('已存入食品库'); await page.keyboard.press('Escape')
  await page.getByTestId('open-personal-library').click()
  const library = page.getByTestId('personal-food-library'), favorite = page.locator('[data-testid^="personal-favorite-"]')
  await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'true')
  const toast = library.getByTestId('toast'); await expect(toast).toContainText('设为星标')
  expect(await toast.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/favorite-feedback-mobile.png' })
  await favorite.click(); await expect(favorite).toHaveAttribute('aria-pressed', 'false'); await expect(toast).toContainText('取消')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'libraryFoods') throw new DOMException('测试存储失败', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await favorite.click(); await expect(toast).toContainText('星标保存失败'); await expect(favorite).toHaveAttribute('aria-pressed', 'false')
  await page.reload(); await page.getByTestId('open-personal-library').click(); await expect(favorite).toHaveAttribute('aria-pressed', 'false')
  await page.locator('[data-testid^="personal-delete-"]').click(); await expect(page.locator('article[data-testid^="personal-food-"]')).toHaveCount(0)
  await library.getByTestId('toast-undo').click(); await expect(page.locator('article[data-testid^="personal-food-"]')).toHaveCount(1)
  await expect(library.getByTestId('toast')).toContainText('已撤销')
  await page.keyboard.press('Escape'); await expect(library).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})
