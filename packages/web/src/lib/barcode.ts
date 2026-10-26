import { validBarcode } from '@shike/shared'
/** 照片只在设备本地解码，得到条码后才查询商品；不上传条码照片。 */
export async function readBarcode(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024 || !file.size) throw new Error('请选择不超过20MB的JPEG、PNG或WebP条码照片。')
  const { BinaryBitmap, HybridBinarizer, MultiFormatReader, RGBLuminanceSource, DecodeHintType, BarcodeFormat } = await import('@zxing/library')
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new Error('条码照片像素过大，请裁剪条码后重试。')
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('当前设备不能读取条码照片，请手动输入。')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, grey = new Uint8ClampedArray(canvas.width * canvas.height)
    for (let i = 0; i < grey.length; i++) grey[i] = (pixels[4 * i]! + 2 * pixels[4 * i + 1]! + pixels[4 * i + 2]!) / 4
    const reader = new MultiFormatReader(), hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]); hints.set(DecodeHintType.TRY_HARDER, true)
    try { const code = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(grey, canvas.width, canvas.height))), hints).getText(); if (!validBarcode(code)) throw new Error(); return code }
    catch { throw new Error('没有读清商品条码。请让条码横向、清晰且完整，或直接输入数字。') }
    finally { reader.reset() }
  } finally { bitmap.close() }
}
