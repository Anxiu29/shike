import { test, expect, type Page } from '@playwright/test'
import { openManualMeal } from './helpers/manual-food'

/** 合成快照只用于回归计算/加载边界，不代表食品营养的实际测量值。 */
async function openSnapshots(page: Page) {
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('shike-local-v1')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result, now = new Date()
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
      const timestamp = now.toISOString()
      const entry = { id: 'snapshot-entry', name: '快照米饭', kind: 'manual', weightG: 150, nutrientsPer100g: { energyKcal: 130, proteinG: 2, fatG: 0, carbsG: 28 }, provenance: '隔离测试合成快照', warnings: [] }
      const transaction = database.transaction(['meals', 'libraryFoods'], 'readwrite')
      transaction.onabort = () => { database.close(); reject(transaction.error) }
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.objectStore('meals').put({ id: 'snapshot-meal', date, mealType: 'lunch', items: [entry], mode: 'manual', createdAt: timestamp, updatedAt: timestamp })
      transaction.objectStore('libraryFoods').put({ id: 'startup-food', choiceId: 'saved:startup-food', entry, origin: 'manual', favorite: true, createdAt: timestamp, updatedAt: timestamp })
    }
  }))
  // 原生写入不经过Dexie的变更广播，重新进入页面以读取这一组已保存快照。
  await page.reload(); await expect(page.getByTestId('quick-food-startup-food')).toBeVisible()
}
const foodFactoryChunk = /\/assets\/personal-foods-[^/]+\.js(?:\?|$)/

test('有历史餐食与常用食品时仍不提前加载整库，快照热量和再次添加保持原样', async ({ page }) => {
  // 路由模式关闭浏览器HTTP缓存，保证重新进入后的资源大小可测，而不是把缓存命中0字节当优化。
  await page.route('**/assets/**', route => route.continue())
  await openSnapshots(page)
  await expect(page.getByTestId('daily-calories')).toContainText('195')
  await page.waitForLoadState('networkidle')
  const scriptBytes = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && /\/assets\/[^/]+\.js(?:\?|$)/.test(entry.name))
    .reduce((sum, entry) => sum + entry.decodedBodySize, 0))
  expect(scriptBytes).toBeGreaterThan(0); expect(scriptBytes).toBeLessThan(1_000_000)
  await page.getByTestId('quick-food-startup-food').click()
  await expect(page.getByTestId('food-name-0')).toHaveValue('快照米饭')
  await expect(page.getByTestId('food-weight-0')).toHaveValue('150')
  await expect(page.getByTestId('meal-record')).toHaveCount(1)
})

for (const returnToStart of [false, true]) test(`常用食品工厂加载期间${returnToStart ? '切日再返回' : '切换日期'}取消旧的添加操作`, async ({ page }) => {
  await openSnapshots(page)
  const gate = Promise.withResolvers<void>()
  let requested = false
  await page.route(foodFactoryChunk, async route => { requested = true; await gate.promise; await route.continue() })
  try {
    await page.getByTestId('quick-food-startup-food').click()
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByTestId('personal-food-shelf').getByRole('status')).toContainText('正在准备')
    await page.getByTestId('previous-date').click()
    if (returnToStart) await page.getByTestId('next-date').click()
    gate.resolve(); await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('food-editor')).toHaveCount(0)
    await page.getByTestId('quick-food-startup-food').click()
    await expect(page.getByTestId('food-name-0')).toHaveValue('快照米饭')
  } finally { gate.resolve(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('常用食品工厂下载失败保留快照并显示错误，仍能手动记录', async ({ page }) => {
  await openSnapshots(page)
  await page.route(foodFactoryChunk, route => route.abort('failed'))
  await page.getByTestId('quick-food-startup-food').click()
  await expect(page.getByTestId('personal-food-shelf').getByRole('alert')).toContainText('原记录已保留')
  await expect(page.getByTestId('meal-record')).toHaveCount(1)
  await page.getByTestId('manual-add').click()
  await expect(page.getByTestId('food-editor')).toBeVisible()
})

test('常用食品加载期间转去编辑旧餐，迟到的添加不能替换记录ID或新建重复餐食', async ({ page }) => {
  await openSnapshots(page)
  const gate = Promise.withResolvers<void>()
  let requested = false
  await page.route(foodFactoryChunk, async route => { requested = true; await gate.promise; await route.continue() })
  try {
    await page.getByTestId('quick-food-startup-food').click()
    await expect.poll(() => requested).toBe(true)
    await page.getByTestId('edit-meal').click()
    await page.getByTestId('food-name-0').fill('编辑后的旧餐')
    gate.resolve(); await page.waitForLoadState('networkidle')
    await page.getByTestId('save-meal').click()
    await expect(page.getByTestId('food-editor')).toHaveCount(0)
    await expect(page.getByTestId('meal-record')).toHaveCount(1)
    await expect(page.getByTestId('meal-record')).toContainText('编辑后的旧餐')
  } finally { gate.resolve(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('提交保存后的微任务阶段，浏览器原生禁用全部编辑控件，已提交快照不再被修改', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
  await openManualMeal(page, '保存中的草稿')
  await page.getByTestId('food-weight-0').fill('150')
  // 在保存事件后的Vue刷新微任务观察真实HTML :disabled，避免用happy-dom的补丁代替浏览器验证。
  const disabled = await page.getByTestId('save-meal').evaluate(async (button: HTMLButtonElement) => {
    button.click(); await Promise.resolve()
    return ['[data-testid="food-name-0"]', '[data-testid="food-weight-0"]', '[data-testid="editor-meal-type"]', '[data-testid="add-package"]', '[data-testid="add-food"]', '[aria-label="删除食物 1"]']
      .map(selector => document.querySelector(selector)?.matches(':disabled') ?? false)
  })
  expect(disabled).toEqual([true, true, true, true, true, true])
  await expect(page.getByTestId('food-editor')).toHaveCount(0)
  await expect(page.getByTestId('meal-record')).toContainText('保存中的草稿')
})

for (const closePanel of [false, true]) test(`快捷食物加载中${closePanel ? '打开再关闭' : '打开'}助手，会取消旧添加并保留聊天输入`, async ({ page }) => {
  await openSnapshots(page)
  const gate = Promise.withResolvers<void>()
  let requested = false
  await page.route(foodFactoryChunk, async route => { requested = true; await gate.promise; await route.continue() })
  try {
    await page.getByTestId('quick-food-startup-food').click()
    await expect.poll(() => requested).toBe(true)
    await page.getByTestId('assistant-open').click()
    await page.getByTestId('assistant-input').fill('正在写但没有发送的描述')
    if (closePanel) await page.getByTestId('meal-assistant').getByTestId('close-sheet').click()
    gate.resolve(); await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('food-editor')).toHaveCount(0)
    if (closePanel) await page.getByTestId('assistant-open').click()
    await expect(page.getByTestId('assistant-input')).toHaveValue('正在写但没有发送的描述')
  } finally { gate.resolve(); await page.unrouteAll({ behavior: 'wait' }) }
})
