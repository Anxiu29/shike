import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'

async function chooseOrion(page: Page) {
  await page.goto('/'); await page.getByTestId('manual-add').click()
  await page.getByTestId('food-picker-search').fill('好丽友')
  await page.locator('[data-testid^="food-option-package:"]').first().click()
  await expect(page.getByTestId('manual-food-sheet')).toBeVisible()
}
async function model(page: Page, options: { delay?: boolean; fail?: boolean } = {}) {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const requests: any[] = []
  await page.route('**/api/meal-assistant', async route => {
    const request = route.request().postDataJSON(); requests.push(request)
    if (options.delay) await pending
    if (options.fail) return route.fulfill({ status: 502, json: { error: { message: '规格不明，无法可靠估重，请填写实际大小。' } } })
    return route.fulfill({ json: { mode: 'live', provider: 'qwen', model: 'qwen3.7-flash', draft: { intent: 'estimate', date: request.date, mealType: request.mealType, message: '单独小包约34g，此为合成测试估值。', foods: [{ name: request.portionRequest.name, amount: 1, unit: request.portionRequest.unit, portionEstimate: { amountPerUnit: 34, basis: 'g', source: 'ai', assumption: '按单枚小包装估计，规格需核对；合成测试值，非实际商品规格' } }] } } })
  })
  return { requests, release }
}

test('好丽友单独小包自动AI估重，数量与单包大小可改，保存刷新不变成整盒445g', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { requests } = await model(page); await chooseOrion(page)
  await expect(page.getByTestId('package-portion-0-per-unit')).toHaveValue('34')
  await expect(page.getByTestId('package-label-0')).toContainText('AI估重'); await expect(page.getByTestId('package-label-0')).toContainText('445 g')
  expect(requests).toHaveLength(1); expect(requests[0].portionRequest.unit).toBe('包'); expect(requests[0].portionRequest.label.netContent).toBeNull()
  await page.getByTestId('package-portion-0-quantity').fill('2'); await expect(page.getByTestId('package-portion-0-summary')).toContainText('68 g')
  await page.getByTestId('package-portion-0-per-unit').fill('23'); await expect(page.getByTestId('package-portion-0-summary')).toContainText('46 g')
  await page.getByTestId('confirm-manual-food').click(); await expect(page.getByTestId('food-calories-0')).toContainText('198')
  await expect(page.getByTestId('package-portion-0-summary')).toContainText('46 g')
  if (process.env.SHIKE_QA_DIR) await page.screenshot({ path: join(process.env.SHIKE_QA_DIR, `portion-estimation-${info.project.name}.png`) })
  await page.getByTestId('save-meal').click(); await page.reload(); await expect(page.getByTestId('meal-record')).toContainText('2 包'); await expect(page.getByTestId('meal-record')).toContainText('46 g')
  await page.getByTestId('edit-meal').click(); await expect(page.getByTestId('package-portion-0-per-unit')).toHaveValue('23'); expect(requests).toHaveLength(1)
  expect(errors).toEqual([])
})

test('AI估重迟到不覆盖手填重量，失败不写入通用100g或200g', async ({ page }) => {
  const { requests, release } = await model(page, { delay: true }); await chooseOrion(page)
  await expect(page.getByTestId('portion-estimate')).toContainText('正在估重')
  await page.getByTestId('package-amount-0').fill('25'); release()
  await expect(page.getByTestId('portion-estimate')).not.toContainText('正在估重'); await expect(page.getByTestId('package-amount-0')).toHaveValue('25'); await expect(page.getByTestId('package-portion-0-per-unit')).toHaveCount(0)
  expect(requests).toHaveLength(1)
  await page.getByTestId('cancel-manual-food').click()
  await model(page, { fail: true }); await chooseOrion(page)
  await expect(page.getByTestId('portion-estimate-error')).toContainText('规格不明')
  await expect(page.getByTestId('package-amount-0')).toHaveValue(''); await expect(page.getByTestId('manual-food-preview')).toContainText('热量待补充')
})
