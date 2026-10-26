import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'

/** 使用安装包解出的真实资源，并阻止后端／外部网络，验证独立产物。 */
export async function routeApkAssets(page: Page) {
  if (!process.env.SHIKE_E2E_APK_ASSETS) return
  const root = resolve(process.env.SHIKE_E2E_APK_ASSETS)
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!url.hostname.match(/^(127\.0\.0\.1|localhost)$/) || url.pathname.startsWith('/api/')) return route.abort('internetdisconnected')
    const path = resolve(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname)
    if (!path.startsWith(root + sep)) return route.abort()
    try {
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
      await route.fulfill({ status: 200, contentType: types[extname(path)] ?? 'application/octet-stream', body: await readFile(path) })
    } catch { await route.fulfill({ status: 404, body: 'Not found' }) }
  })
}
