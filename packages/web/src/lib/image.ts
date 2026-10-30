export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024
export const MAX_COMPRESSED_BYTES = 1024 * 1024

/**
 * 仅接收已经压缩的 JPEG，返回不含 data: 前缀的 Base64，供模型请求或照片 data URL 使用。
 * Base64 比二进制约多占三分之一空间，因此在读取前检查 1 MB 边界，避免把原图重复驻留内存。
 */
export function compressedImageBase64(file: File): Promise<string> {
  if (file.type !== 'image/jpeg' || !file.size || file.size > MAX_COMPRESSED_BYTES) return Promise.reject(new Error('请选择不超过1 MB的压缩JPEG图片。'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('照片读取失败，请重新选择。'))
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:image/jpeg;base64,') ? resolve(reader.result.split(',')[1]!) : reject(new Error('图片编码失败。'))
    reader.readAsDataURL(file)
  })
}

/** MIME/文件字节数只是早期检查；真正能否解码还需由 createImageBitmap 验证。 */
export function validateOriginal(file: Pick<File, 'size' | 'type'>): void {
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('原图不能超过 20 MB，请选择更小的图片。')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('支持 JPEG、PNG 和 WebP。HEIC 等图片请先转换为 JPEG。')
  }
  if (file.size === 0) throw new Error('这张图片是空文件，请重新选择。')
}

/**
 * 输入用户原图，输出最长边不超过1280、大小不超过1 MB、名字固定的 JPEG。
 * Canvas 只复制解码后的像素，不复制原 EXIF/GPS；透明背景铺白，避免转 JPEG 后变黑。
 * 若仍过大，最多5轮同时降低尺寸与质量。每轮 await toBlob，避免并行保留多份编码结果。
 * finally 必须 close 位图，即使画布不可用或编码失败也释放解码资源。
 * 像素限制在解码后才能检查，不能把它当成解码阶段的峰值内存保护；真机仍需验证大图。
 */
export async function compressImage(file: File): Promise<File> {
  validateOriginal(file)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { throw new Error('无法读取这张图片，请使用有效的 JPEG、PNG 或 WebP 图片。') }
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new Error('图片像素过大，请先缩小图片。')
    let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持图片压缩，请换用 Chrome 或 Edge。')
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86 - attempt * 0.1))
      if (blob && blob.size <= MAX_COMPRESSED_BYTES) return new File([blob], 'meal.jpg', { type: 'image/jpeg' })
      scale *= 0.82
    }
    throw new Error('图片压缩后仍然过大，请选择更小的图片。')
  } finally { bitmap.close() }
}
