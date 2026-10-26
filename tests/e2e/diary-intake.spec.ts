import { expect, test, type Page } from '@playwright/test'
import { defaultDailyGoals, makeDailyPlan, mealRecordSchema, type MealRecord, type Settings } from '@shike/shared'
import { routeApkAssets } from './helpers/apk-assets'
import { androidBack, mockAndroidBack } from './helpers/android-back'
import { selectDate } from './helpers/calendar'

test.use({ timezoneId: 'Asia/Shanghai' })
const settings: Settings = { targetWeightKg: null, dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 2000 } }
const meals: MealRecord[] = [500, 1000, 1500, 2000, 2500, null].map((energyKcal, index) => {
  const date = `2026-10-${19 + index}`
  return mealRecordSchema.parse({ id: `intake-meal-${date}`, date, mealType: 'lunch', mode: 'manual', createdAt: `${date}T04:00:00.000Z`, updatedAt: `${date}T04:00:00.000Z`,
    items: [{ id: `intake-food-${date}`, name: '日期进度测试食物', kind: 'manual', weightG: 250, nutrientsPer100g: { energyKcal: energyKcal === null ? null : energyKcal / 2.5, proteinG: null, fatG: null, carbsG: null }, warnings: [], provenance: '测试数据' }] })
})

async function seed(page: Page, noBudget = false, native = false) {
  await routeApkAssets(page)
  if (native || process.env.SHIKE_E2E_APK_ASSETS) await mockAndroidBack(page)
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
  const plans = meals.map(meal => makeDailyPlan(meal.date, noBudget && meal.date === '2026-10-21' ? { targetWeightKg: null } : settings, []))
  await page.evaluate(async payload => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('shike-local-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['meals', 'preferences', 'dailyPlans'], 'readwrite')
      payload.meals.forEach(meal => transaction.objectStore('meals').put(meal))
      payload.plans.forEach(plan => transaction.objectStore('dailyPlans').put(plan))
      transaction.objectStore('preferences').put({ id: 'preferences', value: payload.settings })
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error)
    }); database.close()
  }, { meals, plans, settings })
  await page.reload(); await selectDate(page, 'diary-date', '2026-10-23')
}

test('日期按摄入比例填色、超预算橙色，选中后仍保留进度；编辑与删除即时更新', async ({ page }, info) => {
  await seed(page)
  for (const [date, percent] of [['19', '25'], ['20', '50'], ['21', '75'], ['22', '100'], ['23', '125']]) {
    const button = page.getByTestId(`week-date-2026-10-${date}`)
    await expect(button).toContainText(`${percent}%`); await expect(button).toHaveAttribute('data-intake-percent', percent!)
    expect(await button.evaluate(element => getComputedStyle(element, '::before').height)).not.toBe('0px')
  }
  const selected = page.getByTestId('week-date-2026-10-23')
  await expect(selected).toHaveAttribute('aria-current', 'date'); await expect(selected).toHaveAttribute('data-intake-state', 'over')
  await expect(selected).toHaveAttribute('aria-label', /超出预算/)
  const normalColor = await page.getByTestId('week-date-2026-10-22').evaluate(element => getComputedStyle(element, '::before').backgroundColor)
  expect(await selected.evaluate(element => getComputedStyle(element, '::before').backgroundColor)).not.toBe(normalColor)
  await expect(page.getByTestId('week-date-2026-10-24')).toContainText('待补全'); await expect(page.getByTestId('week-date-2026-10-25')).toContainText('未记录')
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    for (const button of await page.getByTestId('diary-week').getByRole('button').all()) {
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
  }
  if (info.project.name === 'Chrome 手机' || info.project.name === 'Chrome 桌面') {
    const device = info.project.name === 'Chrome 手机' ? 'mobile' : 'desktop'
    await page.setViewportSize({ width: device === 'mobile' ? 390 : 1440, height: device === 'mobile' ? 844 : 960 })
    await page.locator('.diary-week-section').screenshot({ path: `docs/screenshots/diary-intake-${device}.png` })
    if (device === 'mobile') await page.screenshot({ path: 'docs/screenshots/diary-intake-home-mobile.png', fullPage: true })
  }
  await page.getByTestId('edit-meal').click(); await page.getByTestId('food-weight-0').fill('100'); await page.getByTestId('save-meal').click()
  await expect(page.getByTestId('food-editor')).toHaveCount(0)
  await expect(selected).toContainText('50%'); await expect(selected).toHaveAttribute('data-intake-state', 'within')
  await page.reload(); await selectDate(page, 'diary-date', '2026-10-23'); await expect(selected).toContainText('50%')
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('delete-meal').click(); await expect(selected).toContainText('未记录'); await expect(selected).not.toHaveAttribute('data-intake-percent')
})

