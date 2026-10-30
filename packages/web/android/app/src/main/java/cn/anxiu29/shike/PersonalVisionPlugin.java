package cn.anxiu29.shike;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.graphics.Bitmap;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.Iterator;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/**
 * 个人 BYOK：Key 只在输入时跨桥一次，之后不提供读出接口。
 * 整个配置库用 AES-GCM 加密，AES 密钥留在 Android Keystore。
 * 网络、限频与存储放在工作线程；既不记录请求，也不持久化照片或响应。
 */
@CapacitorPlugin(name = "PersonalVision")
public class PersonalVisionPlugin extends Plugin {
    private static final String ALIAS = "shike.personal-vision.v1";
    private static final byte[] AAD = ALIAS.getBytes(StandardCharsets.UTF_8);
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final ArrayDeque<Long> attempts = new ArrayDeque<>();

    private interface Action { JSObject run() throws Exception; }
    private static class SafeFailure extends Exception { SafeFailure(String message) { super(message); } }

    /**
     * 所有配置与请求操作共用串行入口，避免“读取旧配置 → 并行修改 → 覆盖新配置”的竞态。
     * busy 在排队前抢占，因此等待中的网络任务也会拒绝重入；finally 清除桥接参数中的明文 Key。
     * 只有 SafeFailure/受控参数错误可回传具体提示，其他异常使用固定文案，避免泄露内部配置。
     */
    private void run(PluginCall call, Action action) {
        // 不允许局域网预览页面访问手机上保存的 Key。
        if (getBridge().getServerUrl() != null) { call.reject("自配 Key 仅在内置页面的独立 APK 中开放。"); return; }
        if (!busy.compareAndSet(false, true)) { call.reject("另一个模型操作正在进行，请等待完成。"); return; }
        worker.execute(() -> {
            try { call.resolve(action.run()); }
            catch (SafeFailure | IllegalArgumentException error) { call.reject(error.getMessage()); }
            catch (Exception error) { call.reject("无法读取或保存加密配置，请重试；仍失败可清空模型配置后重新添加。饮食记录不受影响。"); }
            finally { call.getData().remove("apiKey"); busy.set(false); }
        });
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences("personal-vision", Context.MODE_PRIVATE); }
    private SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    /** 解密后只在工作线程持有配置；迁移仅处理已明确移除的型号，不能静默发送新的模型请求。 */
    private JSONObject read() throws Exception {
        String saved = prefs().getString("sealed-v1", null);
        if (saved == null) return new JSONObject().put("profiles", new JSONArray()).put("activeId", JSONObject.NULL);
        JSONObject sealed = new JSONObject(saved);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.decode(sealed.getString("iv"), Base64.NO_WRAP)));
        cipher.updateAAD(AAD);
        JSONObject state = new JSONObject(new String(cipher.doFinal(Base64.decode(sealed.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
        boolean changed = false; JSONArray profiles = state.getJSONArray("profiles");
        for (int i = 0; i < profiles.length(); i++) {
            JSONObject p = profiles.getJSONObject(i); JSONArray array = p.optJSONArray("models"); List<String> requested = null;
            if (array != null) { requested = new ArrayList<>(); for (int j = 0; j < array.length(); j++) requested.add(array.getString(j)); }
            List<String> migrated = VisionPolicy.migratedModels(p.getString("provider"), p.getString("model"), requested);
            if (migrated == null) continue;
            if (!migrated.contains(p.getString("model"))) {
                p.put("model", migrated.get(0));
                if (p.getString("id").equals(state.optString("activeId"))) state.put("activeId", JSONObject.NULL);
            }
            p.put("models", new JSONArray(migrated)); changed = true;
        }
        if (changed) write(state);
        return state;
    }
    /** 每次加密由 Cipher 生成新 IV；AAD 绑定本配置用途，commit 成功后才向页面报告保存成功。 */
    private void write(JSONObject state) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, encryptionKey()); cipher.updateAAD(AAD);
        JSONObject sealed = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(state.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!prefs().edit().putString("sealed-v1", sealed.toString()).commit()) throw new SafeFailure("加密配置保存失败，原配置仍保留。");
    }
    private JSONObject profile(JSONObject state, String id) throws Exception {
        JSONArray profiles = state.getJSONArray("profiles");
        for (int i = 0; i < profiles.length(); i++) if (profiles.getJSONObject(i).getString("id").equals(id)) return profiles.getJSONObject(i);
        throw new SafeFailure("尚未选择模型配置，请到设置添加并选用一组配置。");
    }
    /** 将旧单型号配置和新多型号配置统一成经过白名单检查的列表。 */
    private List<String> profileModels(JSONObject profile) throws Exception {
        JSONArray array = profile.optJSONArray("models"); List<String> requested = null;
        if (array != null) { requested = new ArrayList<>(); for (int i = 0; i < array.length(); i++) requested.add(array.getString(i)); }
        return VisionPolicy.models(profile.getString("provider"), profile.getString("model"), requested);
    }
    /** 固定本次请求的模型快照，切换同组默认模型不改变已开始的请求。 */
    private JSONObject requestProfile(JSONObject state, PluginCall call) throws Exception {
        JSONObject original = profile(state, call.getString("id", "")); String selected = call.getString("model", original.getString("model"));
        if (!profileModels(original).contains(selected)) throw new SafeFailure("此模型未加入这组 Key，请先在设置勾选。");
        return new JSONObject(original.toString()).put("model", selected);
    }
    /** 仅投影可公开元数据；内部 profile 含 apiKey，不能将原对象直接 resolve 给页面。 */
    private JSObject publicState(JSONObject state) throws Exception {
        JSONArray profiles = state.getJSONArray("profiles"), safe = new JSONArray();
        for (int i = 0; i < profiles.length(); i++) {
            JSONObject p = profiles.getJSONObject(i);
            safe.put(new JSONObject().put("id", p.getString("id")).put("label", p.getString("label"))
                .put("provider", p.getString("provider")).put("model", p.getString("model")).put("models", new JSONArray(profileModels(p))));
        }
        JSObject output = new JSObject(); output.put("profiles", safe); output.put("activeId", state.opt("activeId")); return output;
    }

    @PluginMethod public void getState(PluginCall call) { run(call, () -> publicState(read())); }
    @PluginMethod public void saveProfile(PluginCall call) {
        run(call, () -> {
            JSONObject state = read(); JSONArray list = state.getJSONArray("profiles");
            String id = call.getString("id", ""), provider = call.getString("provider", ""), model = call.getString("model", "");
            String label = call.getString("label", "").trim(), key = call.getString("apiKey", "").trim();
            VisionPolicy.endpoint(provider, model);
            JSONArray requested = call.getArray("models");
            if (call.getData().has("models") && requested == null) throw new SafeFailure("模型列表无效，请重新选择。");
            List<String> selected = null;
            if (requested != null) { selected = new ArrayList<>(); for (int i = 0; i < requested.length(); i++) selected.add(requested.getString(i)); }
            selected = VisionPolicy.models(provider, model, selected);
            if (label.isEmpty() || label.length() > 40) throw new SafeFailure("配置名称须为 1～40 个字符。");
            JSONObject existing = null;
            if (!id.isEmpty()) existing = profile(state, id);
            if (existing == null && list.length() >= 12) throw new SafeFailure("最多保存 12 组配置，请先删除不再使用的配置。");
            key = VisionPolicy.selectApiKey(provider, key, existing == null ? null : existing.getString("provider"), existing == null ? null : existing.getString("apiKey"));
            JSONObject candidate = new JSONObject().put("id", existing == null ? UUID.randomUUID().toString() : id)
                .put("label", label).put("provider", provider).put("model", model).put("models", new JSONArray(selected)).put("apiKey", key);
            test(candidate); // 失败不写磁盘、不替换原 Key，也不自动切换提供商。
            if (existing == null) list.put(candidate);
            else for (int i = 0; i < list.length(); i++) if (list.getJSONObject(i).getString("id").equals(id)) list.put(i, candidate);
            if (state.isNull("activeId")) state.put("activeId", candidate.getString("id"));
            write(state); return publicState(state);
        });
    }
    @PluginMethod public void activate(PluginCall call) {
        run(call, () -> {
            JSONObject state = read(); JSONObject p = profile(state, call.getString("id", "")); String model = call.getString("model", p.getString("model"));
            if (!profileModels(p).contains(model)) throw new SafeFailure("此模型未加入这组 Key，请先在设置勾选。");
            p.put("model", model); state.put("activeId", p.getString("id")); write(state); return publicState(state);
        });
    }
    @PluginMethod public void deleteProfile(PluginCall call) {
        run(call, () -> {
            JSONObject state = read(); String id = call.getString("id", ""); profile(state, id);
            JSONArray list = state.getJSONArray("profiles");
            for (int i = 0; i < list.length(); i++) if (list.getJSONObject(i).getString("id").equals(id)) { list.remove(i); break; }
            // 删除正在用的配置后要求用户主动选用，避免无意消费另一组额度。
            if (id.equals(state.optString("activeId"))) state.put("activeId", JSONObject.NULL);
            write(state); return publicState(state);
        });
    }
    @PluginMethod public void clearProfiles(PluginCall call) {
        run(call, () -> { if (!prefs().edit().remove("sealed-v1").commit()) throw new SafeFailure("清空配置失败，请重试。"); return publicState(read()); });
    }
    @PluginMethod public void testProfile(PluginCall call) {
        run(call, () -> { JSONObject state = read(); test(profile(state, call.getString("id", ""))); return publicState(state); });
    }
    @PluginMethod public void recognize(PluginCall call) {
        run(call, () -> {
            JSONObject p = requestProfile(read(), call);
            String encoded = call.getString("imageBase64", ""), prompt = call.getString("prompt", "");
            if (encoded.length() > 1_398_104 || prompt.length() < 100 || prompt.length() > 30_000) throw new SafeFailure("图片或识别参数无效，请重新选择照片。");
            byte[] bytes;
            try { bytes = Base64.decode(encoded, Base64.NO_WRAP); } catch (IllegalArgumentException error) { throw new SafeFailure("图片编码无效。"); }
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (bytes.length == 0 || bytes.length > 1_048_576 || !"image/jpeg".equals(options.outMimeType) || options.outWidth < 1 || options.outHeight < 1 || Math.max(options.outWidth, options.outHeight) > 1280)
                throw new SafeFailure("请使用压缩后的 JPEG 图片，最长边 1280 像素且不超过 1 MB。");
            JSONObject schema = call.getObject("schema");
            String data = request(p, body(p, prompt, encoded, "image/jpeg", schema, false));
            JSObject output = new JSObject(); output.put("provider", p.getString("provider")); output.put("model", p.getString("model")); output.put("data", data); return output;
        });
    }

    @PluginMethod public void describeMeal(PluginCall call) {
        run(call, () -> {
            JSONObject p = requestProfile(read(), call);
            String prompt = call.getString("prompt", ""), text = call.getString("request", "");
            if (prompt.length() < 100 || prompt.length() > 10000 || text.length() > 3 * 1_398_104 + 32768) throw new SafeFailure("助手输入过长，请简化描述。");
            JSONObject input = new JSONObject(text);
            if (input.optString("text").length() > 1000 || (input.optString("text").trim().isEmpty() && !input.has("imageBase64"))) throw new SafeFailure("请输入1000字以内的描述或选择图片。");
            JSONArray history = input.optJSONArray("history"), images = new JSONArray();
            if (history != null) {
                if (history.length() > 6) throw new SafeFailure("聊天上下文过长，请开始新对话。");
                for (int i = 0; i < history.length(); i++) {
                    JSONObject turn = history.getJSONObject(i); String role = turn.optString("role"), value = turn.optString("text");
                    if ((!role.equals("user") && !role.equals("assistant")) || value.length() > 1000 || (value.trim().isEmpty() && !turn.has("imageBase64")) || (role.equals("assistant") && turn.has("imageBase64"))) throw new SafeFailure("聊天上下文无效。");
                    assistantImage(turn, images);
                }
            }
            assistantImage(input, images);
            text = input.toString();
            JSONArray content = new JSONArray().put(new JSONObject().put("type", "text").put("text", text));
            for (int i = 0; i < images.length(); i++) {
                if (p.getString("provider").equals("gemini")) content.put(new JSONObject().put("type", "image").put("mime_type", "image/jpeg").put("data", images.getString(i)));
                else content.put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:image/jpeg;base64," + images.getString(i))));
            }
            JSONObject body = new JSONObject().put("model", p.getString("model"));
            if (p.getString("provider").equals("gemini")) {
                body.put("store", false).put("system_instruction", prompt)
                    .put("input", content)
                    .put("response_format", new JSONObject().put("type", "text").put("mime_type", "application/json").put("schema", call.getObject("schema")))
                    .put("generation_config", new JSONObject().put("thinking_level", "minimal").put("max_output_tokens", 2048));
            } else {
                JSONObject options = new JSONObject(VisionPolicy.chatOptions(p.getString("provider"), p.getString("model")));
                for (Iterator<String> names = options.keys(); names.hasNext();) { String name = names.next(); body.put(name, options.get(name)); }
                if (!p.getString("provider").equals("glm") || VisionPolicy.glm53(p.getString("model"))) body.put("response_format", responseFormat(p, call.getObject("schema")));
                body.put("max_tokens", p.getString("provider").equals("glm") && VisionPolicy.glm53(p.getString("model")) ? 4096 : 2048)
                    .put("messages", new JSONArray().put(new JSONObject().put("role", "system").put("content", prompt)).put(new JSONObject().put("role", "user").put("content", images.length() == 0 ? text : content)));
            }
            String data = request(p, body);
            JSObject result = new JSObject(); result.put("provider", p.getString("provider")); result.put("model", p.getString("model")); result.put("data", data); return result;
        });
    }

    /**
     * 先检查编码与像素边界，再解码重压缩，移除原图容器携带的额外元数据。
     * 将文本对象中的大块 base64 替换为 imageNumber，图像仅通过提供商的图片字段传一次。
     * Bitmap 持有原生内存，成功或失败都在 finally recycle，不能只等待 Java GC。
     */
    private void assistantImage(JSONObject turn, JSONArray images) throws Exception {
        if (!turn.has("imageBase64")) return;
        String encoded = turn.getString("imageBase64");
        if (images.length() >= 3 || encoded.isEmpty() || encoded.length() > 1_398_104 || encoded.length() % 4 != 0 || !encoded.matches("[A-Za-z0-9+/]*={0,2}")) throw new SafeFailure("最多携带3张不超过1 MB的JPEG图片。");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bytes.length == 0 || bytes.length > 1_048_576 || !"image/jpeg".equals(bounds.outMimeType) || bounds.outWidth < 1 || bounds.outHeight < 1 || Math.max(bounds.outWidth, bounds.outHeight) > 1280) throw new SafeFailure("图片需为最长边1280像素、不超过1 MB的JPEG。");
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) throw new SafeFailure("图片损坏，请重新选择。");
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out) || out.size() > 1_048_576) throw new SafeFailure("图片压缩失败，请重新选择。");
            images.put(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        } finally { bitmap.recycle(); }
        turn.remove("imageBase64"); turn.put("imageNumber", images.length());
    }

    private void test(JSONObject p) throws Exception {
        try {
        // 固定 64x64 PNG，不读取相册；测试也消耗提供商的少量额度。
        String png = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAn0lEQVRoge2SQQkAQRDDaqrSTl68rYh7hIFCBKSh6cdpoht0A9ArdhfiLtENugHoFbsLcZfoBt0A9IrdhbhLdINuAHrF7kLcJbpBNwC9Ynch7hLdoBuAXrG7EHeJbtANQK/YXYi7RDfoBqBX7C7EXaIbdAPQK3YX4i7RDboB6BW7C3GX6AbdAPSK3YW4S3SDbgB6xe5C3CW6QTcAveIfHmkrcUvhQRTIAAAAAElFTkSuQmCC";
        JSONObject data = new JSONObject(request(p, body(p, "Inspect the tiny image. Reply only with JSON: {\"ok\":true}", png, "image/png", null, true)));
        String text;
        if (p.getString("provider").equals("gemini")) {
            if (!"completed".equals(data.optString("status"))) throw new SafeFailure("模型未完成测试，请稍后重试。");
            StringBuilder joined = new StringBuilder(); JSONArray steps = data.optJSONArray("steps");
            if (steps != null) for (int i = 0; i < steps.length(); i++) {
                JSONObject step = steps.getJSONObject(i); if (!"model_output".equals(step.optString("type"))) continue;
                JSONArray content = step.optJSONArray("content");
                if (content != null) for (int j = 0; j < content.length(); j++) { JSONObject item = content.getJSONObject(j); if ("text".equals(item.optString("type"))) joined.append(item.optString("text")); }
            }
            text = data.optString("output_text", joined.toString());
        } else {
            JSONArray choices = data.optJSONArray("choices");
            if (choices == null || choices.length() == 0 || !"stop".equals(choices.getJSONObject(0).optString("finish_reason"))) throw new SafeFailure("模型测试输出不完整，请重试。");
            text = choices.getJSONObject(0).getJSONObject("message").optString("content");
        }
        text = VisionPolicy.finalContent(p.getString("model"), text);
        try { if (!new JSONObject(text.trim().replaceAll("(?s)^```(?:json)?\\s*|\\s*```$", "")).getBoolean("ok")) throw new Exception(); }
        catch (Exception error) { throw new SafeFailure("模型未返回预期的测试结果，原配置已保留。"); }
        } catch (org.json.JSONException error) { throw new SafeFailure("模型测试响应无效或结构不完整，原配置已保留。"); }
    }
    private JSONObject responseFormat(JSONObject p, JSONObject schema) throws Exception {
        if (schema != null && VisionPolicy.structuredOutputs(p.getString("provider"), p.getString("model")))
            return new JSONObject().put("type", "json_schema").put("json_schema", new JSONObject().put("name", "shike_result").put("strict", true).put("schema", schema));
        return new JSONObject().put("type", "json_object");
    }
    private JSONObject body(JSONObject p, String prompt, String encoded, String mime, JSONObject schema, boolean probe) throws Exception {
        JSONObject result = new JSONObject().put("model", p.getString("model"));
        if (p.getString("provider").equals("gemini")) {
            JSONObject format = new JSONObject().put("type", "text").put("mime_type", "application/json");
            if (schema != null) format.put("schema", schema);
            return result.put("store", false).put("system_instruction", prompt).put("response_format", format)
                .put("generation_config", new JSONObject().put("thinking_level", "minimal").put("max_output_tokens", probe ? 256 : 8192))
                .put("input", new JSONArray().put(new JSONObject().put("type", "text").put("text", probe ? "Return the requested JSON." : "识别食物或包装标签。包装输出packageLabel原数值和单位，不猜摄入量或营养；普通餐食提供可判断的每100g三档营养范围。只输出JSON。"))
                    .put(new JSONObject().put("type", "image").put("mime_type", mime).put("data", encoded)));
        }
        JSONObject options = new JSONObject(VisionPolicy.chatOptions(p.getString("provider"), p.getString("model")));
        for (Iterator<String> names = options.keys(); names.hasNext();) { String name = names.next(); result.put(name, options.get(name)); }
        // 5.3明确支持JSON输出；旧GLM视觉型号保持提示词加本地校验的契约。
        if (!p.getString("provider").equals("glm") || VisionPolicy.glm53(p.getString("model"))) result.put("response_format", responseFormat(p, schema));
        return result.put("max_tokens", probe ? VisionPolicy.probeTokens(p.getString("model")) : 8192)
            .put("messages", new JSONArray().put(new JSONObject().put("role", "system").put("content", prompt))
                .put(new JSONObject().put("role", "user").put("content", new JSONArray()
                    .put(new JSONObject().put("type", "text").put("text", probe ? (p.getString("model").equals("glm-4.1v-thinking-flash") ? "请观察这张测试图。连接测试：最终答案只输出 {\"ok\":true}，不要解释，不要添加Markdown。" : "Return the requested JSON.") : "识别食物或包装标签。包装输出packageLabel原数值和单位，不猜摄入量或营养；普通餐食提供可判断的每100g三档营养范围。只输出JSON。"))
                    .put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:" + mime + ";base64," + encoded).put("detail", "high"))))));
    }
    /** 在实际请求前消耗本机保护计数，失败请求也计入；这不是提供商账单或跨设备全局限额。 */
    private void consumeAttempt() throws Exception {
        long now = System.currentTimeMillis();
        while (!attempts.isEmpty() && attempts.peek() <= now - 60_000) attempts.remove();
        if (attempts.size() >= 5) throw new SafeFailure("本机每分钟最多 5 次模型请求，请稍后再试。");
        long day = (now + 8 * 3_600_000L) / 86_400_000L;
        int count = prefs().getLong("request-day", -1) == day ? prefs().getInt("request-count", 0) : 0;
        if (count >= 100) throw new SafeFailure("本机今日已达到 100 次请求保护上限，明天可继续使用。");
        if (!prefs().edit().putLong("request-day", day).putInt("request-count", count + 1).commit()) throw new SafeFailure("无法保存用量计数，请检查手机存储。");
        attempts.add(now);
    }
    /**
     * p 是本次请求快照，地址由原生白名单得出，页面不能指定目标；禁止带 Key 的请求自动跟随跳转。
     * 连接/单次读取超时之外再设置总时限，避免持续少量返回让请求无限延长。
     * 响应限制为有界正文，出错时不回显提供商原文；finally 同时取消定时任务并断开连接。
     */
    private String request(JSONObject p, JSONObject body) throws Exception {
        String endpoint = VisionPolicy.endpoint(p.getString("provider"), p.getString("model"));
        consumeAttempt();
        HttpsURLConnection connection = (HttpsURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10_000); connection.setReadTimeout(45_000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setUseCaches(false);
        connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty(p.getString("provider").equals("gemini") ? "x-goog-api-key" : "Authorization",
            p.getString("provider").equals("gemini") ? p.getString("apiKey") : "Bearer " + p.getString("apiKey"));
        AtomicBoolean expired = new AtomicBoolean(false);
        ScheduledFuture<?> deadline = clock.schedule(() -> { expired.set(true); connection.disconnect(); }, 55, TimeUnit.SECONDS);
        try {
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = connection.getOutputStream()) { out.write(payload); }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                String businessCode = "";
                if (p.getString("provider").equals("glm")) {
                    // 只读取小体积错误码，绝不回显上游正文（可能含账户信息）。
                    try (InputStream in = connection.getErrorStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        if (in != null) {
                            byte[] buffer = new byte[2048]; int size;
                            while ((size = in.read(buffer)) != -1) { if (out.size() + size > 16384) break; out.write(buffer, 0, size); }
                            JSONObject error = new JSONObject(out.toString("UTF-8")).optJSONObject("error");
                            if (error != null) businessCode = error.optString("code", "");
                        }
                    } catch (Exception ignored) { /* 无效或超大错误体使用固定通用提示。 */ }
                }
                if (expired.get()) throw new SocketTimeoutException();
                throw new SafeFailure(VisionPolicy.httpError(status, p.getString("provider"), businessCode));
            }
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int size;
                while ((size = in.read(buffer)) != -1) { if (out.size() + size > 524_288) throw new SafeFailure("模型响应过大，已停止读取，请手动记录或重试。"); out.write(buffer, 0, size); }
                if (expired.get()) throw new SocketTimeoutException();
                return out.toString("UTF-8");
            }
        } catch (SocketTimeoutException error) { throw new SafeFailure("模型请求超时，请稍后重试；不会自动重试或切换 Key。"); }
        catch (java.io.IOException error) { throw new SafeFailure(expired.get() ? "模型请求超时，请稍后重试。" : "模型网络连接失败，请检查网络及提供商所在地区的可达性。"); }
        finally { deadline.cancel(false); connection.disconnect(); }
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); clock.shutdown(); }
}
