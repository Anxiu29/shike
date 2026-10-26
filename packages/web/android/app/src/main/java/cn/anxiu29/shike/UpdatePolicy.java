package cn.anxiu29.shike;

import java.net.URI;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;

/** 更新规则独立于页面和网络响应；同包名、递增版本与本机签名必须同时匹配。 */
final class UpdatePolicy {
    static final long MAX_BYTES = 200L * 1024 * 1024;
    static long releaseTimestamp(String value) {
        for (String pattern : new String[] {"yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"}) {
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat(pattern, java.util.Locale.ROOT);
            format.setLenient(false); java.text.ParsePosition position = new java.text.ParsePosition(0);
            java.util.Date date = format.parse(value, position);
            if (date != null && position.getIndex() == value.length()) return date.getTime();
        }
        return 0;
    }
    static String repository(String value) {
        return repository(value, "github");
    }
    static String repository(String value, String source) {
        if (!source.equals("gitee") && !source.equals("github")) throw new IllegalArgumentException("更新来源无效。");
        String result = value.trim().replaceFirst("/$", "").replaceFirst("^https://" + source + "\\.com/", "").replaceFirst("\\.git$", "");
        String owner = source.equals("gitee") ? "[A-Za-z0-9][A-Za-z0-9_-]{0,99}" : "[A-Za-z0-9][A-Za-z0-9-]{0,38}";
        if (!result.matches(owner + "/[A-Za-z0-9_.-]{1,100}") || result.endsWith("/.") || result.endsWith("/..")) throw new IllegalArgumentException("请填写公开" + (source.equals("gitee") ? "Gitee" : "GitHub") + "仓库，格式为 用户名/仓库名。");
        return result;
    }
    static String asset(String value, String repository, String filename) throws Exception {
        return asset(value, repository, filename, "github");
    }
    static String asset(String value, String repository, String filename, String source) throws Exception {
        URI uri = new URI(value);
        String prefix = "/" + repository(repository, source) + "/releases/download/", raw = uri.getRawPath();
        if (!"https".equals(uri.getScheme()) || !(source + ".com").equals(uri.getHost()) || uri.getPort() != -1 || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getFragment() != null || raw == null || !raw.startsWith(prefix)) throw new IllegalArgumentException("更新资源地址与仓库不一致。");
        String rest = raw.substring(prefix.length()); String[] parts = rest.split("/", -1);
        if (parts.length != 2 || parts[0].isEmpty() || !parts[1].equals(filename) || parts[0].toLowerCase(java.util.Locale.ROOT).matches(".*%(?:2f|5c).*")) throw new IllegalArgumentException("更新资源路径无效。");
        String tag = java.net.URLDecoder.decode(parts[0], "UTF-8");
        if (tag.equals(".") || tag.equals("..")) throw new IllegalArgumentException("更新资源路径无效。");
        return uri.toASCIIString();
    }
    static void redirect(String value) throws Exception {
        redirect(value, "github");
    }
    static void redirect(String value, String source) throws Exception {
        URI uri = new URI(value); String host = uri.getHost();
        boolean allowed = source.equals("gitee") ? ("gitee.com".equals(host) || "foruda.gitee.com".equals(host)) : source.equals("github") && ("github.com".equals(host) || "api.github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host));
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null || !allowed) throw new IllegalArgumentException("更新下载跳转到不受支持的地址，已停止。");
    }
    static void mirror(long code, String name, long bytes, String sha, long otherCode, String otherName, long otherBytes, String otherSha) {
        if (code != otherCode || !name.equals(otherName) || bytes != otherBytes || !sha.equals(otherSha)) throw new IllegalArgumentException("备用源安装包与已检查版本不一致，已停止下载。");
    }
    static void archive(String expectedId, String archiveId, long current, long expected, long actual, String expectedName, String actualName, int manifestMinSdk, int archiveMinSdk, int deviceSdk, String[] installedSigners, String[] archiveSigners) {
        if (!expectedId.equals(archiveId)) throw new IllegalArgumentException("安装包不是食刻，已停止安装。");
        if (expected <= current || actual != expected || !expectedName.equals(actualName)) throw new IllegalArgumentException("安装包版本不匹配或不是更新版本。");
        if (manifestMinSdk != archiveMinSdk || archiveMinSdk > deviceSdk) throw new IllegalArgumentException("此版本不支持当前Android系统。");
        if (installedSigners.length == 0 || archiveSigners.length == 0 || !new HashSet<>(Arrays.asList(installedSigners)).equals(new HashSet<>(Arrays.asList(archiveSigners)))) throw new IllegalArgumentException("安装包签名与当前食刻不一致，已停止安装。");
    }
    static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(); for (byte item : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff)); return value.toString(); }
    static void copyVerified(InputStream input, OutputStream output, long expectedBytes, String sha256, BooleanSupplier cancelled, LongConsumer progress) throws Exception {
        if (expectedBytes < 1024 || expectedBytes > MAX_BYTES || !sha256.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("更新文件信息无效。");
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] buffer = new byte[32768]; long received = 0; int count;
        while ((count = input.read(buffer)) != -1) {
            if (cancelled.getAsBoolean()) throw new IOException("下载已取消。");
            received += count;
            if (received > expectedBytes) throw new IOException("安装包大小与更新说明不一致。");
            digest.update(buffer, 0, count); output.write(buffer, 0, count); progress.accept(received);
        }
        if (cancelled.getAsBoolean()) throw new IOException("下载已取消。");
        if (received != expectedBytes || !hex(digest.digest()).equals(sha256)) throw new IOException("安装包校验失败，请重新检查更新后下载。");
    }
}
