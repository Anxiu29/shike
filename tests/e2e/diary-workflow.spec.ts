import { expect, test } from '@playwright/test'
import { openManualMeal } from './helpers/manual-food'
import { routeApkAssets } from './helpers/apk-assets'
import { selectDate } from './helpers/calendar'
import { mockAndroidBack } from './helpers/android-back'

test.use({ timezoneId: 'Asia/Shanghai' })
test.beforeEach(async ({ page }) => { await routeApkAssets(page); if (process.env.SHIKE_E2E_APK_ASSETS) await mockAndroidBack(page); await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible() })

test('餐次拍照和添加入口常驻，历史复用不挤掉拍照，320px仍可分别点击', async ({ page }, info) => {
  await selectDate(page, 'diary-date', '2026-10-23'); await openManualMeal(page, '米饭');
  await page.getByTestId('editor-meal-type').selectOption('lunch'); await page.getByTestId('save-meal').click();
  await expect(page.getByTestId('photo-lunch')).toBeVisible();
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const photo = page.getByTestId(`photo-${meal}`), add = page.getByTestId(`add-${meal}`);
      await photo.evaluate(element => element.scrollIntoView({ block: 'center' }));
      const photoBox = (await photo.boundingBox())!, addBox = (await add.boundingBox())!;
      expect(photoBox.x + photoBox.width).toBeLessThanOrEqual(addBox.x);
      for (const button of [photo, add]) {
        expect(await button.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) })).toBe(true);
      }
      expect(await page.getByTestId(`meal-${meal}`).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  }
  await selectDate(page, 'diary-date', '2026-10-24');
  await expect(page.getByTestId('reuse-previous-lunch')).toBeVisible(); await expect(page.getByTestId('photo-lunch')).toBeVisible();
  if (info.project.name === 'Chrome 手机') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('meal-lunch').screenshot({ path: 'docs/screenshots/meal-photo-shortcut-mobile.png' });
  }
  await page.getByTestId('add-lunch').click(); await expect(page.getByTestId('food-picker')).toBeVisible();
})

test('最近与常吃带入上次份量，保存后更新频次，修改不会污染上一餐', async ({ page }, info) => {
  await openManualMeal(page, '米饭'); await page.getByTestId('food-weight-0').fill('150'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('meal-record')).toHaveCount(1)
  await page.getByTestId('shortcut-tab-recent').click()
  const recent = page.locator('[data-testid^="history-food-"]')
  await expect(recent).toHaveCount(1); await expect(recent).toContainText('150 g')
  await recent.click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('150')
  await page.getByTestId('food-weight-0').fill('220'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('meal-record')).toHaveCount(2)
  await page.getByTestId('shortcut-tab-frequent').click(); await expect(recent).toHaveCount(1); await expect(recent).toContainText('2 次')
  await recent.click(); await expect(page.getByTestId('food-weight-0')).toHaveValue('220'); await page.keyboard.press('Escape')
  await expect(page.getByTestId('meal-record').first()).toContainText('150 g')
  await page.reload(); await page.getByTestId('shortcut-tab-frequent').click(); await expect(recent).toContainText('2 次')
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/diary-shortcuts-mobile.png', fullPage: true })
  if (info.project.name === 'Chrome 桌面') await page.screenshot({ path: 'docs/screenshots/diary-shortcuts-desktop.png', fullPage: true })
})

test('跨日复用整餐先核对草稿，可改餐次和份量，取消不新增记录', async ({ page }) => {
  const originalDate = await page.getByTestId('diary-date').inputValue()
  await openManualMeal(page, '米饭'); await page.getByTestId('food-weight-0').fill('150')
  await page.getByTestId('add-food').click(); await page.getByTestId('food-picker-manual').click()
  await page.getByTestId('manual-food-name').fill('鸡蛋'); await page.getByTestId('manual-food-weight').fill('50'); await page.getByTestId('confirm-manual-food').click()
  await page.getByTestId('editor-meal-type').selectOption('lunch'); await selectDate(page, 'editor-date', '2026-09-29')
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('diary-date')).toHaveValue('2026-09-29')
  await page.getByTestId('reuse-meal').click(); await expect(page.getByTestId('reuse-source-note')).toContainText('9月29日')
  await expect(page.getByTestId('food-item-1')).toBeVisible(); await expect(page.getByTestId('food-weight-1')).toHaveValue('50')
  await expect(page.getByTestId('editor-date')).toHaveValue(originalDate)
  await page.keyboard.press('Escape'); await expect(page.getByTestId('meal-record')).toHaveCount(1)
  await page.getByTestId('reuse-meal').click(); await page.getByTestId('food-weight-0').fill('220'); await page.getByTestId('editor-meal-type').selectOption('dinner')
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('diary-date')).toHaveValue(originalDate)
  await expect(page.getByTestId('meal-dinner')).toContainText('220 g')
  await selectDate(page, 'diary-date', '2026-09-29'); await expect(page.getByTestId('meal-lunch')).toContainText('150 g')
  await page.reload(); await selectDate(page, 'diary-date', originalDate); await expect(page.getByTestId('meal-dinner')).toContainText('220 g')
})

test('周条显示已有记录，点击和键盘跨年切日，空餐可复用历史并保留目标日期', async ({ page }) => {
  await openManualMeal(page, '香蕉'); await page.getByTestId('food-weight-0').fill('100'); await page.getByTestId('editor-meal-type').selectOption('breakfast')
  await selectDate(page, 'editor-date', '2025-12-31'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('week-date-2025-12-31')).toHaveAttribute('aria-label', /已有饮食记录/)
  await page.getByTestId('week-date-2026-01-01').click(); await expect(page.getByTestId('diary-date')).toHaveValue('2026-01-01')
  await page.getByTestId('reuse-previous-breakfast').click(); await expect(page.getByTestId('editor-date')).toHaveValue('2026-01-01')
  await page.keyboard.press('Escape'); await page.getByTestId('week-date-2026-01-01').focus(); await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('diary-date')).toHaveValue('2025-12-31'); await expect(page.getByTestId('week-date-2025-12-31')).toBeFocused()
})

test('手机首屏记录入口可见，未知热量不显示为零，小屏与桌面无横向溢出', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('hero-camera')).toBeInViewport(); await expect(page.getByTestId('manual-add')).toBeInViewport()
  await page.getByTestId('tab-goals').click(); await page.getByTestId('enable-profile').check()
  await page.getByTestId('profile-age').fill('30'); await page.getByTestId('profile-height').fill('175'); await page.getByTestId('profile-weight').fill('70')
  await page.getByTestId('save-goals').click(); await expect(page.getByTestId('toast')).toContainText('个人资料与目标已保存'); await page.getByTestId('tab-diary').click()
  await page.setViewportSize({ width: 320, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.setViewportSize({ width: 390, height: 844 })
  await openManualMeal(page, '未收录的自制点心'); await page.getByTestId('editor-meal-type').selectOption('lunch'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('meal-lunch').locator('.meal-total')).toHaveText('热量待补充')
  await expect(page.getByTestId('daily-calories')).toContainText('—')
  for (const id of ['hero-camera', 'manual-add']) {
    const reachable = await page.getByTestId(id).evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) })
    expect(reachable).toBe(true)
  }
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  if (info.project.name === 'Chrome 手机') {
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'docs/screenshots/diary-refresh-mobile.png', fullPage: true })
  } else if (info.project.name === 'Chrome 桌面') {
    await page.screenshot({ path: 'docs/screenshots/diary-refresh-desktop.png', fullPage: true })
  }
})
