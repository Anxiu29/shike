import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  globalTimeout: 120_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.SHIKE_E2E_ORIGIN ?? 'http://127.0.0.1:3101', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'Chrome 手机', use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'Chrome 桌面', use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 1440, height: 960 } } },
    { name: 'Edge 桌面', use: { browserName: 'chromium', channel: 'msedge', viewport: { width: 1280, height: 900 } } },
  ],
});
