package cn.anxiu29.shike;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

/** Gitee 优先，GitHub 备用；只读公开发布，校验通过后仍由系统与用户确认安装。 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false), cancelled = new AtomicBoolean(false);
    private volatile HttpsURLConnection connection;
    private volatile Release checked, ready;
    private static class SourceUnavailable extends IOException { SourceUnavailable(String message) { super(message); } }
    private static class Release {
        final JSONObject manifest; final String apkUrl, releaseUrl, source;
        Release(JSONObject manifest, String apkUrl, String source) { this.manifest = manifest; this.apkUrl = apkUrl; this.source = source; this.releaseUrl = apkUrl.substring(0, apkUrl.lastIndexOf('/')).replace("/releases/download/", "/releases/tag/"); }
        JSObject json() throws Exception { return new JSObject().put("manifest", manifest).put("apkUrl", apkUrl).put("releaseUrl", releaseUrl).put("source", source); }
    }
    private String repository() { return getContext().getSharedPreferences("shike_updates", 0).getString("repository", "Anxiu29/shike"); }
    private String giteeRepository() {
        String value = getContext().getSharedPreferences("shike_updates", 0).getString("gitee_repository", repository().equalsIgnoreCase("Anxiu29/shike") ? "anxiu29/shike" : "");
        try { return value.isEmpty() ? "" : UpdatePolicy.repository(value, "gitee"); } catch (Exception error) { return ""; }
    }
    private File file(String name) throws IOException {
        File directory = new File(getContext().getCacheDir(), "apk-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建更新缓存，请检查设备空间。");
        return new File(directory, name);
    }
    @SuppressWarnings("deprecation") private long version(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation") private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    private PackageInfo installed() throws Exception { return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags()); }
    private JSObject info() throws Exception {
        PackageInfo app = installed();
        return new JSObject().put("appId", app.packageName).put("versionCode", version(app)).put("versionName", app.versionName)
            .put("repository", repository()).put("giteeRepository", giteeRepository()).put("sdk", Build.VERSION.SDK_INT)
            .put("readySource", ready == null ? "" : ready.source)
            .put("readyVersionCode", ready != null && file("shike-update.apk").isFile() ? ready.manifest.getLong("versionCode") : 0);
    }
    @PluginMethod public void getInfo(PluginCall call) { try { call.resolve(info()); } catch (Exception error) { call.reject("无法读取当前应用版本。"); } }
    @PluginMethod public void setRepository(PluginCall call) {
        if (busy.get()) { call.reject("请先完成或取消当前更新任务。"); return; }
        try {
            String value = UpdatePolicy.repository(call.getString("repository", ""));
            String gitee = call.getString("giteeRepository", "").trim();
            if (!gitee.isEmpty()) gitee = UpdatePolicy.repository(gitee, "gitee");
            getContext().getSharedPreferences("shike_updates", 0).edit().putString("repository", value).putString("gitee_repository", gitee).apply();
            checked = null; ready = null; file("shike-update.apk").delete(); call.resolve(info());
        } catch (Exception error) { call.reject(message(error, "更新仓库保存失败。")); }
    }
    private boolean begin(PluginCall call) { if (!busy.compareAndSet(false, true)) { call.reject("已有更新任务进行中。"); return false; } cancelled.set(false); return true; }
    @PluginMethod public void check(PluginCall call) {
        if (!begin(call)) return;
        final String github = repository(), gitee = giteeRepository();
        worker.execute(() -> {
            try {
                checked = null; Release first = null, result; String reason = "", notice = ""; boolean partial = false;
                if (!gitee.isEmpty()) {
                    try { first = fetchRelease("gitee", gitee); } catch (SourceUnavailable error) { reason = error.getMessage(); }
                }
                if (first != null && first.manifest.getLong("versionCode") > version(installed())) result = first;
                else {
                    try {
                        Release backup = fetchRelease("github", github);
                        result = backup != null && (first == null || backup.manifest.getLong("versionCode") > first.manifest.getLong("versionCode")) ? backup : first;
                        if (result != null && result.source.equals("github") && !gitee.isEmpty()) notice = (reason.isEmpty() ? "Gitee暂无更高版本。" : reason) + " 已检查 GitHub 备用源。";
                        if (!reason.isEmpty() && backup == null) throw new SourceUnavailable(reason + " GitHub暂无可用发行版，尚无法确认更新。");
                    } catch (SourceUnavailable error) {
                        if (first == null) throw error;
                        result = first; partial = true; notice = "Gitee提供" + first.manifest.getString("versionName") + "；" + error.getMessage() + " 备用源未完成检查，暂不能确认没有新版本。";
                    }
                }
                checked = result;
                if (ready != null && (result == null || !ready.manifest.toString().equals(result.manifest.toString()))) ready = null;
                call.resolve(new JSObject().put("current", info()).put("status", result == null ? "no_release" : result.manifest.getLong("versionCode") > version(installed()) ? "available" : partial ? "partial" : "current").put("release", result == null ? JSONObject.NULL : result.json()).put("message", notice));
            } catch (Exception error) { call.reject(message(error, "更新文件无效或读取失败，请检查网络与发行版文件后重试。")); }
            finally { close(); busy.set(false); }
        });
    }
    private Release fetchRelease(String source, String repository) throws Exception {
        boolean gitee = source.equals("gitee");
        String listUrl = gitee ? "https://gitee.com/api/v5/repos/" + UpdatePolicy.repository(repository, source) + "/releases?page=1&per_page=10&direction=desc" : "https://api.github.com/repos/" + UpdatePolicy.repository(repository) + "/releases?per_page=10";
        JSONArray releases = new JSONArray(read(listUrl, 1024 * 1024, source));
        if (releases.length() > 10) throw new IllegalArgumentException("更新列表格式无效，已停止检查。");
        java.util.ArrayList<JSONObject> ordered = new java.util.ArrayList<>();
        for (int index = 0; index < releases.length(); index++) if (releases.optJSONObject(index) != null) ordered.add(releases.getJSONObject(index));
        if (gitee) ordered.sort((a, b) -> {
            int time = Long.compare(UpdatePolicy.releaseTimestamp(b.optString("created_at")), UpdatePolicy.releaseTimestamp(a.optString("created_at")));
            return time != 0 ? time : Long.compare(b.optLong("id", 0), a.optLong("id", 0));
        });
        for (JSONObject release : ordered) {
            if (release == null || release.optBoolean("draft", !gitee) || release.optString(gitee ? "created_at" : "published_at").isEmpty()) continue;
            JSONArray assets = release.optJSONArray("assets"); if (assets == null) continue;
            if (assets.length() > 100) throw new IllegalArgumentException("更新资源过多，已停止检查。");
            JSONObject apk = null, manifestAsset = null;
            for (int item = 0; item < assets.length(); item++) {
                JSONObject asset = assets.optJSONObject(item); if (asset == null) continue;
                if ("shike.apk".equals(asset.optString("name"))) apk = asset;
                if ("shike-update.json".equals(asset.optString("name"))) manifestAsset = asset;
            }
            if (apk == null || manifestAsset == null) continue;
            String apkUrl = UpdatePolicy.asset(apk.getString("browser_download_url"), repository, "shike.apk", source), manifestUrl = UpdatePolicy.asset(manifestAsset.getString("browser_download_url"), repository, "shike-update.json", source);
            if (!apkUrl.substring(0, apkUrl.lastIndexOf('/')).equals(manifestUrl.substring(0, manifestUrl.lastIndexOf('/')))) throw new IllegalArgumentException("更新文件来自不同发行版。");
            if (gitee && !java.net.URLDecoder.decode(apkUrl.substring(0, apkUrl.lastIndexOf('/')).substring(apkUrl.substring(0, apkUrl.lastIndexOf('/')).lastIndexOf('/') + 1), "UTF-8").equals(release.getString("tag_name"))) throw new IllegalArgumentException("更新文件标签不一致。");
            JSONObject manifest = new JSONObject(read(manifestUrl, 65536, source)); validateManifest(manifest);
            if (!gitee && integer(apk, "size") != manifest.getLong("bytes")) throw new IllegalArgumentException("安装包大小与更新说明不一致。");
            return new Release(manifest, apkUrl, source);
        }
        return null;
    }
    private void validateManifest(JSONObject value) throws Exception {
        if (value.length() != 9 || integer(value, "schemaVersion") != 1 || !getContext().getPackageName().equals(value.getString("appId"))) throw new IOException("更新说明格式或应用标识不匹配。");
        long code = integer(value, "versionCode"), size = integer(value, "bytes"), sdk = integer(value, "minSdk");
        String name = value.getString("versionName"), sha = value.getString("sha256"), date = value.getString("releasedAt");
        JSONArray notes = value.getJSONArray("notes");
        if (code < 1 || code > 2100000000 || size < 1024 || size > UpdatePolicy.MAX_BYTES || sdk < 24 || sdk > 100 || name.trim().isEmpty() || name.length() > 60 || !sha.matches("[a-f0-9]{64}") || !date.matches("\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?Z") || notes.length() < 1 || notes.length() > 12) throw new IOException("更新说明中的版本、大小或校验信息无效。");
        for (int index = 0; index < notes.length(); index++) if (!(notes.get(index) instanceof String) || notes.getString(index).trim().isEmpty() || notes.getString(index).length() > 200) throw new IOException("更新说明格式无效。");
    }
    private long integer(JSONObject value, String key) throws Exception { Object number = value.get(key); if (!(number instanceof Number) || !Double.isFinite(((Number) number).doubleValue()) || ((Number) number).doubleValue() != Math.floor(((Number) number).doubleValue())) throw new IOException("更新说明中的数字格式无效。"); return ((Number) number).longValue(); }
    private HttpsURLConnection open(String address, String source) throws Exception {
        String target = address;
        for (int redirects = 0; redirects <= 4; redirects++) {
            if (cancelled.get()) throw new IOException("下载已取消。");
            UpdatePolicy.redirect(target, source);
            HttpsURLConnection current = (HttpsURLConnection) new URL(target).openConnection(); connection = current;
            current.setInstanceFollowRedirects(false); current.setConnectTimeout(10000); current.setReadTimeout(15000); current.setUseCaches(false);
            current.setRequestProperty("User-Agent", "Shike-Updater"); current.setRequestProperty("Accept", new URL(target).getHost().equals("api.github.com") ? "application/vnd.github+json" : "application/octet-stream"); current.setRequestProperty("Accept-Encoding", "identity");
            int status;
            try { status = current.getResponseCode(); } catch (IOException error) { current.disconnect(); throw new SourceUnavailable((source.equals("gitee") ? "Gitee" : "GitHub") + "连接失败或超时。"); }
            if (status == 200) return current;
            if (status >= 300 && status < 400) { String location = current.getHeaderField("Location"); current.disconnect(); if (location == null) break; target = new URL(new URL(target), location).toString(); continue; }
            boolean exhausted = source.equals("github") && "0".equals(current.getHeaderField("X-RateLimit-Remaining"));
            current.disconnect();
            if (status == 404) throw new SourceUnavailable((source.equals("gitee") ? "Gitee" : "GitHub") + "仓库或更新文件不存在、尚未公开，请检查仓库与发行版设置。");
            if ((status == 403 || status == 429) && exhausted) throw new SourceUnavailable("GitHub公开接口请求额度已用完，请稍后重试；更新检查无需Token。");
            if (status == 403 || status == 429) throw new SourceUnavailable((source.equals("gitee") ? "Gitee" : "GitHub") + "暂时限制访问，请稍后重试并检查网络。");
            throw new SourceUnavailable((source.equals("gitee") ? "Gitee" : "GitHub") + "更新服务暂不可用（HTTP " + status + "）。");
        }
        throw new IOException("更新下载跳转次数过多，已停止。");
    }
    private String read(String url, int limit, String source) throws Exception {
        long started = android.os.SystemClock.elapsedRealtime();
        HttpsURLConnection current = open(url, source);
        try (InputStream input = current.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { if (cancelled.get()) throw new IOException("下载已取消。"); if (android.os.SystemClock.elapsedRealtime() - started > 30000) throw new SourceUnavailable("读取更新信息超时，请稍后重试。"); if (output.size() + count > limit) throw new IllegalArgumentException("更新信息过大，已停止读取。"); output.write(buffer, 0, count); }
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (java.net.SocketTimeoutException | java.net.SocketException error) { throw new SourceUnavailable("读取更新信息连接失败或超时。"); } finally { current.disconnect(); }
    }
    @PluginMethod public void download(PluginCall call) {
        final Release selected = checked;
        if (selected == null) { call.reject("请先检查更新。"); return; }
        if (!begin(call)) return;
        worker.execute(() -> {
            Release release = selected;
            File temporary = null;
            try {
                if (release.manifest.getLong("versionCode") <= version(installed())) throw new IOException("当前已是此版本或更高版本。");
                if (release.manifest.getInt("minSdk") > Build.VERSION.SDK_INT) throw new IOException("此更新不支持当前Android系统。");
                ready = null; temporary = file("pending.apk"); temporary.delete();
                HttpsURLConnection current;
                try { current = open(release.apkUrl, release.source); }
                catch (SourceUnavailable error) {
                    if (!release.source.equals("gitee") || cancelled.get()) throw error;
                    Release backup = fetchRelease("github", repository());
                    if (backup == null) throw new IOException("Gitee下载连接失败，GitHub备用源暂无对应安装包。");
                    UpdatePolicy.mirror(release.manifest.getLong("versionCode"), release.manifest.getString("versionName"), release.manifest.getLong("bytes"), release.manifest.getString("sha256"), backup.manifest.getLong("versionCode"), backup.manifest.getString("versionName"), backup.manifest.getLong("bytes"), backup.manifest.getString("sha256"));
                    release = backup; checked = backup; current = open(backup.apkUrl, backup.source);
                }
                long total = release.manifest.getLong("bytes"); final String downloadSource = release.source;
                long length = current.getContentLengthLong(); if (length >= 0 && length != total) throw new IOException("安装包下载大小与更新说明不一致。");
                long start = android.os.SystemClock.elapsedRealtime(); final long[] lastProgress = {0};
                try (InputStream input = current.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    UpdatePolicy.copyVerified(input, output, total, release.manifest.getString("sha256"), () -> cancelled.get() || android.os.SystemClock.elapsedRealtime() - start > 180000, received -> {
                        long now = android.os.SystemClock.elapsedRealtime(); if (now - lastProgress[0] > 150 || received == total) { lastProgress[0] = now; notifyListeners("downloadProgress", new JSObject().put("phase", "downloading").put("source", downloadSource).put("received", received).put("total", total).put("percent", Math.min(99, received * 100 / total))); }
                    }); output.getFD().sync();
                }
                if (cancelled.get()) throw new IOException("下载已取消。");
                notifyListeners("downloadProgress", new JSObject().put("phase", "verifying").put("received", total).put("total", total).put("percent", 99));
                verifyArchive(temporary, release);
                if (cancelled.get()) throw new IOException("下载已取消。");
                File destination = file("shike-update.apk"); if (destination.exists() && !destination.delete()) throw new IOException("无法替换更新缓存。");
                if (!temporary.renameTo(destination)) throw new IOException("无法保存安装包，请检查设备空间。");
                ready = release; call.resolve(info());
            } catch (Exception error) { call.reject(cancelled.get() ? "下载已取消。" : message(error, "更新下载失败，请检查网络或设备空间后重试。")); }
            finally { if (temporary != null) temporary.delete(); close(); busy.set(false); }
        });
    }
    @SuppressWarnings("deprecation") private String[] signers(PackageInfo info) throws Exception {
        Signature[] values = Build.VERSION.SDK_INT >= 28 ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (values == null) return new String[0]; String[] result = new String[values.length];
        for (int index = 0; index < values.length; index++) result[index] = UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(values[index].toByteArray())); return result;
    }
    private void verifyArchive(File apk, Release release) throws Exception {
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), signatureFlags());
        if (archive == null || archive.applicationInfo == null) throw new IOException("文件不是有效Android安装包。");
        PackageInfo app = installed();
        UpdatePolicy.archive(app.packageName, archive.packageName, version(app), release.manifest.getLong("versionCode"), version(archive), release.manifest.getString("versionName"), archive.versionName, release.manifest.getInt("minSdk"), archive.applicationInfo.minSdkVersion, Build.VERSION.SDK_INT, signers(app), signers(archive));
    }
    @PluginMethod public void cancelDownload(PluginCall call) { cancelled.set(true); close(); call.resolve(); }
    @PluginMethod public void install(PluginCall call) {
        final Release release = ready;
        if (release == null || busy.get()) { call.reject("请先下载并校验更新包。"); return; }
        if (!begin(call)) return;
        worker.execute(() -> {
            try {
                File apk = file("shike-update.apk");
                try (InputStream input = new FileInputStream(apk)) { UpdatePolicy.copyVerified(input, new OutputStream() { public void write(int value) {} public void write(byte[] values, int offset, int length) {} }, release.manifest.getLong("bytes"), release.manifest.getString("sha256"), () -> false, received -> {}); }
                verifyArchive(apk, release);
                getActivity().runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                            call.resolve(new JSObject().put("status", "permission_required")); return;
                        }
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updates", apk);
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.setClipData(ClipData.newRawUri("食刻更新", uri));
                        getActivity().startActivity(intent); call.resolve(new JSObject().put("status", "installer_opened"));
                    } catch (Exception error) { call.reject("无法打开系统安装界面，请检查设备安装设置。"); }
                    finally { busy.set(false); }
                });
            } catch (Exception error) { busy.set(false); ready = null; call.reject(message(error, "安装包校验失败，请重新下载。")); }
        });
    }
    private void close() { HttpsURLConnection current = connection; connection = null; if (current != null) current.disconnect(); }
    private String message(Exception error, String fallback) { String value = error.getMessage(); return (error instanceof IOException || error instanceof IllegalArgumentException) && value != null && value.matches("[\\s\\S]*[\\u4e00-\\u9fff][\\s\\S]*") && value.length() < 150 ? value : fallback; }
    @Override protected void handleOnDestroy() { cancelled.set(true); close(); worker.shutdownNow(); }
}
