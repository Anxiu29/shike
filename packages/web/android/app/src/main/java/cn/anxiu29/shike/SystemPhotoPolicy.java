package cn.anxiu29.shike;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** 系统相机结果只接受有界JPEG；原图不写入餐次或长期保留。 */
final class SystemPhotoPolicy {
    static final int MAX_BYTES = 20 * 1024 * 1024;
    static byte[] readJpeg(InputStream source) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int count;
        while ((count = source.read(buffer)) != -1) {
            if (out.size() + count > MAX_BYTES) throw new IOException("原图超过20MB，请在系统相机降低拍摄分辨率后重试。");
            out.write(buffer, 0, count);
        }
        byte[] data = out.toByteArray();
        if (data.length < 4 || (data[0] & 255) != 255 || (data[1] & 255) != 216) throw new IOException("系统相机没有返回有效JPEG照片，请重拍或从相册选择。");
        return data;
    }
}
