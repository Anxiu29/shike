package cn.anxiu29.shike;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.IOException;

public class SystemPhotoPolicyTest {
    @Test public void jpegBytesArePreservedForWebDecodeAndMetadataRemoval() throws Exception {
        byte[] bytes = new byte[] { (byte) 255, (byte) 216, (byte) 255, (byte) 217 };
        assertArrayEquals(bytes, SystemPhotoPolicy.readJpeg(new ByteArrayInputStream(bytes)));
    }
    @Test public void emptyAndNonJpegAreRejected() throws Exception {
        for (byte[] data : new byte[][] { {}, { (byte) 255, (byte) 216 }, { 80, 78, 71, 10 } }) {
            try { SystemPhotoPolicy.readJpeg(new ByteArrayInputStream(data)); fail("invalid image accepted"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("JPEG")); }
        }
    }
    @Test public void outputCannotGrowPastOriginalImageLimit() throws Exception {
        InputStream large = new InputStream() {
            int left = SystemPhotoPolicy.MAX_BYTES + 1;
            @Override public int read() { return left-- > 0 ? 0 : -1; }
            @Override public int read(byte[] target, int offset, int length) {
                if (left <= 0) return -1;
                int count = Math.min(left, length); left -= count; return count;
            }
        };
        try { SystemPhotoPolicy.readJpeg(large); fail("oversized image accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("20MB")); }
    }
}
