package cn.anxiu29.shike;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 委托系统相机写入本应用缓存中的临时 JPEG，不直接打开摄像头。
 * UI 线程负责启动外部 Activity；单线程 worker 负责大文件读取、编码与旧文件清理。
 * 页面只收到 base64，不收到可指定任意本地路径的接口；成功、取消、读取失败都会清理本次文件。
 */
@CapacitorPlugin(name = "SystemPhoto")
public class SystemPhotoPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private static final int URI_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private File directory() { return new File(getContext().getCacheDir(), "system-photo"); }
    /** 进程被系统杀死时未必收到结果回调；下次加载补清理超过一天的已命名临时文件。 */
    @Override public void load() {
        worker.execute(() -> {
            File[] files = directory().listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - 86400000L;
            for (File file : files) if (file.getName().startsWith("shike-photo-") && file.getName().endsWith(".jpg") && file.lastModified() < cutoff) file.delete();
        });
    }
    /**
     * 一次只保留一个拍照调用。FileProvider 为这一次 Intent 授予 URI 读写权限，
     * EXTRA_OUTPUT 指定本应用创建的缓存文件，不信任相机返回的任意 data URI。
     */
    @PluginMethod public void capture(PluginCall call) {
        if (getBridge().getServerUrl() != null) { call.reject("系统相机仅供内置页面使用，请安装独立APK。"); return; }
        if (!busy.compareAndSet(false, true)) { call.reject("系统相机正在处理中，请返回后再拍摄。"); return; }
        getActivity().runOnUiThread(() -> {
            File file = null;
            try {
                Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                if (intent.resolveActivity(getContext().getPackageManager()) == null) throw new Exception("没有找到系统相机，请选择已有照片。");
                File dir = directory();
                if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("无法准备拍照临时文件，请检查本机空间。");
                file = File.createTempFile("shike-photo-", ".jpg", dir);
                // 保存到Capacitor待处理调用中，支持Activity结果恢复，不接受网页指定输出路径。
                call.getData().put("_systemPhotoName", file.getName());
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                intent.addFlags(URI_FLAGS);
                intent.setClipData(ClipData.newRawUri("食刻拍照临时文件", uri));
                startActivityForResult(call, intent, "photoReturned");
            } catch (Exception error) {
                cleanup(file); busy.set(false);
                call.reject(error.getMessage() == null ? "系统相机暂时无法打开，请从相册选择。" : error.getMessage());
            }
        });
    }
    /**
     * 恢复调用后重新检查文件名与规范化父目录，不能仅凭保存到调用数据中的字符串访问文件。
     * JPEG 体积限制先于 base64 编码；这里只检查容器头，完整解码/压缩还由页面图片流程完成。
     * call 丢失时没有可信文件名，交给 load 的过期清理，不能猜测并删除其他会话的文件。
     */
    @ActivityCallback private void photoReturned(PluginCall call, ActivityResult result) {
        if (call == null) { busy.set(false); return; }
        worker.execute(() -> {
            File file = null;
            try {
                String name = call.getString("_systemPhotoName", "");
                if (!name.matches("shike-photo-[A-Za-z0-9_-]+\\.jpg")) throw new Exception("拍照会话已失效，请重试。");
                file = new File(directory(), name).getCanonicalFile();
                if (!file.getParentFile().equals(directory().getCanonicalFile())) throw new Exception("拍照会话已失效，请重试。");
                if (result.getResultCode() != Activity.RESULT_OK) { call.resolve(new JSObject().put("cancelled", true)); return; }
                try (FileInputStream source = new FileInputStream(file)) {
                    byte[] jpeg = SystemPhotoPolicy.readJpeg(source);
                    call.resolve(new JSObject().put("cancelled", false).put("jpegBase64", Base64.encodeToString(jpeg, Base64.NO_WRAP)));
                }
            } catch (Exception error) { call.reject(error.getMessage() == null ? "照片读取失败，请重新拍摄。" : error.getMessage()); }
            finally { cleanup(file); busy.set(false); }
        });
    }
    /** 撤销临时 URI 授权后删文件；撤权异常也不应阻止后续删除和 busy 释放。 */
    private void cleanup(File file) {
        if (file == null) return;
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            getContext().revokeUriPermission(uri, URI_FLAGS);
        } catch (Exception ignored) { }
        file.delete();
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
