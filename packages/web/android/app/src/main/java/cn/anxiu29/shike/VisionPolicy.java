package cn.anxiu29.shike;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;

/** 原生层独立校验白名单，网页不能指定任意地址或把 Key 发给其他网站。 */
final class VisionPolicy {
    /** 空输入只保留本组原有 Key，不跨平台读取。 */
    static String selectApiKey(String provider, String supplied, String existingProvider, String existingKey) {
        String key = supplied;
        if (key.isEmpty() && provider.equals(existingProvider)) key = existingKey;
        if (key == null || key.length() < 8 || key.length() > 512 || !key.matches("[!-~]+")) throw new IllegalArgumentException("请输入有效的 API Key，不含空格或换行。");
        return key;
    }

    static List<String> models(String provider, String current, List<String> requested) {
        List<String> result = requested == null ? new ArrayList<>(java.util.Collections.singletonList(current)) : new ArrayList<>(requested);
        if (result.isEmpty() || result.size() > 10 || !result.contains(current)) throw new IllegalArgumentException("请选择至少一个可用模型，默认模型必须在本组中。");
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        for (String model : result) { endpoint(provider, model); if (!seen.add(model)) throw new IllegalArgumentException("模型列表不能重复。"); }
        return result;
    }

    /** 地址与型号组成成对的白名单；只验证型号或只验证 host 都不足以限制实际请求目标。 */
    static String endpoint(String provider, String model) {
        if (provider.equals("qwen") && (model.equals("qwen3.7-flash") || model.equals("qwen3.8-flash") || model.equals("qwen3.7-plus") || model.equals("qwen3-vl-plus")))
            return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
        if (provider.equals("gemini") && model.equals("gemini-3.5-flash-lite"))
            return "https://generativelanguage.googleapis.com/v1beta/interactions";
        if (provider.equals("glm") && (model.equals("glm-4.1v-thinking-flash") || model.equals("glm-4.6v-flash") || model.equals("glm-4.6v-flashx") || glm53(model)))
            return "https://open.bigmodel.cn/api/paas/v4/chat/completions";
        if (provider.equals("siliconflow") && model.equals("Qwen/Qwen3.5-4B"))
            return "https://api.siliconflow.cn/v1/chat/completions";
        if (provider.equals("deepseek") && model.equals("deepseek-flash"))
            return "https://api.deepseek.com/chat/completions";
        if (provider.equals("openrouter") && (model.equals("nvidia/nemotron-3.5-super-vl:free") || model.equals("dots-studio/dots-3-note-preview:free")))
            return "https://openrouter.ai/api/v1/chat/completions";
        throw new IllegalArgumentException("不支持的提供商或模型，请重新选择。");
    }

    static boolean structuredOutputs(String provider, String model) {
        return provider.equals("openrouter") && (model.equals("nvidia/nemotron-3.5-super-vl:free") || model.equals("dots-studio/dots-3-note-preview:free"));
    }