test('历史无预算不显示百分比，未知热量保留待补全提示与读屏说明', async ({ page }) => {
  await seed(page, true)
  const noBudget = page.getByTestId('week-date-2026-10-21'), incomplete = page.getByTestId('week-date-2026-10-24')
  await expect(noBudget).toContainText('无预算'); await expect(noBudget).not.toHaveAttribute('data-intake-percent')
  await expect(noBudget).toHaveAttribute('aria-label', /未设置可用热量预算/)
  await noBudget.click(); await expect(page.getByTestId('diary-date')).toHaveValue('2026-10-21'); await expect(noBudget).toContainText('无预算')
  await expect(incomplete).toHaveAttribute('aria-label', /1 项食物热量待补全/); await expect(incomplete).not.toHaveAttribute('data-intake-percent')
  await incomplete.click(); await expect(page.getByTestId('daily-calories')).toContainText('—')
})

test('整月每一天显示对应进度，支持切日、翻月、跨年与闰日，小屏无溢出', async ({ page }, info) => {
  await seed(page)
  await expect(page.locator('.app-header .brand')).toHaveCount(0); await expect(page.getByTestId('header-personal-library')).toHaveCount(0)
  await expect(page.getByTestId('toggle-diary-month')).toHaveCount(0)
  await expect(page.getByText('上滑查看整月', { exact: true })).toHaveCount(0)
  await page.getByTestId('week-date-2026-10-23').focus(); await page.keyboard.press('PageDown')
  const month = page.getByTestId('diary-month')
  await expect(month.getByRole('button')).toHaveCount(31); await expect(page.getByTestId('diary-month-title')).toHaveText('2026年10月')
  await expect(page.getByTestId('month-date-2026-10-01')).toHaveCSS('grid-column-start', '4')
  await expect(page.getByTestId('month-date-2026-10-19')).toContainText('25%')
  await expect(page.getByTestId('month-date-2026-10-23')).toContainText('125%')
  await expect(page.getByTestId('month-date-2026-10-24')).toContainText('待补全')
  await expect(page.getByTestId('month-date-2026-10-01')).toContainText('未记录')
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    for (const button of await month.getByRole('button').all()) expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  if (info.project.name === 'Chrome 手机' || info.project.name === 'Chrome 桌面') {
    const device = info.project.name === 'Chrome 手机' ? 'mobile' : 'desktop'
    await page.setViewportSize({ width: device === 'mobile' ? 390 : 1440, height: device === 'mobile' ? 844 : 960 })
    await page.locator('.diary-week-section').screenshot({ path: `docs/screenshots/diary-month-${device}.png` })
    if (device === 'mobile') await page.screenshot({ path: 'docs/screenshots/diary-month-home-mobile.png', fullPage: true })
  }
  await page.getByTestId('month-date-2026-10-20').click(); await expect(page.getByTestId('diary-date')).toHaveValue('2026-10-20')
  await expect(page.getByTestId('daily-calories')).toContainText('1,000'); await expect(page.getByTestId('month-date-2026-10-20')).toHaveAttribute('aria-current', 'date')
  await page.getByTestId('diary-previous-month').click(); await expect(month.getByRole('button')).toHaveCount(30)
  await expect(page.getByTestId('diary-month-title')).toHaveText('2026年9月'); await expect(page.getByTestId('diary-date')).toHaveValue('2026-10-20')
  await selectDate(page, 'diary-date', '2026-12-31'); await page.getByTestId('diary-next-month').click(); await expect(page.getByTestId('diary-month-title')).toHaveText('2027年1月')
  await selectDate(page, 'diary-date', '2024-02-29'); await expect(month.getByRole('button')).toHaveCount(29)
  await page.getByTestId('month-date-2024-02-29').focus(); await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('diary-date')).toHaveValue('2024-03-01'); await expect(page.getByTestId('month-date-2024-03-01')).toBeFocused()
  await page.keyboard.press('Escape'); await expect(page.getByTestId('diary-week')).toBeVisible(); await expect(page.getByTestId('week-date-2024-03-01')).toBeFocused()
})

