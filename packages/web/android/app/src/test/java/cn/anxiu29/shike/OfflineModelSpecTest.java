package cn.anxiu29.shike;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.URL;

public class OfflineModelSpecTest {
    @Test public void addingVisionPreservesExistingTextModelIdentityAndLocation() {
        assertEquals("offline-ai", OfflineModelSpec.TEXT.directory);
        assertEquals(OfflineModelPolicy.FILE, OfflineModelSpec.TEXT.file);
        assertEquals(OfflineModelPolicy.SHA256, OfflineModelSpec.TEXT.sha256);
        assertFalse(OfflineModelSpec.TEXT.vision);
        assertNotEquals(OfflineModelSpec.TEXT.directory, OfflineModelSpec.VISION.directory);
        assertNotEquals(OfflineModelSpec.TEXT.file, OfflineModelSpec.VISION.file);
        assertTrue(OfflineModelSpec.VISION.vision);
    }
    @Test public void visionDownloadIsFixedToVerifiedMultimodalVersion() throws Exception {
        assertTrue(OfflineModelPolicy.allowedDownload(new URL(OfflineModelSpec.VISION.url)));
        assertTrue(OfflineModelSpec.VISION.url.contains("/resolve/" + OfflineModelSpec.VISION_REVISION + "/"));
        assertTrue(OfflineModelSpec.VISION.file.contains("-VL_"));
        assertTrue(OfflineModelSpec.VISION.sha256.matches("[0-9a-f]{64}"));
        assertEquals(1_303_671_472L, OfflineModelSpec.VISION.bytes);
    }
}
