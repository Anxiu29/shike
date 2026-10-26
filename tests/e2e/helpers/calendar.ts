import { expect, type Page } from '@playwright/test'

export async function selectDate(page: Page, field: 'diary-date' | 'weight-date' | 'editor-date', value: string) {
  const [year, month] = value.split('-').map(Number)
  await page.getByTestId(field).click()
  await expect(page.getByTestId('calendar-sheet')).toBeVisible()
  await page.getByTestId('calendar-year').fill(String(year)); await page.getByTestId('calendar-year').blur()
  await page.getByTestId('calendar-month').selectOption(String(month))
  await page.getByTestId(`calendar-day-${value}`).click(); await page.getByTestId('calendar-confirm').click()
  await expect(page.getByTestId(field)).toHaveValue(value)
}
