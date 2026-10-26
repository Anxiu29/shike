package cn.anxiu29.shike;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

public class UpdatePolicyTest {
    @Test public void giteeReleaseOrderUsesActualInstantsAcrossTimezones() {
        long old = UpdatePolicy.releaseTimestamp("2026-10-24T17:24:06+08:00"), latest = UpdatePolicy.releaseTimestamp("2026-10-26T09:12:37+08:00");
        assertTrue(latest > old);
        assertEquals(latest, UpdatePolicy.releaseTimestamp("2026-10-26T01:12:37Z"));
        assertTrue(UpdatePolicy.releaseTimestamp("2026-10-26T01:15:00.123Z") > latest);
        assertEquals(0, UpdatePolicy.releaseTimestamp("not-a-date"));
        assertEquals(0, UpdatePolicy.releaseTimestamp("2026-02-30T01:12:37Z"));
    }
    @Test public void giteeHasIndependentRepositoryAssetAndRedirectRules() throws Exception {
        assertEquals("anxiu29/shike", UpdatePolicy.repository("https://gitee.com/anxiu29/shike.git/", "gitee"));
        assertEquals("user_name/app", UpdatePolicy.repository("user_name/app", "gitee"));
        for (String value : new String[] {"https://github.com/a/b", "https://token@gitee.com/a/b", "a/..", "a/b?token=x"}) assertThrows(Exception.class, () -> UpdatePolicy.repository(value, "gitee"));
        String prefix = "https://gitee.com/anxiu29/shike/releases/download/v-next/";
        assertEquals(prefix + "shike.apk", UpdatePolicy.asset(prefix + "shike.apk", "anxiu29/shike", "shike.apk", "gitee"));
        for (String value : new String[] {prefix.replace("anxiu29", "other") + "shike.apk", prefix.replace("gitee.com", "github.com") + "shike.apk", prefix + "shike.apk?token=x", prefix.replace("v-next", "tag%2Fother") + "shike.apk"}) assertThrows(Exception.class, () -> UpdatePolicy.asset(value, "anxiu29/shike", "shike.apk", "gitee"));
        UpdatePolicy.redirect("https://gitee.com/a/b/attach_files/123/download", "gitee");
        UpdatePolicy.redirect("https://foruda.gitee.com/attach/example?signature=temporary", "gitee");
        for (String value : new String[] {"http://gitee.com/a", "https://gitee.com.evil.test/a", "https://github.com/a", "https://token@foruda.gitee.com/a", "https://foruda.gitee.com:8443/a"}) assertThrows(Exception.class, () -> UpdatePolicy.redirect(value, "gitee"));
        assertThrows(Exception.class, () -> UpdatePolicy.redirect("https://foruda.gitee.com/a", "github"));
    }
    @Test public void downloadFallbackRequiresExactSameVersionNameSizeAndHash() {
        UpdatePolicy.mirror(36, "0.11.13-test", 2048, "a".repeat(64), 36, "0.11.13-test", 2048, "a".repeat(64));
        assertThrows(Exception.class, () -> UpdatePolicy.mirror(36, "v", 2048, "a", 37, "v", 2048, "a"));
        assertThrows(Exception.class, () -> UpdatePolicy.mirror(36, "v", 2048, "a", 36, "other", 2048, "a"));
        assertThrows(Exception.class, () -> UpdatePolicy.mirror(36, "v", 2048, "a", 36, "v", 1024, "a"));
        assertThrows(Exception.class, () -> UpdatePolicy.mirror(36, "v", 2048, "a", 36, "v", 2048, "b"));
    }
    @Test public void repositoryDoesNotAcceptCredentialsCustomHostsOrPaths() {
        assertEquals("Anxiu29/shike", UpdatePolicy.repository(" https://github.com/Anxiu29/shike.git/ "));
        for (String value : new String[] {"a/..", "a/.git", "a/b/releases", "https://secret@github.com/a/b", "http://github.com/a/b", "https://evil.test/a/b", "a/b?secret"}) assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.repository(value));
    }
    @Test public void releaseAssetsMustMatchRepositoryAndFixedFilenames() throws Exception {
        String prefix = "https://github.com/Anxiu29/shike/releases/download/v0.12.0-test/";
        assertEquals(prefix + "shike.apk", UpdatePolicy.asset(prefix + "shike.apk", "Anxiu29/shike", "shike.apk"));
        for (String value : new String[] {prefix.replace("Anxiu29", "other") + "shike.apk", prefix + "shike.apk?token=x", prefix + "other.apk", prefix.replace("v0.12.0-test", "%2e%2e") + "shike.apk", prefix.replace("v0.12.0-test", "tag%2Fother") + "shike.apk"}) assertThrows(Exception.class, () -> UpdatePolicy.asset(value, "Anxiu29/shike", "shike.apk"));
    }
    @Test public void githubRedirectsCannotDowngradeHttpsOrSendToOtherHosts() throws Exception {
        UpdatePolicy.redirect("https://release-assets.githubusercontent.com/github-production-release-asset/example?signature=temporary");
        for (String value : new String[] {"http://github.com/a", "https://github.com.evil.test/a", "https://evil.test/a", "https://secret@github.com/a", "https://github.com:8443/a"}) assertThrows(Exception.class, () -> UpdatePolicy.redirect(value));
    }
    private void archive(String id, long current, long actual, String name, int sdk, String[] signers) { UpdatePolicy.archive("cn.anxiu29.shike", id, current, 33, actual, "0.12.0-test", name, 24, sdk, 36, new String[] {"same-signer"}, signers); }
    @Test public void installationRequiresNewerVersionSamePackageAndExactCurrentSigners() {
        archive("cn.anxiu29.shike", 32, 33, "0.12.0-test", 24, new String[] {"same-signer"});
        assertThrows(Exception.class, () -> archive("other.app", 32, 33, "0.12.0-test", 24, new String[] {"same-signer"}));
        assertThrows(Exception.class, () -> archive("cn.anxiu29.shike", 33, 33, "0.12.0-test", 24, new String[] {"same-signer"}));
        assertThrows(Exception.class, () -> archive("cn.anxiu29.shike", 32, 34, "0.12.0-test", 24, new String[] {"same-signer"}));
        assertThrows(Exception.class, () -> archive("cn.anxiu29.shike", 32, 33, "fake", 24, new String[] {"same-signer"}));
        assertThrows(Exception.class, () -> archive("cn.anxiu29.shike", 32, 33, "0.12.0-test", 25, new String[] {"same-signer"}));
        assertThrows(Exception.class, () -> archive("cn.anxiu29.shike", 32, 33, "0.12.0-test", 24, new String[] {"other-signer"}));
        assertThrows(Exception.class, () -> archive("cn.anxiu29.shike", 32, 33, "0.12.0-test", 24, new String[0]));
    }
    @Test public void downloadOnlyCompletesWithExactLengthAndSha256() throws Exception {
        byte[] bytes = new byte[2048]; String sha = UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(bytes)); ByteArrayOutputStream output = new ByteArrayOutputStream();
        UpdatePolicy.copyVerified(new ByteArrayInputStream(bytes), output, bytes.length, sha, () -> false, received -> assertTrue(received <= bytes.length)); assertArrayEquals(bytes, output.toByteArray());
        assertThrows(Exception.class, () -> UpdatePolicy.copyVerified(new ByteArrayInputStream(bytes), new ByteArrayOutputStream(), 2049, sha, () -> false, received -> {}));
        assertThrows(Exception.class, () -> UpdatePolicy.copyVerified(new ByteArrayInputStream(bytes), new ByteArrayOutputStream(), 1024, sha, () -> false, received -> {}));
        assertThrows(Exception.class, () -> UpdatePolicy.copyVerified(new ByteArrayInputStream(bytes), new ByteArrayOutputStream(), 2048, "a".repeat(64), () -> false, received -> {}));
    }
    @Test public void cancellingDoesNotProduceAValidatedDownload() throws Exception {
        byte[] bytes = new byte[65536]; String sha = UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(bytes)); AtomicBoolean cancelled = new AtomicBoolean(false);
        assertThrows(Exception.class, () -> UpdatePolicy.copyVerified(new ByteArrayInputStream(bytes), new ByteArrayOutputStream(), bytes.length, sha, cancelled::get, received -> cancelled.set(true)));
        assertThrows(Exception.class, () -> UpdatePolicy.copyVerified(new ByteArrayInputStream(bytes), new ByteArrayOutputStream(), bytes.length, sha, () -> true, received -> {}));
    }
}
