/**
 * 前端压缩不能代替服务端验证：HTTP调用者可以绕过网页直接上传任意字节。
 * 同时检查体积、文件签名与声明MIME、解码像素和单帧，再用sharp重编码为JPEG。
 * 内存里处理且不落上传目录；应用方向后移除EXIF/GPS，最终只把清洗后的数据交模型。
 */
import sharp from 'sharp';
import { ApiError } from './errors.js';
import type { VisionImage } from './vision/types.js';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 10_000_000;

function signatureType(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

export async function sanitizeImage(buffer: Buffer, declaredMime: string): Promise<VisionImage> {
  if (buffer.length === 0) throw new ApiError('IMAGE_EMPTY', '请选择一张照片。');
  if (buffer.length > MAX_IMAGE_BYTES) throw new ApiError('IMAGE_TOO_LARGE', '压缩后的照片不能超过 2 MB。', 413);
  const actualMime = signatureType(buffer);
  if (!actualMime || actualMime !== declaredMime) throw new ApiError('IMAGE_TYPE_INVALID', '仅支持真实的 JPEG、PNG 或 WebP 图片。', 415);
  try {
    const source = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, animated: true, failOn: 'warning' });
    const meta = await source.metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_IMAGE_PIXELS || (meta.pages ?? 1) > 1) {
      throw new ApiError('IMAGE_DIMENSIONS_INVALID', '照片像素过大或包含动画，请压缩成单张图片。', 413);
    }
    // 默认重编码不会复制 EXIF/GPS，rotate() 先应用相机方向，避免送入模型的照片倒置。
    const data = await source.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    return { data, mimeType: 'image/jpeg' };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('IMAGE_DECODE_FAILED', '照片损坏、格式异常或像素超过 1000 万，请换一张照片。', 415);
  }
}
