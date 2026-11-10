import { test, expect, type Page } from '@playwright/test'
import { routeApkAssets } from './helpers/apk-assets'

async function setup(page: Page) {
  await routeApkAssets(page)
  await page.addInitScript(() => {
    const w = window as any
    w.androidBridge = {}
    w.__offlineCalls = []
    w.__offlineState = { stage: 'idle', busy: false, ready: false, loaded: false, backend: '', bytes: 1597922856, downloadedBytes: 0, progressBytes: 0, error: '', text: '', loadMs: -1, firstTextMs: -1, responseMs: -1, characters: 0, availableMemoryBytes: 8_000_000_000, totalMemoryBytes: 16_000_000_000, device: 'OPPO Find X9（模拟桥）' }
    w.Capacitor = {
      PluginHeaders: [{ name: 'PersonalVision', methods: [{ name: 'getState', rtype: 'promise' }] }, { name: 'OfflineAi', methods: ['getState', 'downloadModel', 'importModel', 'loadModel', 'generate', 'cancel', 'unload', 'deleteModel'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (plugin: string, method: string, options: any) => {
        if (plugin === 'PersonalVision') return { profiles: [], activeId: null }
        if (plugin !== 'OfflineAi') return {}
        w.__offlineCalls.push({ method, options })
        const state = w.__offlineState
        if (method === 'getState') return structuredClone(state)
        if (method === 'downloadModel') Object.assign(state, { stage: 'downloading', busy: true, error: '', downloadedBytes: 800_000_000, progressBytes: 800_000_000 })
        if (method === 'importModel') Object.assign(state, { stage: 'error', busy: false, error: '模型 SHA-256 校验失败，请重新选择指定文件。' })
        if (method === 'cancel') Object.assign(state, { stage: 'stopped', busy: false })
        if (method === 'loadModel') {
          if (options.backend === 'gpu' && w.__failGpu) Object.assign(state, { stage: 'error', busy: false, error: 'GPU 加载失败，请手动选择 CPU 再试。' })
          else Object.assign(state, { stage: 'loaded', busy: false, loaded: true, backend: options.backend, error: '', loadMs: 2345 })
        }
        if (method === 'generate') {
          Object.assign(state, { stage: 'generating', busy: true, text: '鸡蛋：2个', firstTextMs: 500, responseMs: 700, characters: 5 })
          if (!w.__holdGeneration) setTimeout(() => { Object.assign(state, { stage: 'completed', busy: false, text: '鸡蛋：2个\n米饭：1碗\n牛奶：1杯', responseMs: 1875, characters: 17 }) }, 900)
        }
        if (method === 'unload') Object.assign(state, { stage: state.ready ? 'ready' : 'idle', loaded: false, busy: false })
        if (method === 'deleteModel') Object.assign(state, { stage: 'idle', ready: false, loaded: false, downloadedBytes: 0 })
        return {}
      },
    }
  })
  await page.goto('/')
  const mobile = page.getByTestId('tab-settings')
  await (await mobile.isVisible() ? mobile : page.getByTestId('desktop-tab-settings')).click()
}

test('离线入口按需调用，下载可停止续传，校验失败仍可处理且窄屏不溢出', async ({ page }) => {
  await setup(page)
  expect(await page.evaluate(() => (window as any).__offlineCalls)).toEqual([])
  await page.getByTestId('settings-open-offline').click()
  await expect(page.getByTestId('offline-status')).toHaveText('模型尚未准备')
  await expect(page.getByTestId('offline-load')).toBeDisabled()
  await expect(page.getByTestId('offline-generate')).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__offlineCalls.every((call: any) => call.method === 'getState'))).toBe(true)
  await page.getByTestId('offline-download').click()
  await expect(page.getByTestId('offline-status')).toHaveText('正在下载')
  await expect(page.getByTestId('offline-import')).toBeDisabled()
  await expect(page.getByTestId('settings-detail').getByTestId('close-sheet')).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(page.getByTestId('offline-ai-test')).toBeVisible()
  await page.getByTestId('offline-stop').click()
  await expect(page.getByTestId('offline-download')).toHaveText('继续下载模型')
  await page.getByTestId('offline-import').click()
  await expect(page.getByTestId('offline-error')).toContainText('SHA-256')
  await expect(page.getByTestId('offline-download')).toBeEnabled()
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 650 })
    expect(await page.getByTestId('settings-detail').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('offline-ai-test')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__offlineCalls.some((call: any) => call.method === 'unload'))).toBe(true)
})

test('GPU失败后手动CPU加载，本机文字流与耗时显示，取消后可继续，关闭释放', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.method() === 'POST') requests.push(request.url()) })
  await setup(page)
  await page.evaluate(() => { Object.assign((window as any).__offlineState, { stage: 'ready', ready: true }); (window as any).__failGpu = true })
  await page.getByTestId('settings-open-offline').click()
  await page.getByTestId('offline-load').click()
  await expect(page.getByTestId('offline-error')).toContainText('GPU')
  expect(await page.evaluate(() => (window as any).__offlineCalls.filter((call: any) => call.method === 'loadModel').map((call: any) => call.options.backend))).toEqual(['gpu'])
  await page.getByTestId('offline-backend').selectOption('cpu')
  await page.getByTestId('offline-load').click()
  await expect(page.getByTestId('offline-status')).toHaveText('已加载，可以提问')
  await expect(page.getByTestId('offline-backend')).toBeDisabled()
  await page.getByTestId('offline-generate').click()
  await expect(page.getByTestId('offline-answer')).toContainText('鸡蛋')
  await expect(page.getByTestId('offline-status')).toHaveText('本次生成完成')
  await expect(page.getByTestId('offline-metrics')).toContainText('2.35 秒')
  await expect(page.getByTestId('offline-metrics')).toContainText('0.50 秒')
  await expect(page.getByTestId('offline-metrics')).toContainText('1.88 秒')
  await page.evaluate(() => { (window as any).__holdGeneration = true })
  await page.getByTestId('offline-generate').click()
  await page.getByTestId('offline-stop').click()
  await expect(page.getByTestId('offline-generate')).toBeEnabled()
  await page.getByTestId('offline-unload').click()
  await expect(page.getByTestId('offline-backend')).toBeEnabled()
  await expect(page.getByTestId('offline-generate')).toBeDisabled()
  expect(requests).toEqual([])
  if (test.info().project.name === 'Chrome 手机') {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('offline-answer').scrollIntoViewIfNeeded()
    await page.getByTestId('settings-detail').screenshot({ path: 'artifacts/offline-ai-mobile.png' })
  }
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('offline-delete').click()
  await expect(page.getByTestId('offline-status')).toHaveText('模型尚未准备')
})
