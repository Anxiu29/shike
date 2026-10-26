import { test, expect, type Page } from '@playwright/test'
import { routeApkAssets } from './helpers/apk-assets'

async function tab(page: Page, name: 'goals' | 'diary') {
  await closeSettingsPanel(page); const mobile = page.getByTestId(`tab-${name}`); await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click() }
async function daily(page: Page, value: string) {
  await page.getByTestId('add-exercise').click(); await page.getByTestId('exercise-method').selectOption('manual'); await expect(page.getByTestId('exercise-scope')).toHaveValue('day')
  await page.getByTestId('exercise-manual-kcal').fill(value)
}
test.beforeEach(async ({ page }) => { await routeApkAssets(page); await page.goto('/') })
test('手环低于常规不加预算，运动变多只补差额，降低读数与关闭计入即时生效', async ({ page }) => {
  await tab(page, 'goals'); await page.getByTestId('enable-profile').check(); await page.getByTestId('profile-sex').selectOption('male')
  await page.getByTestId('profile-age').fill('30'); await page.getByTestId('profile-height').fill('180'); await page.getByTestId('profile-weight').fill('69.25'); await page.getByTestId('profile-activity').selectOption('light')
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await tab(page, 'diary')
  await expect(page.getByTestId('base-calorie-budget')).toContainText('2,676')
  await daily(page, '1000'); await expect(page.getByTestId('exercise-preview')).toContainText('仅超出部分增加 0 kcal'); await page.getByTestId('save-exercise').click()
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0'); await expect(page.getByTestId('remaining-calories')).toContainText('2,676')
  await daily(page, '1200'); await expect(page.getByTestId('exercise-preview')).toContainText('196.5'); await page.getByTestId('save-exercise').click()
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 196.5'); await expect(page.getByTestId('remaining-calories')).toContainText('2,872.5')
  await expect(page.getByTestId('daily-budget-summary')).toContainText('1,003.5'); await page.reload(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('196.5')
  await daily(page, '900'); await page.getByTestId('save-exercise').click(); await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0')
  await daily(page, '1500'); await page.getByTestId('exercise-include-budget').uncheck(); await page.getByTestId('save-exercise').click()
  await expect(page.getByTestId('exercise-budget-credit')).toContainText('+ 0'); await expect(page.getByTestId('exercise-calories-total')).toContainText('1,500')
})
