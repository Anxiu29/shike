import type { Page } from '@playwright/test';
/** 旧编辑器功能测试跳过拍摄；真实取景与模式交接由camera.spec覆盖。 */
export async function openPhotoEditor(page: Page) {
  await page.getByTestId('hero-camera').click();
  // 响应式入口仅手机／原生平台先打开相机。
  if (await page.getByTestId('capture-camera').count()) await page.getByTestId('camera-skip').click();
}