    /** 平台参数分别传递；OpenRouter只允许零价格提供方，不自动降级到付费路由。 */
    static Map<String, Object> chatOptions(String provider) { return chatOptions(provider, null); }
    static boolean glm53(String model) { return "glm-5.3-flash".equals(model) || "glm-5.3-flashx".equals(model); }
    static int probeTokens(String model) { return "glm-4.1v-thinking-flash".equals(model) || glm53(model) ? 1024 : 256; }
    static Map<String, Object> chatOptions(String provider, String model) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (provider.equals("glm") && glm53(model)) {
            result.put("thinking", map("type", "enabled")); result.put("reasoning_effort", "low");
            result.put("temperature", 1); result.put("top_p", 0.95); return result;
        }
        if (provider.equals("qwen") || provider.equals("siliconflow")) result.put("enable_thinking", false);
        if ((provider.equals("glm") && !"glm-4.1v-thinking-flash".equals(model)) || provider.equals("deepseek")) result.put("thinking", map("type", "disabled"));
        if (provider.equals("glm")) result.put("temperature", 0.2);
        if (provider.equals("openrouter")) {
            result.put("reasoning", map("enabled", false));
            result.put("provider", map("allow_fallbacks", false, "require_parameters", true,
                "max_price", map("prompt", 0, "completion", 0, "request", 0)));
        }
        return result;
    }
    // 避免Map.of的较高Android API要求，保留Android 7及以上的运行兼容。
    private static Map<String, Object> map(Object... fields) {
        Map<String, Object> values = new LinkedHashMap<>();
        for (int i = 0; i < fields.length; i += 2) values.put((String) fields[i], fields[i + 1]);
        return values;
    }

    static boolean removedOpenRouterModel(String model) {
        return "google/gemma-4-26b-a4b-it:free".equals(model) || "google/gemma-4-31b-it:free".equals(model);
    }
    /**
     * 特定思考模型可能用标签包装最终答案；仅接受成对且不嵌套的已知包装。
     * 不完整时拒绝，不能猜测截断位置并把思考片段作为业务答案；返回后还要解析业务 JSON。
     */
    static String finalContent(String model, String text) {
        if (!"glm-4.1v-thinking-flash".equals(model)) return text;
        String value = text.trim();
        if (value.startsWith("<think>")) {
            int end = value.indexOf("</think>");
            if (end < 0 || hasAnswerTags(value.substring(7, end))) throw new IllegalArgumentException("模型思考或答案未完整结束，请重新识别或手动记录。");
            value = value.substring(end + 8).trim();
            if (!value.startsWith("<answer>")) throw new IllegalArgumentException("模型思考或答案未完整结束，请重新识别或手动记录。");
        }
        if (value.startsWith("<answer>")) {
            if (!value.endsWith("</answer>")) throw new IllegalArgumentException("模型思考或答案未完整结束，请重新识别或手动记录。");
            value = value.substring(8, value.length() - 9).trim();
            if (hasAnswerTags(value)) throw new IllegalArgumentException("模型思考或答案未完整结束，请重新识别或手动记录。");
        }
        String begin = "<|begin_of_box|>", end = "<|end_of_box|>";
        if (value.startsWith(begin)) {
            if (!value.endsWith(end)) throw new IllegalArgumentException("模型思考或答案未完整结束，请重新识别或手动记录。");
            value = value.substring(begin.length(), value.length() - end.length()).trim();
            if (value.contains(begin) || value.contains(end)) throw new IllegalArgumentException("模型思考或答案未完整结束，请重新识别或手动记录。");
        }
        return value;
    }
    private static boolean hasAnswerTags(String value) { return value.contains("<think>") || value.contains("</think>") || value.contains("<answer>") || value.contains("</answer>"); }
    /** 只迁移明确移除的旧型号，保留同组Key；调用层取消受影响的当前选用，不发请求。 */
    static List<String> migratedModels(String provider, String current, List<String> requested) {
        if (!"openrouter".equals(provider)) return null;
        List<String> original = requested == null ? java.util.Collections.singletonList(current) : requested;
        if (!removedOpenRouterModel(current) && !original.stream().anyMatch(VisionPolicy::removedOpenRouterModel)) return null;
        List<String> remaining = new ArrayList<>();
        for (String model : original) if (!removedOpenRouterModel(model)) { endpoint(provider, model); remaining.add(model); }
        if (remaining.isEmpty()) { remaining.add("nvidia/nemotron-3.5-super-vl:free"); remaining.add("dots-studio/dots-3-note-preview:free"); }
        return remaining;
    }

    static String httpError(int status, String provider, String businessCode) {
        if ("glm".equals(provider)) {
            if (status == 429) {
                switch (businessCode) {
                    case "1113": return "智谱账户欠费（1113），请到平台检查余额；不是模型下线。";
                    case "1302": return "智谱账户请求过于频繁（1302），请降低频率后重试。";
                    case "1305": return "智谱模型当前访问量过大（1305），请稍后重试或手动选择其他模型。";
                    case "1308": return "已达到智谱使用上限（1308），请到平台查看重置时间。";
                    case "1310": return "已达到智谱周或月使用上限（1310），请到平台查看重置时间。";
                    case "1311": return "智谱套餐未开放当前模型权限（1311），请检查模型标准API权限。";
                    case "1315": return "当前智谱Key仅限企业编程套餐（1315），请更换模型标准API Key。";
                }
            }
            if (status == 400 && "1211".equals(businessCode)) return "智谱模型不存在（1211），请核对型号或选择其他已适配模型。";
            if (status == 400 && "1221".equals(businessCode)) return "智谱API已下线（1221），请选择其他已适配模型。";
        }
        return httpError(status);
    }

    static String httpError(int code) {
        if (code == 401) return "API Key 无效或已撤销，请在模型配置中更换。";
        if (code == 402) return "模型账户余额或额度不足，请到提供商控制台检查。";
        if (code == 403) return "模型拒绝访问，请检查地域、模型权限和服务开通状态。";
        if (code == 404) return "模型未开放、已下线或暂无可用端点，请检查平台模型页。";
        if (code == 429) return "模型请求受限（429），请稍后重试或到提供商查看具体原因。";
        if (code >= 300 && code < 400) return "模型接口发生重定向，已停止请求以保护 Key。";
        return "模型服务请求失败（HTTP " + code + "），请检查配置或稍后重试。";
    }
}
