package cn.anxiu29.shike;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.google.ai.edge.litertlm.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/**
 * 离线模型的 Capacitor 入口：页面发命令并轮询状态，耗时的下载、校验、加载和推理由 worker 串行执行。
 * downloadModel/loadModel/generate 的 resolve 仅确认任务被接受；最终结果要看 stage/error。
 * prepareAssistant/describeMeal 则等任务结束才 resolve，供正式记餐流程等待。
 * 模型输出仍是待共享层校验的草稿，本类不写饮食记录，也不自动回退到收费 API。
 */
@CapacitorPlugin(name = "OfflineAi")
public class OfflineAiPlugin extends Plugin {
    // 文字与视觉插件各有 worker，但共享原生运行时配额；此锁保护跨插件的引擎所有权。
    private static final Object RUNTIME_LOCK = new Object();
    private static OfflineAiPlugin runtimeOwner;
    protected OfflineModelSpec spec() { return OfflineModelSpec.TEXT; }
    protected final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    // busy 拒绝重入，避免两个页面命令同时修改同一模型文件或原生会话。
    // volatile 字段用于跨线程发布状态；output 等相关快照还由 lock 一起读写。
    private final AtomicBoolean busy = new AtomicBoolean();
    protected final AtomicBoolean cancelled = new AtomicBoolean();
    private final Object lock = new Object();
    // JNI取消/关闭可能等待原生线程，不能持有文字回调也需要的状态锁。
    private final Object conversationLock = new Object();
    private volatile Engine engine;
    private volatile Conversation conversation;
    private volatile HttpURLConnection connection;
    private volatile ScheduledFuture<?> idleRelease;
    private volatile boolean background;
    protected volatile String stage = "idle", error = "";
    protected volatile String stopReason = "";
    protected volatile int maxOutputTokens;
    protected String taskName() { return ""; }
    protected RepetitionPenaltyConfig repetitionPenalty() { return null; }
    protected String outputIssue(String text) { return ""; }
    private volatile String output = "", backend = "";
    private volatile long progress, loadMs = -1, firstTextMs = -1, responseMs = -1, started;

