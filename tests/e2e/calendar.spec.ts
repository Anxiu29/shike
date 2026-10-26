import { test, expect } from '@playwright/test'
import { selectDate } from './helpers/calendar'
import { androidBack, androidTab, mockAndroidBack } from './helpers/android-back'
import { routeApkAssets } from './helpers/apk-assets'
import { openManualMeal } from './helpers/manual-food'

test.beforeEach(async ({ page }) => { await routeApkAssets(page); await mockAndroidBack(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible() })

test('日历没有清除入口，取消不改日期，确认闰日后可前后切换和回到今天', async ({ page }) => {
  const original = await page.getByTestId('diary-date').inputValue()
  await page.getByTestId('diary-date').click(); const calendar = page.getByTestId('calendar-sheet')
  await expect(calendar).toBeVisible(); await expect(calendar.getByText(/^(清除|清空)$/)).toHaveCount(0)
  await expect(page.getByTestId('diary-date')).toHaveAttribute('readonly', '')
  await page.getByTestId('calendar-previous-month').click(); await page.getByTestId('calendar-cancel').click()
  await expect(page.getByTestId('diary-date')).toHaveValue(original)
  await selectDate(page, 'diary-date', '2024-02-29')
  await page.getByTestId('next-date').click(); await expect(page.getByTestId('diary-date')).toHaveValue('2024-03-01')
  await page.getByTestId('previous-date').click(); await expect(page.getByTestId('diary-date')).toHaveValue('2024-02-29')
  await page.getByTestId('diary-date').click(); await page.getByTestId('calendar-today').click()
  await expect(page.getByTestId('diary-date')).toHaveValue('2024-02-29')
  await page.getByTestId('calendar-confirm').click(); await expect(page.getByTestId('diary-date')).toHaveValue(original)
})

test('餐食编辑内日历逐层返回，选择历史日期后保存与刷新查询正常', async ({ page }) => {
  await openManualMeal(page, '米饭'); const original = await page.getByTestId('editor-date').inputValue()
  await page.getByTestId('food-weight-0').fill('150'); await page.getByTestId('editor-date').click()
  await expect(page.getByTestId('calendar-sheet')).toBeVisible(); await androidBack(page)
  await expect(page.getByTestId('calendar-sheet')).toHaveCount(0); await expect(page.getByTestId('food-editor')).toBeVisible()
  await expect(page.getByTestId('editor-date')).toHaveValue(original); await expect(page.getByTestId('food-weight-0')).toHaveValue('150')
  await selectDate(page, 'editor-date', '2024-02-29'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('diary-date')).toHaveValue('2024-02-29'); await expect(page.getByTestId('meal-record')).toHaveCount(1)
  await page.reload(); await selectDate(page, 'diary-date', '2024-02-29'); await expect(page.getByTestId('meal-record')).toContainText('150 g')
})

test('体重日期使用相同无清除日历，取消和返回均保留已选日期', async ({ page }) => {
  await androidTab(page, 'weight'); await selectDate(page, 'weight-date', '2024-03-01')
  await page.getByTestId('weight-date').click(); await androidBack(page); await expect(page.getByTestId('weight-date')).toHaveValue('2024-03-01')
  await page.getByTestId('weight-input').fill('70.25'); await page.getByTestId('save-weight').click()
  await expect(page.getByTestId('weight-record')).toContainText('2024-03-01'); await expect(page.getByTestId('weight-record')).toContainText('70.25')
  await page.reload(); await androidTab(page, 'weight'); await expect(page.getByTestId('weight-record')).toContainText('2024-03-01')
})

test('短手机视口日历可操作，确认按钮不被遮挡，焦点能回到日期入口', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 480 }); await page.getByTestId('diary-date').click()
  await expect(page.getByTestId('calendar-confirm')).toBeInViewport(); await expect(page.getByTestId('calendar-cancel')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/calendar-mobile.png' })
  await page.getByTestId('calendar-cancel').click(); await expect(page.getByTestId('diary-date')).toBeFocused()
})
