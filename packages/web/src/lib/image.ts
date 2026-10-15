export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024
export const MAX_COMPRESSED_BYTES = 1024 * 1024

export function validateOriginal(file: Pick<File, 'size' | 'type'>): void {
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error('原图不能超过 20 MB，请选择更小的图片。')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('支持 JPEG、PNG 和 WebP。HEIC 等图片请先转换为 JPEG。')
  }
  if (file.size === 0) throw new Error('这张图片是空文件，请重新选择。')
}

/** 图片只在内存中解码与重编码：缩小尺寸，同时去除 EXIF 等照片元数据。 */
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
