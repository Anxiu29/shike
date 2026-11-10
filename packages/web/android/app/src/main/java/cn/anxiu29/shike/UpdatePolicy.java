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

/**
 * 更新规则独立于页面和 Android 网络实现，便于用 JVM 测试不可信输入。
 * 信任分层：仓库/跳转地址限制来源；长度与 SHA-256 检查下载内容；archive 再核对真实 APK 元数据。
 * 更新 JSON 不能替代 APK 签名检查，同包名、递增版本与本机签名必须同时匹配。
 */
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
    /** 只接受本仓库、单层发行标签、固定附件名；检查 rawPath，避免编码的斜杠改变路径层级。 */
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
    /** 附件可跳转到受支持 CDN；每一跳都重新检查协议/主机，不能只验证最初的发行链接。 */
    static void redirect(String value, String source) throws Exception {
        URI uri = new URI(value); String host = uri.getHost();
        boolean allowed = source.equals("gitee") ? ("gitee.com".equals(host) || "foruda.gitee.com".equals(host)) : source.equals("github") && ("github.com".equals(host) || "api.github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host));
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null || !allowed) throw new IllegalArgumentException("更新下载跳转到不受支持的地址，已停止。");
    }
    static void mirror(long code, String name, long bytes, String sha, long otherCode, String otherName, long otherBytes, String otherSha) {
        if (code != otherCode || !name.equals(otherName) || bytes != otherBytes || !sha.equals(otherSha)) throw new IllegalArgumentException("备用源安装包与已检查版本不一致，已停止下载。");
    }
    /** expected 来自已检查的发布，actual 来自 PackageManager 读取的 APK；签名按集合比较而非数组顺序。 */
    static void archive(String expectedId, String archiveId, long current, long expected, long actual, String expectedName, String actualName, int manifestMinSdk, int archiveMinSdk, int deviceSdk, String[] installedSigners, String[] archiveSigners) {
        if (!expectedId.equals(archiveId)) throw new IllegalArgumentException("安装包不是食刻，已停止安装。");
        if (expected <= current || actual != expected || !expectedName.equals(actualName)) throw new IllegalArgumentException("安装包版本不匹配或不是更新版本。");
        if (manifestMinSdk != archiveMinSdk || archiveMinSdk > deviceSdk) throw new IllegalArgumentException("此版本不支持当前Android系统。");
        if (installedSigners.length == 0 || archiveSigners.length == 0 || !new HashSet<>(Arrays.asList(installedSigners)).equals(new HashSet<>(Arrays.asList(archiveSigners)))) throw new IllegalArgumentException("安装包签名与当前食刻不一致，已停止安装。");
    }
    static String hex(byte[] bytes) { StringBuilder value = new StringBuilder(); for (byte item : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff)); return value.toString(); }
    /**
     * 流式下载并校验；返回意味着长度与哈希都匹配，不意味着 APK 身份已经通过 archive 检查。
     * 输出可能包含尚未验证的数据，因此调用方必须先写临时文件，只在全部检查通过后发布。
     * cancelled 也可合并总时限；调用方同时断开连接，才能尽快打断正在进行的阻塞 read。
     */
    static void copyVerified(InputStream input, OutputStream output, long expectedBytes, String sha256, BooleanSupplier cancelled, LongConsumer progress) throws Exception {
        if (expectedBytes < 1024 || expectedBytes > MAX_BYTES || !sha256.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("更新文件信息无效。");
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] buffer = new byte[32768]; long received = 0; int count;
        while (true) {
            // 已取消时不再启动下一次可能阻塞的读取；读取期间取消则由下面的检查拦住写入。
            if (cancelled.getAsBoolean()) throw new IOException("下载已取消。");
            count = input.read(buffer);
            if (cancelled.getAsBoolean()) throw new IOException("下载已取消。");
            if (count == -1) break;
            received += count;
            if (received > expectedBytes) throw new IOException("安装包大小与更新说明不一致。");
            digest.update(buffer, 0, count); output.write(buffer, 0, count); progress.accept(received);
        }
        if (cancelled.getAsBoolean()) throw new IOException("下载已取消。");
        if (received != expectedBytes || !hex(digest.digest()).equals(sha256)) throw new IOException("安装包校验失败，请重新检查更新后下载。");
    }
}