    private File directory() { File dir = new File(getContext().getNoBackupFilesDir(), spec().directory); dir.mkdirs(); return dir; }
    private File model() { return new File(directory(), spec().file); }
    private File partial() { return new File(directory(), "model.part"); }
    // ready 是廉价的存在/长度检查；完整 SHA-256 在下载或导入提交前执行，轮询时不重复扫描 GB 文件。
    private boolean ready() { return model().isFile() && model().length() == spec().bytes; }
    private boolean allowed(PluginCall call) {
        if (getBridge().getServerUrl() != null) { call.reject("离线 AI 测试仅支持内置页面的独立 APK。"); return false; }
        if (Build.VERSION.SDK_INT < 26) { call.reject("离线 AI 测试需要 Android 8.0 或更新系统。"); return false; }
        if (!Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a")) { call.reject("此测试模型需要 64 位 ARM 安卓手机。"); return false; }
        return true;
    }
    /** 在桥接入口抢占本插件任务槽，取消空闲释放并清理上次错误；抢占失败不改变正在执行的任务。 */
    protected boolean begin(PluginCall call, String next) {
        if (!allowed(call)) return false;
        if (!busy.compareAndSet(false, true)) { call.reject("已有离线模型操作，请等待完成或先停止。"); return false; }
        ScheduledFuture<?> idle = idleRelease; if (idle != null) idle.cancel(false);
        cancelled.set(false); error = ""; stopReason = ""; stage = next; progress = 0;
        return true;
    }
    @PluginMethod public void getState(PluginCall call) {
        if (!allowed(call)) return;
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        ((ActivityManager)getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        Engine snapshot = engine;
        synchronized (lock) {
            call.resolve(new JSObject().put("stage", stage).put("busy", busy.get()).put("ready", ready())
                .put("loaded", snapshot != null && snapshot.isInitialized()).put("backend", backend)
                .put("bytes", spec().bytes).put("downloadedBytes", partial().length()).put("progressBytes", progress)
                .put("error", error).put("stopReason", stopReason).put("task", taskName()).put("maxOutputTokens", maxOutputTokens).put("text", output).put("loadMs", loadMs).put("firstTextMs", firstTextMs)
                .put("responseMs", stage.equals("generating") ? SystemClock.elapsedRealtime() - started : responseMs)
                .put("characters", output.codePointCount(0, output.length()))
                .put("availableMemoryBytes", memory.availMem).put("totalMemoryBytes", memory.totalMem)
                .put("device", Build.MANUFACTURER + " " + Build.MODEL));
        }
    }
    @PluginMethod public void downloadModel(PluginCall call) {
        if (!begin(call, "downloading")) return;
        call.resolve();
        worker.execute(() -> {
            try {
                closeEngine();
                if (!ready()) {
                    File part = partial();
                    if (part.length() > spec().bytes) Files.delete(part.toPath());
                    long offset = part.length(); progress = offset;
                    checkSpace(spec().bytes - offset);
                    if (offset < spec().bytes) {
                        connection = openDownload(offset);
                        try (InputStream in = connection.getInputStream(); OutputStream out = new BufferedOutputStream(new FileOutputStream(part, offset > 0))) {
                            OfflineModelPolicy.copy(in, out, offset, spec().bytes, cancelled::get, value -> progress = value);
                        } finally { connection.disconnect(); connection = null; }
                    }
                    verifyAndCommit(part);
                }
                stage = "ready";
            } catch (Exception | LinkageError cause) { fail(cause, "下载失败，请检查网络；可继续下载，或从文件导入指定模型。"); }
            finally { HttpURLConnection request = connection; connection = null; if (request != null) request.disconnect(); busy.set(false); }
        });
    }
    /**
     * 手动处理有限次跳转，每跳重验下载域名；续传必须得到精确的 Content-Range。
     * 不能把服务器忽略 Range 后返回的完整文件追加到旧片段，否则会生成损坏文件。
     * connection 保留给取消/销毁入口断开；正常路径由下载任务 finally 释放。
     */
    private HttpURLConnection openDownload(long offset) throws Exception {
        URL url = new URL(spec().url);
        for (int redirects = 0; redirects < 6; redirects++) {
            if (cancelled.get()) throw new InterruptedIOException("已停止下载。");
            if (!OfflineModelPolicy.allowedDownload(url)) throw new IOException("下载来源不受支持。");
            HttpURLConnection request = (HttpURLConnection) url.openConnection(); connection = request;
            request.setConnectTimeout(20_000); request.setReadTimeout(20_000); request.setInstanceFollowRedirects(false);
            request.setRequestProperty("Accept-Encoding", "identity");
            if (offset > 0) request.setRequestProperty("Range", "bytes=" + offset + "-");
            int code = request.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = request.getHeaderField("Location"); request.disconnect();
                if (location == null) throw new IOException("下载跳转缺少地址。");
                url = new URL(url, location); continue;
            }
            if (offset > 0 && (code != 206 || !Objects.equals(request.getHeaderField("Content-Range"), "bytes " + offset + "-" + (spec().bytes - 1) + "/" + spec().bytes))) {
                request.disconnect(); throw new IOException("下载源不支持此次续传，请删除下载后重试，或使用文件导入。");
            }
            if (offset == 0 && code != 200) { request.disconnect(); throw new IOException("下载源暂不可用（HTTP " + code + "），可使用文件导入。"); }
            long length = request.getContentLengthLong();
            if (length >= 0 && length != spec().bytes - offset) { request.disconnect(); throw new IOException("下载文件大小不符。"); }
            return request;
        }
        throw new IOException("下载跳转次数过多。");
    }
    private void checkSpace(long needed) throws IOException {
        if (directory().getUsableSpace() < needed + 128L * 1024 * 1024) throw new IOException("手机剩余空间不足，请清理空间后再试。");
    }
    /** 临时文件校验通过且未取消，才替换正式模型；失败片段不会被 ready() 当成可用模型。 */
    private void verifyAndCommit(File file) throws Exception {
        stage = "verifying"; progress = 0;
        OfflineModelPolicy.verify(file, spec().bytes, spec().sha256, cancelled::get, value -> progress = value);
        if (cancelled.get()) throw new InterruptedIOException("已停止。");
        Files.move(file.toPath(), model().toPath(), StandardCopyOption.REPLACE_EXISTING);
    }
    @PluginMethod public void importModel(PluginCall call) {
        if (!allowed(call)) return;
        if (busy.get()) { call.reject("请等待当前离线操作完成。"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, intent, "modelSelected");
    }
    @ActivityCallback private void modelSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.resolve(); return; }
        if (!begin(call, "importing")) return;
        android.net.Uri uri = result.getData().getData(); call.resolve();
        worker.execute(() -> {
            File incoming = new File(directory(), "model.import");
            try {
                closeEngine(); checkSpace(spec().bytes);
                try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new BufferedOutputStream(new FileOutputStream(incoming))) {
                    if (in == null) throw new IOException("无法读取所选文件。");
                    OfflineModelPolicy.copy(in, out, 0, spec().bytes, cancelled::get, value -> progress = value);
                }
                verifyAndCommit(incoming); stage = "ready";
            } catch (Exception | LinkageError cause) { fail(cause, "导入失败，请选择下载链接对应的完整 .litertlm 文件。"); }
            finally { incoming.delete(); busy.set(false); }
        });
    }
    @PluginMethod public void loadModel(PluginCall call) {
        if (spec().vision) { call.reject("图像测试会在开始时自动加载CPU模型。"); return; }
        String chosen = call.getString("backend", "gpu");
        if (!chosen.equals("cpu") && !chosen.equals("gpu")) { call.reject("请选择 CPU 或 GPU。"); return; }
        if (!begin(call, "loading")) return;
        call.resolve();
        worker.execute(() -> {
            try {
                ensureEngine(chosen, false); stage = "loaded";
            } catch (Exception | LinkageError cause) {
                fail(cause, "加载失败。GPU 不兼容时可手动切换 CPU 再试；也请检查可用内存。");
            } finally { finishTask(); }
        });
    }
    /** 只有手动准备才加载引擎；发送复用已准备的同后端引擎。 */
    @PluginMethod public void prepareAssistant(PluginCall call) {
        if (spec().vision) { call.reject("此图像模型仅用于独立识图测试。"); return; }
        String chosen = call.getString("backend", "gpu");
        if (!chosen.equals("cpu") && !chosen.equals("gpu")) { call.reject("请选择 CPU 或 GPU。"); return; }
        if (!begin(call, "loading")) return;
        worker.execute(() -> {
            try { ensureEngine(chosen, true); stage = "loaded"; finishTask(); call.resolve(); }
            catch (Exception | LinkageError cause) { fail(cause, "本机模型加载失败，请手动切换 CPU 重试，或到设置检查模型。"); finishTask(); call.reject(error); }
        });
    }
    @PluginMethod public void describeMeal(PluginCall call) {
        if (spec().vision) { call.reject("此图像模型未接入正式记餐，请先验证识图效果。"); return; }
        String chosen = call.getString("backend", "gpu"), prompt = call.getString("prompt", ""), system = call.getString("system", "");
        JSObject schema = call.getObject("schema");
        if ((!chosen.equals("cpu") && !chosen.equals("gpu")) || prompt.isBlank() || prompt.length() > 2600 || system.isBlank() || system.length() > 1800 || schema == null || schema.toString().length() > 6000) { call.reject("离线记餐输入过长或格式无效，原草稿已保留。"); return; }
        if (!begin(call, "generating")) return;
        worker.execute(() -> {
            try {
                // JS预检查后仍可能退后台或空闲释放；原生再次检查，不能偷偷重新加载。
                Engine prepared = engine;
                if (prepared == null || !prepared.isInitialized() || !chosen.equals(backend)) throw new IOException("请先点击“准备模型”再发送；模型释放或切换运行方式后需重新手动准备。");
                String result = runInference(system, prompt, schema.toString(), 768);
                if (cancelled.get()) throw new InterruptedIOException("本机记餐已停止，原草稿已保留。");
                // 完整字段/日期/数量等业务校验仍由shared执行，不把JSON语法正确当成内容正确。
                new org.json.JSONObject(result);
                stage = "completed";
                JSObject response = new JSObject().put("model", "Qwen2.5-1.5B-Q8").put("text", result).put("backend", backend);
                finishTask(); call.resolve(response);
            } catch (Exception | LinkageError cause) { fail(cause, "本机模型未返回完整的记餐JSON，原草稿已保留；可缩短描述后重试。"); finishTask(); call.reject(error); }
        });
    }
    /**
     * 仅在 worker 调用。跨插件切换前先借用对方 busy 槽，确保不会关闭正在推理的引擎。
     * initialize 返回前不发布 next；加载期间退后台/取消也会关闭刚建好的引擎。
     * reuse 只允许同后端的已准备引擎；视觉任务传 false，每个独立对话重新初始化。
     */
    protected void ensureEngine(String chosen, boolean reuse) throws Exception {
      synchronized (RUNTIME_LOCK) {
        if (spec().vision && !chosen.equals("cpu")) throw new IOException("此视觉模型本轮仅允许CPU文字与图像计算。");
        if (background || cancelled.get()) throw new InterruptedIOException("本机模型操作已停止。");
        Engine old = engine;
        if (reuse && old != null && old.isInitialized() && chosen.equals(backend)) return;
        if (runtimeOwner != null && runtimeOwner != this) {
            OfflineAiPlugin previous = runtimeOwner;
            if (!previous.busy.compareAndSet(false, true)) throw new IOException("另一个本机模型正在操作，请停止或等待完成后重试。");
            try { previous.closeEngine(); previous.stage = previous.ready() ? "ready" : "idle"; }
            finally { previous.busy.set(false); }
        }
        closeEngine();
        if (!ready()) throw new IOException("请先到设置 → 手机离线 AI 下载或导入模型。");
        synchronized (lock) { loadMs = -1; firstTextMs = -1; responseMs = -1; output = ""; }
        stage = "loading";
        long start = SystemClock.elapsedRealtime();
        Backend target = chosen.equals("gpu") ? new Backend.GPU() : new Backend.CPU(4, null);
        Engine next = new Engine(new EngineConfig(model().getAbsolutePath(), target, spec().vision ? new Backend.CPU(4, null) : null, null, 4096, spec().vision ? 1 : null, directory().getAbsolutePath()));
        try {
            next.initialize(); loadMs = SystemClock.elapsedRealtime() - start;
            if (background || cancelled.get()) throw new InterruptedIOException("本机模型操作已停止，原草稿已保留。");
            engine = next; backend = chosen; runtimeOwner = this;
        } catch (Exception | LinkageError cause) { if (next.isInitialized()) next.close(); throw cause; }
      }
    }
    @PluginMethod public void generate(PluginCall call) {
        if (spec().vision) { call.reject("请先选择照片，再开始离线识图。"); return; }
        String prompt = call.getString("prompt", "").trim();
        if (prompt.isEmpty() || prompt.length() > 600) { call.reject("请输入 1～600 字的测试问题。"); return; }
        Engine snapshot = engine;
        if (snapshot == null || !snapshot.isInitialized()) { call.reject("请先加载模型。"); return; }
        if (!begin(call, "generating")) return;
        call.resolve();
        worker.execute(() -> {
            try {
                runInference("请用简体中文简短回答。这是食刻离线文字模型测试。无法确定时说明不确定，不编造食物营养数值。", prompt, null, 256);
                stage = cancelled.get() ? "stopped" : "completed";
            } catch (Exception | LinkageError cause) { fail(cause, "生成失败，请释放模型后重试。"); }
            finally { finishTask(); }
        });
    }
    private String runInference(String system, String prompt, String schema, int limit) throws Exception {
        return runContents(system, Contents.Companion.of(prompt), schema, limit);
    }
    /**
     * 把原生异步回调适配为 worker 上的同步任务；CountDownLatch 只阻塞 worker，不阻塞页面线程。
     * onMessage 由原生线程回调，必须用 lock 更新输出快照，不能假定与 worker 同线程。
     * conversationLock 单独保护取消/关闭，避免 JNI 等待回调时持有回调也需要的 lock。
     * schema 只约束输出结构，不能证明名称、估重或营养语义正确，结果仍需后续校验。
     */
    protected String runContents(String system, Contents contents, String schema, int limit) throws Exception {
        maxOutputTokens = limit;
        synchronized (lock) { output = ""; stopReason = ""; firstTextMs = -1; responseMs = -1; started = SystemClock.elapsedRealtime(); }
        stage = "generating";
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        try {
            ConversationConfig config = new ConversationConfig(Contents.Companion.of(system), Collections.emptyList(), Collections.emptyList(), new SamplerConfig(20, 0.8, 0.2, 0), false, null, Collections.emptyMap(), null, false, limit, null, schema != null);
            Conversation active = engine.createConversation(config);
            synchronized (conversationLock) { conversation = active; }
            active.sendMessageAsync(contents, new MessageCallback() {
                    @Override public void onMessage(Message message) {
                        String text = message.toString();
                        boolean stopOutput = false;
                        synchronized (lock) {
                            if (!text.isEmpty() && stopReason.isEmpty()) {
                                if (firstTextMs < 0) firstTextMs = SystemClock.elapsedRealtime() - started;
                                output += text;
                                stopReason = outputIssue(output);
                                stopOutput = !stopReason.isEmpty();
                            }
                        }
                        if (stopOutput) {
                            // 不能在原生输出回调内同步取消，避免等待自身回调造成死锁。
                            // 绑定本次Conversation，延迟任务不得取消下一次生成。
                            try { timer.execute(() -> { synchronized (conversationLock) { if (conversation == active) active.cancelProcess(); } }); }
                            catch (RejectedExecutionException ignored) { /* Activity销毁也会请求取消。 */ }
                        }
                    }
                    @Override public void onDone() { completed.countDown(); }
                    @Override public void onError(Throwable cause) { failure.set(cause); completed.countDown(); }
                }, Collections.emptyMap(), repetitionPenalty(), null, null, limit, null, schema == null ? null : ResponseFormat.json(schema));
                if (cancelled.get()) cancelGeneration();
                ScheduledFuture<?> timeout = timer.schedule(() -> { cancelled.set(true); cancelGeneration(); }, 120, TimeUnit.SECONDS);
                try { completed.await(); } finally { timeout.cancel(false); }
                responseMs = SystemClock.elapsedRealtime() - started;
                if (!cancelled.get() && stopReason.isEmpty() && failure.get() != null) throw new IOException("生成失败，请释放模型后重新加载；也可手动切换 CPU。");
                if (!cancelled.get() && output.isBlank()) throw new IOException("模型未返回可见文字，请换一个简短问题重试。");
                return output;
        } finally {
            synchronized (conversationLock) {
                Conversation old = conversation; conversation = null;
                if (old != null) old.close();
            }
        }
    }
    /** 释放任务槽；后台立即卸载，前台文字引擎保留五分钟供下一次手动发送复用。 */
    protected void finishTask() {
        try { if (background) closeEngine(); }
        finally {
            busy.set(false);
            if (engine != null && !background && !timer.isShutdown()) {
                idleRelease = timer.schedule(() -> {
                    if (!busy.compareAndSet(false, true)) return;
                    worker.execute(() -> { try { closeEngine(); stage = ready() ? "ready" : "idle"; } finally { busy.set(false); } });
                }, 5, TimeUnit.MINUTES);
            }
        }
    }
    private void cancelGeneration() { synchronized (conversationLock) { if (conversation != null) conversation.cancelProcess(); } }
    @PluginMethod public void cancel(PluginCall call) {
        if (!allowed(call)) return;
        cancelled.set(true); cancelGeneration();
        HttpURLConnection request = connection; if (request != null) request.disconnect();
        call.resolve();
    }
    @PluginMethod public void unload(PluginCall call) {
        if (!begin(call, "releasing")) return;
        call.resolve();
        worker.execute(() -> { try { closeEngine(); stage = ready() ? "ready" : "idle"; } finally { busy.set(false); } });
    }
    @PluginMethod public void deleteModel(PluginCall call) {
        if (!begin(call, "deleting")) return;
        call.resolve();
        worker.execute(() -> {
            try {
                closeEngine();
                Files.deleteIfExists(model().toPath()); Files.deleteIfExists(partial().toPath());
                synchronized (lock) { output = ""; loadMs = -1; firstTextMs = -1; responseMs = -1; }
                stage = "idle"; progress = 0;
            } catch (Exception cause) { fail(cause, "删除失败，请稍后重试。"); }
            finally { busy.set(false); }
        });
    }
    /** 所有引擎销毁集中于此；先清除可见引用，再释放 JNI 资源，跨插件所有权同步撤销。 */
    protected void closeEngine() {
      synchronized (RUNTIME_LOCK) {
        Engine old = engine; engine = null; backend = "";
        if (old != null && old.isInitialized()) old.close();
        if (runtimeOwner == this) runtimeOwner = null;
      }
    }
    protected void fail(Throwable cause, String fallback) {
        stage = cancelled.get() ? "stopped" : "error";
        error = cancelled.get() ? "已停止本机模型操作；已下载部分及原有记餐草稿会保留。" : cause instanceof IOException ? cause.getMessage() : fallback;
    }
    @Override protected void handleOnStart() { background = false; }
    /** Activity 暂停不等于销毁：文件选择器也会触发此处，所以导入仍可继续。 */
    @Override protected void handleOnStop() {
        background = true;
        // 文件选择器也会让Activity停止，不取消模型导入。正在生成则取消，随后释放引擎。
        if (stage.equals("generating") || stage.equals("loading")) cancelled.set(true);
        cancelGeneration();
        worker.execute(() -> { closeEngine(); if (!busy.get() && !stage.equals("error")) stage = ready() ? "ready" : "idle"; });
    }
    /** 先发取消与断连接，再将引擎释放排到串行队尾；shutdown 保留该清理任务。 */
    @Override protected void handleOnDestroy() {
        background = true;
        cancelled.set(true); cancelGeneration();
        HttpURLConnection request = connection; if (request != null) request.disconnect();
        ScheduledFuture<?> idle = idleRelease; if (idle != null) idle.cancel(false);
        worker.execute(this::closeEngine); worker.shutdown(); timer.shutdownNow();
    }
}
