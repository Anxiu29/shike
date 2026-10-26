import { expect, type Page } from '@playwright/test'
export type SettingsPanel = 'ai' | 'backup' | 'privacy' | 'sources' | 'updates'
const titles = { ai: 'AI 与模型', backup: '备份与恢复', privacy: '使用与隐私', sources: '食物数据来源', updates: '版本与更新' }
export async function closeSettingsPanel(page: Page) {
  const sheet = page.getByTestId('settings-detail')
  if (await sheet.isVisible()) { await sheet.getByTestId('close-sheet').click(); await expect(sheet).not.toBeVisible() }
}
export async function openSettingsPanel(page: Page, panel: SettingsPanel) {
  const sheet = page.getByTestId('settings-detail')
  if (await sheet.isVisible()) {
    if (await sheet.locator(':scope > .sheet-header h2').textContent() === titles[panel]) return
    await closeSettingsPanel(page)
  }
  await page.getByTestId(`settings-open-${panel}`).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.locator(':scope > .sheet-header h2')).toHaveText(titles[panel])
}
