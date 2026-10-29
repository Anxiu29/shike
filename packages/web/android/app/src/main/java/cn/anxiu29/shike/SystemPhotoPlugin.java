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

/** 仅委托系统相机，不声明/请求CAMERA权限，也不直接打开摄像头。 */
@CapacitorPlugin(name = "SystemPhoto")
public class SystemPhotoPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private static final int URI_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private File directory() { return new File(getContext().getCacheDir(), "system-photo"); }
    @Override public void load() {
        worker.execute(() -> {
            File[] files = directory().listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - 86400000L;
            for (File file : files) if (file.getName().startsWith("shike-photo-") && file.getName().endsWith(".jpg") && file.lastModified() < cutoff) file.delete();
        });
    }
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
