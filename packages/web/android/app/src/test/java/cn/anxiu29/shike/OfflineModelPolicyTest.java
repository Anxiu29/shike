package cn.anxiu29.shike;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.URL;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicBoolean;

public class OfflineModelPolicyTest {
    @Test public void redirectsOnlyUseOfficialHttpsHosts() throws Exception {
        assertTrue(OfflineModelPolicy.allowedDownload(new URL(OfflineModelPolicy.URL)));
        assertTrue(OfflineModelPolicy.allowedDownload(new URL("https://cas-bridge.xethub.hf.co/file")));
        for (String url : new String[]{"http://huggingface.co/file", "https://huggingface.co.evil.test/file", "https://127.0.0.1/file", "https://user:pass@huggingface.co/file", "https://huggingface.co:8443/file"}) assertFalse(url, OfflineModelPolicy.allowedDownload(new URL(url)));
    }
    @Test public void resumeOnlyAcceptsExactFinalSize() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        OfflineModelPolicy.copy(new ByteArrayInputStream(new byte[]{2, 3}), out, 1, 3, () -> false, value -> {});
        assertArrayEquals(new byte[]{2, 3}, out.toByteArray());
        for (int length : new int[]{1, 3}) {
            try { OfflineModelPolicy.copy(new ByteArrayInputStream(new byte[length]), new ByteArrayOutputStream(), 1, 3, () -> false, value -> {}); fail("must reject truncated or oversized download"); }
            catch (IOException expected) { }
        }
    }
    @Test public void cancellationDoesNotCommitMoreBytes() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try { OfflineModelPolicy.copy(new ByteArrayInputStream(new byte[]{1, 2}), out, 0, 2, () -> true, value -> {}); fail(); }
        catch (InterruptedIOException expected) { assertEquals(0, out.size()); }
    }
    @Test public void cancellationWhileReadingDoesNotWriteTheReturnedChunk() throws Exception {
        AtomicBoolean cancelled = new AtomicBoolean(false);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // 模拟网络读取期间用户点击停止；已返回的字节仍不得追加到续传文件。
        InputStream source = new ByteArrayInputStream(new byte[]{1, 2}) {
            @Override public synchronized int read(byte[] buffer, int offset, int length) {
                int count = super.read(buffer, offset, length);
                cancelled.set(true);
                return count;
            }
        };
        assertThrows(InterruptedIOException.class, () -> OfflineModelPolicy.copy(source, out, 0, 2, cancelled::get, value -> {}));
        assertEquals(0, out.size());
    }
    @Test public void importedFileMustMatchSizeAndSha256() throws Exception {
        File file = File.createTempFile("offline-model", ".bin");
        try {
            Files.write(file.toPath(), new byte[]{97, 98, 99});
            String digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
            OfflineModelPolicy.verify(file, 3, digest, () -> false, value -> {});
            for (long size : new long[]{2, 4}) {
                try { OfflineModelPolicy.verify(file, size, digest, () -> false, value -> {}); fail(); }
                catch (IOException expected) { }
            }
            Files.write(file.toPath(), new byte[]{97, 98, 100});
            try { OfflineModelPolicy.verify(file, 3, digest, () -> false, value -> {}); fail(); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("SHA-256")); }
        } finally { file.delete(); }
    }
}
