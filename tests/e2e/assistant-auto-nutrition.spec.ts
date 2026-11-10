import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { routeApkAssets } from './helpers/apk-assets'

test.beforeEach(async ({ page }) => { await routeApkAssets(page) })
async function model(page: Page, fail = false, delay = false) {
  await page.addInitScript(({ fail, delay }) => {
    const w = window as any, id = '790650e2-3696-43d1-927a-596f3e69de84'
    w.androidBridge = {}; w.__nutritionCalls = []
    w.Capacitor = { PluginHeaders: [{ name: 'PersonalVision', methods: ['getState', 'activate', 'describeMeal'].map(name => ({ name, rtype: 'promise' })) }], nativePromise: async (_plugin: string, method: string, input: any) => {
      if (method === 'getState' || method === 'activate') return { profiles: [{ id, label: '测试模型', provider: 'qwen', model: 'qwen3.7-flash' }], activeId: id }
      if (method === 'describeMeal') {
        const request = JSON.parse(input.request); w.__nutritionCalls.push(request)
        const estimateOnly = /热量/.test(request.text), filling = !!request.enrichment
        if (!filling && delay) await new Promise<void>(resolve => { w.__releaseInitialNutrition = resolve })
        if (filling && fail) throw new Error('合成测试：营养估算暂不可用')
        const food = { name: '鸡蛋饼', amount: 1, unit: '个', ...(filling ? {
          portionEstimate: { amountPerUnit: 150, basis: 'g', source: 'ai', assumption: '合成测试：按中等鸡蛋饼估重，非实测' },
          nutritionEstimate: { basis: 'g', rangesPer100: { energyKcal: { min: 180, max: 260 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['合成测试：含面糊、鸡蛋及少量油，非真实食品营养规格'] },
        } : {}) }
        const draft = { intent: filling || estimateOnly ? 'estimate' : 'update', date: request.date, mealType: request.mealType, foods: [food], message: filling ? '已补上可修改的AI估值，需核对' : '待核对草稿' }
        return { provider: 'qwen', model: 'qwen3.7-flash', data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }) }
      }
    } }
  }, { fail, delay })
  await page.goto('/'); await expect(page).toHaveTitle('食刻 · 好好吃饭，慢慢记录')
  await page.getByTestId('assistant-open').click()
}
async function send(page: Page, text: string) {
  await page.getByTestId('assistant-input').fill(text); await page.getByTestId('assistant-send').click()
  await expect(page.getByTestId('assistant-input')).toHaveValue('')
}
test('一个鸡蛋饼自动补齐重量和热量，改数量、详细编辑与刷新保存保持来源和范围', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await model(page); await send(page, '一个鸡蛋饼')
  await expect(page.getByTestId('assistant-food-0')).toContainText('330 kcal')
  const result = page.getByTestId('assistant-messages').getByTestId('assistant-nutrition')
  await expect(result).toContainText('270–390 kcal')
  await result.getByText('查看计算依据').click(); await expect(result).toContainText('qwen3.7-flash')
  const calls = await page.evaluate(() => (window as any).__nutritionCalls)
  expect(calls).toHaveLength(2); expect(calls[1].enrichment[0]).toMatchObject({ name: '鸡蛋饼', amount: 1, unit: '个' })
  await page.getByTestId('assistant-amount-0').fill('2'); await page.getByTestId('assistant-amount-0').dispatchEvent('change')
  await expect(page.getByTestId('assistant-food-0')).toContainText('660 kcal')
  if (process.env.SHIKE_QA_DIR) await page.screenshot({ path: join(process.env.SHIKE_QA_DIR, `assistant-auto-nutrition-${info.project.name}.png`) })
  await page.getByTestId('assistant-review').click(); await expect(page.getByTestId('food-editor')).toBeVisible()
  await expect(page.getByTestId('food-calories-0')).toContainText('660')
  await page.getByTestId('save-meal').click(); await expect(page.getByTestId('meal-record')).toContainText('鸡蛋饼')
  await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('660')
  expect(errors).toEqual([])
})
test('只问热量也自动估算，不创建待保存草稿或餐次', async ({ page }) => {
  await model(page); await send(page, '一个鸡蛋饼多少热量')
  await expect(page.getByTestId('assistant-nutrition')).toContainText('330 kcal')
  await expect(page.getByTestId('assistant-draft')).toHaveCount(0); await expect(page.getByTestId('meal-record')).toHaveCount(0)
})
test('自动补问失败仍可核对和保存，未知热量不会变成0', async ({ page }) => {
  await model(page, true); await send(page, '一个鸡蛋饼')
  await expect(page.getByTestId('assistant-messages')).toContainText('自动补估未完成')
  await expect(page.getByTestId('assistant-food-0')).toContainText('热量待补充')
  await expect(page.getByTestId('assistant-nutrition')).not.toContainText('约 0 kcal')
  expect(await page.evaluate(() => (window as any).__nutritionCalls.length)).toBe(2)
  await page.getByTestId('assistant-review').click(); await expect(page.locator('.footer-calories')).toContainText('—')
})
test('请求等待时关闭再重开助手不继续追加模型调用', async ({ page }) => {
  await model(page, false, true)
  await page.getByTestId('assistant-input').fill('一个鸡蛋饼'); await page.getByTestId('assistant-send').click()
  await expect.poll(() => page.evaluate(() => (window as any).__nutritionCalls.length)).toBe(1)
  await page.getByTestId('meal-assistant').getByTestId('close-sheet').click()
  await page.getByTestId('assistant-open').click()
  await page.evaluate(() => (window as any).__releaseInitialNutrition())
  await expect(page.getByTestId('assistant-input')).toHaveValue('')
  expect(await page.evaluate(() => (window as any).__nutritionCalls.length)).toBe(1)
})
