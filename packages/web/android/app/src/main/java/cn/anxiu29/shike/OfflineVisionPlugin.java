package cn.anxiu29.shike;

import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ai.edge.litertlm.*;
import java.io.InterruptedIOException;

/** CPU视觉任务：模型只生成待核对草稿，保存由界面确认，不自动转在线。 */
@CapacitorPlugin(name = "OfflineVision")
public class OfflineVisionPlugin extends OfflineAiPlugin {
    private volatile String activeTask = "test";
    @Override protected String taskName() { return activeTask; }
    @Override protected OfflineModelSpec spec() { return OfflineModelSpec.VISION; }
    @Override protected RepetitionPenaltyConfig repetitionPenalty() { return OfflineVisionTasks.structured(activeTask) ? null : new RepetitionPenaltyConfig(1.15f, 0.0f, 0.15f, 128); }
    @Override protected String outputIssue(String text) { return OfflineVisionTasks.outputIssue(activeTask, text); }
    /**
     * 先限制编码长度，再只解码图片边界验证 JPEG/尺寸，避免直接分配未受限的 Bitmap。
     * 输入通过后交给父类串行 worker；resolve 表示已接受，页面继续轮询 stage/stopReason。
     * 每次独立视觉会话都创建并关闭 CPU 引擎，finally 保证异常路径也归还原生资源。
     */
    @PluginMethod public void generateImage(PluginCall call) {
        boolean namesOnly = call.getBoolean("namesOnly", false);
        String task = call.getString("task", namesOnly ? "names" : "test");
        if (!OfflineVisionTasks.valid(task)) { call.reject("未知的本机识图任务。"); return; }
        String encoded = call.getString("imageBase64", ""), prompt = call.getString("prompt", "").trim();
        if (!OfflineVisionPolicy.validImageBase64(encoded) || prompt.isEmpty() || prompt.length() > 400) { call.reject("请选择压缩照片并输入1～400字问题。"); return; }
        byte[] jpeg;
        try {
            jpeg = Base64.decode(encoded, Base64.NO_WRAP);
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, bounds);
            if (jpeg.length > 1024 * 1024 || bounds.outWidth < 1 || bounds.outHeight < 1 || bounds.outWidth > 512 || bounds.outHeight > 512 || !"image/jpeg".equals(bounds.outMimeType)) throw new IllegalArgumentException();
        } catch (Exception invalid) { call.reject("图像格式无效，请重新选择照片。"); return; }
        if (!begin(call, "loading")) return;
        activeTask = task; maxOutputTokens = OfflineVisionTasks.limit(task);
        call.resolve();
        worker.execute(() -> {
            try {
                // 转换作者要求每个独立对话新建Engine，避免循环状态污染下一张照片。
                ensureEngine("cpu", false);
                runContents(OfflineVisionTasks.system(task), Contents.Companion.of(new Content.ImageBytes(jpeg), new Content.Text(prompt)), OfflineVisionTasks.schema(task), OfflineVisionTasks.limit(task));
                if (cancelled.get()) throw new InterruptedIOException("识图已停止。");
                if (stopReason.isEmpty()) stage = "completed";
                else { error = OfflineVisionPolicy.stopMessage(stopReason); stage = "limited"; }
            } catch (Exception | LinkageError cause) { fail(cause, "本机识图未完成，此模型在当前设备的兼容性仍需验证。"); }
            finally { try { closeEngine(); } finally { finishTask(); } }
        });
    }
}
