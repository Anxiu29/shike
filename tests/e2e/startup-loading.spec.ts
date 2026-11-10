import { test, expect, type Page } from '@playwright/test'

const assistantChunk = /\/assets\/MealAssistant-[^/]+\.js(?:\?|$)/
async function tab(page: Page, name: 'diary' | 'settings' | 'weight') {
  const mobile = page.getByTestId(`tab-${name}`)
  await (await mobile.isVisible() ? mobile : page.getByTestId(`desktop-tab-${name}`)).click()
}

test('冷启动不提前加载食品库和助手，首屏脚本控制在1MB以内，首次点击正常打开', async ({ page }) => {
  const errors: string[] = [], assistantRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (assistantChunk.test(request.url())) assistantRequests.push(request.url()) })
  await page.goto('/')
  await expect(page).toHaveTitle('食刻 · 好好吃饭，慢慢记录')
  await expect(page.getByTestId('daily-summary')).toBeVisible()
  await expect(page.getByTestId('assistant-open')).toBeVisible()
  await page.waitForLoadState('networkidle')
  const scriptBytes = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && /\/assets\/[^/]+\.js(?:\?|$)/.test(entry.name))
    .reduce((sum, entry) => sum + entry.decodedBodySize, 0))
  // 比较全部下载脚本，不会因把入口拆成更多预加载文件而假通过；不是设备启动耗时断言。
  expect(scriptBytes).toBeGreaterThan(0)
  expect(scriptBytes).toBeLessThan(1_000_000)
  expect(assistantRequests).toEqual([])
  await page.getByTestId('assistant-open').click()
  await expect(page.getByTestId('meal-assistant')).toBeVisible()
  await expect(page.getByTestId('assistant-input')).toBeVisible()
  expect(assistantRequests.length).toBeGreaterThan(0)
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click()
  await expect(page.getByTestId('assistant-open')).toBeFocused()
  expect(errors).toEqual([])
})

test('首次加载中有反馈且不能重复点击，切到设置后加载完成不会突然弹出助手', async ({ page }) => {
  const gate = Promise.withResolvers<void>()
  let requested = false
  await page.route(assistantChunk, async route => { requested = true; await gate.promise; await route.continue() })
  try {
    await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
    await page.getByTestId('assistant-open').click()
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByTestId('assistant-open')).toBeDisabled()
    await expect(page.getByTestId('assistant-open')).toContainText('正在打开')
    await tab(page, 'settings'); await expect(page.getByTestId('settings-food-library')).toBeVisible()
    gate.resolve(); await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('meal-assistant')).not.toBeVisible()
    await tab(page, 'diary'); await page.getByTestId('assistant-open').click()
    await expect(page.getByTestId('meal-assistant')).toBeVisible()
    await page.getByTestId('assistant-input').fill('尚未发送的午餐描述')
    await page.getByTestId('meal-assistant').getByTestId('close-sheet').click()
    await page.getByTestId('assistant-open').click()
    await expect(page.getByTestId('assistant-input')).toHaveValue('尚未发送的午餐描述')
  } finally { gate.resolve(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('助手下载失败有可关闭的提示，不自动刷新，手动记餐仍可打开', async ({ page }) => {
  await page.route(assistantChunk, route => route.abort('failed'))
  await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  await page.getByTestId('assistant-open').click()
  await expect(page.getByTestId('async-panel-error')).toContainText('内容加载失败')
  await page.getByTestId('assistant-load-error').getByTestId('close-sheet').click()
  await page.getByTestId('manual-add').click()
  await expect(page.getByTestId('food-editor')).toBeVisible()
  expect(navigations).toBe(0)
})

for (const destination of ['weight', 'settings'] as const) test(`加载中切到${destination === 'weight' ? '体重' : '设置后返回首页'}取消旧的打开意图`, async ({ page }) => {
  const gate = Promise.withResolvers<void>()
  let requested = false
  await page.route(assistantChunk, async route => { requested = true; await gate.promise; await route.continue() })
  try {
    await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
    await page.getByTestId('assistant-open').click()
    await expect.poll(() => requested).toBe(true)
    await tab(page, destination)
    if (destination === 'weight') await expect(page.getByTestId('current-weight')).toBeVisible()
    else { await expect(page.getByTestId('settings-food-library')).toBeVisible(); await tab(page, 'diary') }
    gate.resolve(); await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('meal-assistant')).not.toBeVisible()
    await page.getByTestId('assistant-open').click()
    await expect(page.getByTestId('meal-assistant')).toBeVisible()
  } finally { gate.resolve(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('首次加载超时后可退出，迟到的资源不会自动弹出，重新点击可以打开', async ({ page }) => {
  const gate = Promise.withResolvers<void>()
  let requested = false
  await page.clock.install()
  await page.route(assistantChunk, async route => { requested = true; await gate.promise; await route.continue() })
  try {
    await page.goto('/'); await expect(page.getByTestId('daily-summary')).toBeVisible()
    await page.getByTestId('assistant-open').click()
    await expect.poll(() => requested).toBe(true)
    await page.clock.fastForward(20_001)
    await expect(page.getByTestId('async-panel-error')).toContainText('内容加载失败')
    await page.getByTestId('assistant-load-error').getByTestId('close-sheet').click()
    gate.resolve(); await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('meal-assistant')).not.toBeVisible()
    await expect(page.getByTestId('assistant-open')).toBeEnabled()
    await page.getByTestId('assistant-open').click()
    await expect(page.getByTestId('meal-assistant')).toBeVisible()
  } finally { gate.resolve(); await page.unrouteAll({ behavior: 'wait' }) }
})