test('首页下拉跟手展开、上推跟手收回，不等松手；日期轻点、正常滚动与安卓返回可用', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, false, true)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', y = 0, x = 170) => {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  }
  const height = () => page.locator('.diary-calendar-viewport').evaluate(element => element.getBoundingClientRect().height)
  const calendar = page.locator('.diary-week-section')
  await expect(page.getByTestId('toggle-diary-month')).toHaveCount(0)
  await expect(page.getByText('上滑查看整月', { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  const closedHeight = await height(), originalEnergyY = (await page.getByTestId('daily-summary').boundingBox())!.y
  await touch('touchStart', 300); await touch('touchMove', 340)
  await expect(calendar).toHaveAttribute('data-dragging', 'true')
  const partialHeight = await height()
  expect(partialHeight).toBeGreaterThan(closedHeight + 20)
  expect(partialHeight).toBeLessThan(await page.locator('.diary-month-panel').evaluate(element => element.getBoundingClientRect().height))
  await touch('touchMove', 440); expect(await height()).toBeGreaterThan(partialHeight + 60)
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/diary-calendar-drag-partial-mobile.png' })
  await touch('touchMove', 700)
  await expect(page.getByTestId('diary-month')).toBeInViewport({ ratio: 1 })
  await expect(calendar).toHaveAttribute('data-expansion', '1.000')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await touch('touchEnd')
  await expect(calendar).toHaveAttribute('data-dragging', 'false')
  await expect(page.getByTestId('diary-date')).toHaveValue('2026-10-23')
  const day = (await page.getByTestId('month-date-2026-10-20').boundingBox())!
  await touch('touchStart', day.y + day.height / 2, day.x + day.width / 2); await touch('touchEnd')
  await expect(page.getByTestId('diary-date')).toHaveValue('2026-10-20')
  const openHeight = await height()
  await touch('touchStart', 700); await touch('touchMove', 640)
  expect(await height()).toBeLessThan(openHeight - 40)
  await touch('touchMove', 480); expect(await height()).toBeLessThan(openHeight - 180)
  await touch('touchMove', 300)
  await expect(calendar).toHaveAttribute('data-expansion', '0.000')
  await expect(page.getByTestId('diary-week')).toBeVisible()
  expect(await height()).toBeCloseTo(closedHeight, 0)
  expect((await page.getByTestId('daily-summary').boundingBox())!.y).toBeCloseTo(originalEnergyY, 0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await touch('touchEnd'); await expect(page.getByTestId('diary-month')).toHaveCount(0)
  await touch('touchStart', 300); await touch('touchMove', 400); await touch('touchEnd')
  await expect(calendar).toHaveAttribute('data-expansion', '1.000')
  await androidBack(page); await expect(page.getByTestId('diary-month')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__appCalls.filter((method: string) => method === 'minimizeApp'))).toEqual([])
  // 周历下上滑仍正常浏览记录，不再展开月历。
  await touch('touchStart', 650)
  for (const y of [610, 550, 470, 390]) await touch('touchMove', y)
  await touch('touchEnd'); await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect(page.getByTestId('diary-month')).toHaveCount(0)
  await session.detach()
})

test('同一次下拉可反向收回，取消恢复原状，六行月历可在松手前完整显示', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, false, true)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', y = 0, x = 170) => {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] })
  }
  const height = () => page.locator('.diary-calendar-viewport').evaluate(element => element.getBoundingClientRect().height)
  const calendar = page.locator('.diary-week-section')
  await page.evaluate(() => window.scrollTo(0, 0)); const original = await height()
  await touch('touchStart', 300); await touch('touchMove', 325); expect(await height()).toBeGreaterThan(original)
  await touch('touchEnd'); await expect(page.getByTestId('diary-month')).toHaveCount(0)
  await touch('touchStart', 300); await touch('touchMove', 420); const partial = await height()
  await touch('touchMove', 520); expect(await height()).toBeGreaterThan(partial + 70)
  await touch('touchMove', 350); expect(await height()).toBeLessThan(partial - 40)
  await touch('touchMove', 300); expect(await height()).toBeCloseTo(original, 0)
  await expect(page.getByTestId('diary-week')).toBeVisible()
  await touch('touchEnd'); await expect(page.getByTestId('diary-month')).toHaveCount(0)
  await touch('touchStart', 300); await touch('touchMove', 420); expect(await height()).toBeGreaterThan(original)
  await touch('touchCancel'); await expect(page.getByTestId('diary-month')).toHaveCount(0)
  expect(await height()).toBeCloseTo(original, 0)
  await touch('touchStart', 300); await touch('touchMove', 305, 190); await touch('touchMove', 305, 170); await touch('touchEnd')
  await expect(page.getByTestId('diary-month')).toHaveCount(0)
  // 从日期按钮起滑不能误选日期；八月需要六行。
  await selectDate(page, 'diary-date', '2026-08-31'); await page.evaluate(() => window.scrollTo(0, 0))
  const day = (await page.getByTestId('week-date-2026-08-31').boundingBox())!, y = day.y + day.height / 2, x = day.x + day.width / 2
  await touch('touchStart', y, x)
  for (const distance of [30, 120, 260, 470]) await touch('touchMove', y + distance, x)
  await expect(calendar).toHaveAttribute('data-expansion', '1.000')
  await expect(calendar).toHaveAttribute('data-dragging', 'true')
  await expect(page.getByTestId('diary-month').getByRole('button', { includeHidden: true })).toHaveCount(31)
  await expect(page.getByTestId('diary-month')).toBeInViewport({ ratio: 1 })
  const box = (await calendar.boundingBox())!, navTop = await page.locator('.mobile-nav').evaluate(element => element.getBoundingClientRect().top)
  expect(box.y + box.height).toBeLessThanOrEqual(navTop)
  await expect(page.getByTestId('diary-date')).toHaveValue('2026-08-31')
  if (info.project.name === 'Chrome 手机') await page.screenshot({ path: 'docs/screenshots/diary-calendar-drag-full-mobile.png' })
  await touch('touchEnd')
  const full = await height()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await touch('touchStart', 650); await touch('touchMove', 550); expect(await height()).toBeLessThan(full - 70)
  await touch('touchCancel'); await expect(calendar).toHaveAttribute('data-expansion', '1.000')
  expect(await height()).toBeCloseTo(full, 0)
  await session.detach()
})
