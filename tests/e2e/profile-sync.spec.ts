import { test, expect, type Page } from '@playwright/test'
import { androidTab, mockAndroidBack } from './helpers/android-back'
import { routeApkAssets } from './helpers/apk-assets'
import { selectDate } from './helpers/calendar'

async function setupProfile(page: Page) {
  await androidTab(page, 'goals'); await page.getByTestId('enable-profile').check()
  await page.getByTestId('profile-sex').selectOption('male'); await page.getByTestId('profile-age').fill('30')
  await page.getByTestId('profile-height').fill('175'); await page.getByTestId('profile-weight').fill('70')
  await page.getByTestId('goal-step-2').click(); await page.getByTestId('goal-target-weight').fill('65')
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存')
}

test.beforeEach(async ({ page }) => {
  await routeApkAssets(page); await mockAndroidBack(page); await page.goto('/')
  await expect(page.getByTestId('daily-summary')).toBeVisible(); await setupProfile(page)
})

test('个人资料参考体重显示到体重页，修改部分资料仍同步新目标，保存刷新不覆盖', async ({ page }) => {
  await androidTab(page, 'weight'); await expect(page.getByTestId('current-weight')).toContainText('70')
  await expect(page.getByTestId('current-weight-source')).toContainText('个人资料参考')
  await expect(page.getByTestId('target-weight')).toHaveValue('65'); await expect(page.getByTestId('weight-record')).toHaveCount(0)
  await androidTab(page, 'goals'); await page.getByTestId('goal-step-0').click(); await page.getByTestId('profile-height').fill('180')
  await androidTab(page, 'weight'); await page.getByTestId('target-weight').fill('64'); await page.getByTestId('save-target').click()
  await expect(page.getByTestId('weight-target-summary')).toContainText('64')
  await androidTab(page, 'goals'); await expect(page.getByTestId('profile-height')).toHaveValue('180')
  await page.getByTestId('goal-step-2').click(); await expect(page.getByTestId('goal-target-weight')).toHaveValue('64')
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存')
  await androidTab(page, 'weight'); await expect(page.getByTestId('target-weight')).toHaveValue('64')
  await page.reload(); await androidTab(page, 'goals'); await expect(page.getByTestId('profile-height')).toHaveValue('180')
  await page.getByTestId('goal-step-2').click(); await expect(page.getByTestId('goal-target-weight')).toHaveValue('64')
  await androidTab(page, 'diary'); await expect(page.getByTestId('base-calorie-budget')).toContainText('2,352')
})

test('新称重同步目标页当前体重和预算，初始参考保留，未来称重不倒灌今天', async ({ page }) => {
  await androidTab(page, 'weight'); await page.getByTestId('weight-input').fill('69.25'); await page.getByTestId('save-weight').click()
  await expect(page.getByTestId('current-weight')).toContainText('69.25'); await expect(page.getByTestId('current-weight-source')).toContainText('体重记录')
  await selectDate(page, 'weight-date', '2099-01-01'); await page.getByTestId('weight-input').fill('88'); await page.getByTestId('save-weight').click()
  await expect(page.getByTestId('weight-record')).toHaveCount(2); await expect(page.getByTestId('current-weight')).toContainText('69.25')
  await androidTab(page, 'goals'); await page.getByTestId('goal-step-0').click()
  await expect(page.getByTestId('profile-current-weight')).toContainText('69.25 kg'); await expect(page.getByTestId('profile-weight')).toHaveValue('70')
  await page.getByTestId('goal-step-1').click(); await expect(page.getByTestId('budget-preview')).toContainText('2,297.75')
  await androidTab(page, 'diary'); await expect(page.getByTestId('base-calorie-budget')).toContainText('2,297.75')
  await page.reload(); await androidTab(page, 'weight'); await expect(page.getByTestId('current-weight')).toContainText('69.25')
})

test('本地目标草稿优先保留，保存后双向一致，取消目标也同步到两页', async ({ page }) => {
  await page.getByTestId('goal-target-weight').fill('62')
  await androidTab(page, 'weight'); await page.getByTestId('target-weight').fill('64'); await page.getByTestId('save-target').click()
  await expect(page.getByTestId('weight-target-summary')).toContainText('64')
  await androidTab(page, 'goals'); await expect(page.getByTestId('goal-target-weight')).toHaveValue('62')
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存')
  await androidTab(page, 'weight'); await expect(page.getByTestId('target-weight')).toHaveValue('62')
  await page.getByTestId('target-weight').fill(''); await page.getByTestId('save-target').click(); await expect(page.getByTestId('weight-target-summary')).toContainText('—')
  await androidTab(page, 'goals'); await expect(page.getByTestId('goal-target-weight')).toHaveValue('')
  await page.reload(); await androidTab(page, 'weight'); await expect(page.getByTestId('target-weight')).toHaveValue('')
})
