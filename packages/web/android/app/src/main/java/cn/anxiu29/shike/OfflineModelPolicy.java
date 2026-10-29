package cn.anxiu29.shike;

import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;

/** 固定官方转换版本，下载和导入均以真实大小与 LFS SHA-256 验证，不能导入任意原生模型。 */
final class OfflineModelPolicy {
    static final long BYTES = 1_597_922_856L;
    static final String SHA256 = "c4a9b7289365ab80fe599b844b77ad253eb3c53fb0e5d963d699146a6f01255e";
    static final String FILE = "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm";
    static final String REVISION = "2f23bacf8ec78b83dfcd7271c5cb25777b1be5e0";
    static final String URL = "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/" + REVISION + "/" + FILE;

    static boolean allowedDownload(URL url) {
        String host = url.getHost().toLowerCase(java.util.Locale.ROOT);
        return url.getProtocol().equals("https") && url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443)
            && (host.equals("huggingface.co") || host.endsWith(".huggingface.co") || host.endsWith(".hf.co"));
    }

    static void copy(InputStream in, OutputStream out, long offset, long expected, BooleanSupplier cancelled, LongConsumer progress) throws IOException {
        byte[] buffer = new byte[256 * 1024];
        long received = offset;
        if (offset < 0 || offset > expected) throw new IOException("文件长度无效。");
        int count;
        while (true) {
            if (cancelled.getAsBoolean()) throw new InterruptedIOException("已停止。");
            count = in.read(buffer);
            if (count == -1) break;
            if (received + count > expected) throw new IOException("模型文件超过预期大小，已停止。");
            out.write(buffer, 0, count);
            received += count;
            progress.accept(received);
        }
        if (cancelled.getAsBoolean()) throw new InterruptedIOException("已停止。");
        if (received != expected) throw new IOException("模型文件不完整，请继续下载或重新选择文件。");
    }

    static void verify(File file, long expected, String sha256, BooleanSupplier cancelled, LongConsumer progress) throws Exception {
        if (file.length() != expected) throw new IOException("模型文件大小不符，请下载指定版本。");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[256 * 1024]; long read = 0; int count;
            while ((count = in.read(buffer)) != -1) {
                if (cancelled.getAsBoolean()) throw new InterruptedIOException("已停止校验。");
                digest.update(buffer, 0, count); read += count; progress.accept(read);
            }
        }
        StringBuilder actual = new StringBuilder();
        for (byte value : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        if (!actual.toString().equals(sha256)) throw new IOException("模型 SHA-256 校验失败，请删除下载后重新下载，或重新选择指定文件。");
    }
}
