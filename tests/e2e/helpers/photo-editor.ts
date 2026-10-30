import { expect, type Page } from '@playwright/test';
/** 旧编辑器功能测试跳过拍摄；真实取景与模式交接由camera.spec覆盖。 */
export async function openPhotoEditor(page: Page) {
  await page.getByTestId('hero-camera').click();
  // 相机/编辑器按需加载，click 返回时组件可能尚未挂载，不能用立即 count 判断入口。
  await expect(page.getByTestId('capture-camera').or(page.getByTestId('food-editor'))).toBeVisible();
  // 响应式入口仅手机／原生平台先打开相机。
  if (await page.getByTestId('capture-camera').isVisible()) await page.getByTestId('camera-skip').click();
  await expect(page.getByTestId('food-editor')).toBeVisible();
}
