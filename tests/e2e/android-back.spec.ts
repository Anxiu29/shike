import { test, expect } from '@playwright/test'
import { androidBack, androidTab, mockAndroidBack } from './helpers/android-back'
import { routeApkAssets } from './helpers/apk-assets'
import { openSettingsPanel } from './helpers/settings'

test.beforeEach(async ({ page }) => { await routeApkAssets(page); await mockAndroidBack(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible() })

test('安卓返回先关闭食物库，保留手填内容和餐食草稿，保存刷新仍在', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click()
  await page.getByTestId('manual-food-name').fill('米饭'); await page.getByTestId('manual-food-weight').fill('168.25')
  await page.getByTestId('manual-food-choose').click(); await page.getByTestId('food-picker-search').fill('包子')
  await androidBack(page)
  await expect(page.getByTestId('food-picker')).toHaveCount(0)
  await expect(page.getByTestId('manual-food-name')).toHaveValue('米饭'); await expect(page.getByTestId('manual-food-weight')).toHaveValue('168.25')
  await page.getByTestId('confirm-manual-food').click(); await page.getByTestId('food-source-0').click()
  await androidBack(page); await expect(page.getByTestId('food-picker')).toHaveCount(0)
  await expect(page.getByTestId('food-weight-0')).toHaveValue('168.25')
  await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click(); await page.getByTestId('manual-food-name').fill('取消的条目')
  await androidBack(page); await expect(page.getByTestId('manual-food-form')).toHaveCount(0)
  await expect(page.locator('.food-edit-card')).toHaveCount(1)
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('food-editor')).toHaveCount(0)
  await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('168.25 g')
  expect(await page.evaluate(() => (window as any).__appCalls)).not.toContain('minimizeApp')
  // 原生事件注入不会等待懒加载组件；先确认编辑器已挂载，才能验证它消费返回键。
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('food-editor')).toBeVisible(); await androidBack(page); await expect(page.getByTestId('food-editor')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('安卓逐页返回及目标逐步返回，KeepAlive保留未保存的资料', async ({ page }) => {
  await androidTab(page, 'settings'); await androidTab(page, 'weight'); await androidTab(page, 'goals')
  await page.getByTestId('enable-profile').check(); await page.getByTestId('profile-height').fill('180.5'); await page.getByTestId('goal-step-2').click()
  await androidBack(page); await expect(page.getByTestId('goal-step-1')).toHaveAttribute('aria-pressed', 'true')
  await androidBack(page); await expect(page.getByTestId('profile-height')).toHaveValue('180.5')
  await androidBack(page); await expect(page.getByTestId('weight-input')).toBeVisible()
  await androidBack(page); await expect(page.getByTestId('manage-packaged-foods')).toBeVisible()
  await androidBack(page); await expect(page.getByTestId('daily-summary')).toBeVisible()
  await androidTab(page, 'goals'); await expect(page.getByTestId('profile-height')).toHaveValue('180.5')
  expect(await page.evaluate(() => (window as any).__appCalls)).not.toContain('minimizeApp')
})

test('初次手动添加和设置子窗可逐层返回，初次取消不留空记录', async ({ page }) => {
  await page.getByTestId('manual-add').click(); await page.getByTestId('food-picker-manual').click(); await androidBack(page)
  await expect(page.getByTestId('food-editor')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(0)
  await androidTab(page, 'settings'); await page.getByTestId('manage-packaged-foods').click()
  await expect(page.getByTestId('packaged-library')).toBeVisible(); await androidBack(page)
  await expect(page.getByTestId('packaged-library')).toHaveCount(0); await expect(page.getByTestId('manage-packaged-foods')).toBeVisible()
  await openSettingsPanel(page, 'ai'); await page.getByTestId('add-model').click(); await expect(page.getByTestId('model-form')).toBeVisible()
  await page.getByTestId('model-label').fill('取消的配置'); await page.getByTestId('model-api-key').fill('example-unsaved-key')
  await page.getByTestId('model-key-help').click(); await expect(page.getByTestId('model-key-help-sheet')).toBeVisible()
  await androidBack(page); await expect(page.getByTestId('model-key-help-sheet')).not.toBeVisible(); await expect(page.getByTestId('model-label')).toHaveValue('取消的配置')
  await androidBack(page); await expect(page.getByTestId('model-form')).toHaveCount(0)
  await expect(page.getByTestId('settings-detail')).toBeVisible(); await androidBack(page); await expect(page.getByTestId('settings-detail')).not.toBeVisible()
  await androidBack(page); await expect(page.getByTestId('daily-summary')).toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('常用食物详情先返回食物库，保留筛选和记录，下一次返回才关闭食物库', async ({ page }) => {
  await page.getByTestId('open-personal-library').click(); await page.getByTestId('personal-library-first-food').click()
  await page.getByTestId('manual-food-name').fill('返回测试早餐'); await page.getByTestId('manual-food-weight').fill('120'); await page.getByTestId('confirm-manual-food').click()
  await page.getByTestId('personal-library-search').fill('返回测试')
  const detail = page.locator('[data-testid^="personal-detail-"]').filter({ hasText: '返回测试早餐' }); await detail.click()
  await expect(page.getByTestId('personal-food-details')).toBeVisible(); await androidBack(page)
  await expect(page.getByTestId('personal-food-details')).toHaveCount(0); await expect(page.getByTestId('personal-food-library')).toBeVisible(); await expect(page.getByTestId('personal-library-search')).toHaveValue('返回测试'); await expect(detail).toBeFocused()
  await androidBack(page); await expect(page.getByTestId('personal-food-library')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden'); expect(await page.evaluate(() => (window as any).__appCalls)).not.toContain('minimizeApp')
});

test('首页第一次返回提示，交互和回到前台重置确认，两次返回才退到后台', async ({ page }) => {
  await androidBack(page); await expect(page.getByTestId('toast')).toContainText('再返回一次退到后台')
  expect(await page.evaluate(() => (window as any).__appCalls)).not.toContain('minimizeApp')
  await page.getByTestId('open-water').click(); await expect(page.getByTestId('water-sheet')).toBeVisible()
  await androidBack(page); await expect(page.getByTestId('water-sheet')).not.toBeVisible()
  await androidBack(page); await expect(page.getByTestId('toast')).toContainText('再返回一次退到后台')
  expect(await page.evaluate(() => (window as any).__appCalls)).not.toContain('minimizeApp')
  await androidBack(page); await expect.poll(() => page.evaluate(() => (window as any).__appCalls.filter((call: string) => call === 'minimizeApp').length)).toBe(1)
  await page.evaluate(() => (window as any).__appEmit('appStateChange', { isActive: true }))
  await androidBack(page); expect(await page.evaluate(() => (window as any).__appCalls.filter((call: string) => call === 'minimizeApp').length)).toBe(1)
  expect(await page.evaluate(() => (window as any).__appCalls)).not.toContain('exitApp')
})
