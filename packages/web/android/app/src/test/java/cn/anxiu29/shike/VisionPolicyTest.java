package cn.anxiu29.shike;

import org.junit.Test;
import java.util.Map;
import static org.junit.Assert.*;

public class VisionPolicyTest {
    @Test public void glm53ResourceModelsHaveEnabledLowThinkingAndEnoughProbeBudget() {
        for (String model : new String[] {"glm-5.3-flash", "glm-5.3-flashx"}) {
            assertEquals("https://open.bigmodel.cn/api/paas/v4/chat/completions", VisionPolicy.endpoint("glm", model));
            assertEquals(Map.of("thinking", Map.of("type", "enabled"), "reasoning_effort", "low", "temperature", 1, "top_p", 0.95), VisionPolicy.chatOptions("glm", model));
            assertEquals(1024, VisionPolicy.probeTokens(model)); assertTrue(VisionPolicy.glm53(model));
        }
        assertFalse(VisionPolicy.glm53("glm-5.3"));
        assertEquals(256, VisionPolicy.probeTokens("glm-4.6v-flashx"));
        assertEquals(1024, VisionPolicy.probeTokens("glm-4.1v-thinking-flash"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("glm", "glm-5.3-flashx-legal"));
    }
    @Test public void removedGoogleModelsCannotBeCalledAndOldGroupsKeepRemainingChoices() {
        String old = "google/gemma-4-26b-a4b-it:free", current = "nvidia/nemotron-3.5-super-vl:free";
        for (String model : new String[] {old, "google/gemma-4-31b-it:free"}) assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("openrouter", model));
        assertEquals(java.util.List.of(current), VisionPolicy.migratedModels("openrouter", old, java.util.List.of(old, current)));
        assertEquals(2, VisionPolicy.migratedModels("openrouter", old, null).size());
        assertEquals(java.util.List.of(current), VisionPolicy.migratedModels("openrouter", current, java.util.List.of(old, current)));
        assertNull(VisionPolicy.migratedModels("openrouter", current, null));
        assertNull(VisionPolicy.migratedModels("qwen", "qwen3.7-flash", null));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.migratedModels("openrouter", old, java.util.List.of(old, "https://evil.test")));
    }
    @Test public void glm41BuiltInThinkingAndSafeBusinessErrorsAreModelSpecific() {
        String answer = "{\"ok\":true}", wrapped = "<think>{\"ok\":false}</think>\n<answer>" + answer + "</answer>";
        assertEquals(answer, VisionPolicy.finalContent("glm-4.1v-thinking-flash", wrapped));
        assertEquals(wrapped, VisionPolicy.finalContent("glm-4.6v-flash", wrapped));
        assertEquals(answer, VisionPolicy.finalContent("glm-4.1v-thinking-flash", answer));
        assertEquals(answer, VisionPolicy.finalContent("glm-4.1v-thinking-flash", "<think>分析</think><answer><|begin_of_box|>" + answer + "<|end_of_box|></answer>"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.finalContent("glm-4.1v-thinking-flash", "<|begin_of_box|>" + answer));
        for (String value : new String[] {"<think>abc</think>" + answer, "<answer>" + answer, wrapped + "extra", wrapped + "<answer>{}</answer>"}) assertThrows(IllegalArgumentException.class, () -> VisionPolicy.finalContent("glm-4.1v-thinking-flash", value));
        assertEquals(answer, VisionPolicy.finalContent("glm-4.1v-thinking-flash", "<think>" + "x".repeat(100000) + "</think><answer>" + answer + "</answer>"));
        assertEquals("https://open.bigmodel.cn/api/paas/v4/chat/completions", VisionPolicy.endpoint("glm", "glm-4.1v-thinking-flash"));
        assertEquals(Map.of("temperature", 0.2), VisionPolicy.chatOptions("glm", "glm-4.1v-thinking-flash"));
        assertEquals(Map.of("temperature", 0.2, "thinking", Map.of("type", "disabled")), VisionPolicy.chatOptions("glm", "glm-4.6v-flash"));
        assertEquals("https://open.bigmodel.cn/api/paas/v4/chat/completions", VisionPolicy.endpoint("glm", "glm-4.6v-flashx"));
        assertEquals(Map.of("temperature", 0.2, "thinking", Map.of("type", "disabled")), VisionPolicy.chatOptions("glm", "glm-4.6v-flashx"));
        assertEquals(3, VisionPolicy.models("glm", "glm-4.6v-flashx", java.util.List.of("glm-4.1v-thinking-flash", "glm-4.6v-flash", "glm-4.6v-flashx")).size());
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("glm", "glm-4.6v"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("glm", "glm-4.6-flashx"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("glm", "glm-5.3-flashx-legal"));
        assertTrue(VisionPolicy.httpError(429, "glm", "1305").contains("访问量过大"));
        assertTrue(VisionPolicy.httpError(429, "glm", "1302").contains("请求过于频繁"));
        assertTrue(VisionPolicy.httpError(429, "glm", "1113").contains("欠费"));
        assertTrue(VisionPolicy.httpError(400, "glm", "1221").contains("下线"));
        assertEquals(VisionPolicy.httpError(429), VisionPolicy.httpError(429, "deepseek", "1305"));
        assertEquals(VisionPolicy.httpError(429), VisionPolicy.httpError(429, "glm", "private-response-secret"));
    }
    @Test public void newFreeVisionModelsHaveFixedHostsAndStructuredOutputsWithoutOpeningOtherModels() {
        for (String model : new String[] {"nvidia/nemotron-3.5-super-vl:free", "dots-studio/dots-3-note-preview:free"}) {
            assertEquals("https://openrouter.ai/api/v1/chat/completions", VisionPolicy.endpoint("openrouter", model));
            assertTrue(VisionPolicy.structuredOutputs("openrouter", model));
        }
        assertFalse(VisionPolicy.structuredOutputs("openrouter", "google/gemma-4-31b-it:free"));
        assertFalse(VisionPolicy.structuredOutputs("qwen", "nvidia/nemotron-3.5-super-vl:free"));
        for (String model : new String[] {"nvidia/nemotron-3.5-super-vl", "dots-studio/dots-3-note-preview", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "nvidia/nemotron-3.5-content-safety:free", "thinkingmachines/inkling:free"})
            assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("openrouter", model));
    }
    @Test public void glmVisionUsesItsOwnStableSamplingAndDisabledThinking() {
        assertEquals(Map.of("thinking", Map.of("type", "disabled"), "temperature", 0.2), VisionPolicy.chatOptions("glm"));
    }
    @Test public void oneKeyGroupOnlyAllowsItsOwnProvidersModels() {
        assertEquals(java.util.List.of("qwen3.7-flash"), VisionPolicy.models("qwen", "qwen3.7-flash", null));
        assertEquals(2, VisionPolicy.models("qwen", "qwen3.7-flash", java.util.List.of("qwen3.7-flash", "qwen3-vl-plus")).size());
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.models("qwen", "qwen3.7-flash", java.util.List.of("qwen3.7-flash", "gemini-3.5-flash-lite")));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.models("qwen", "qwen3.7-flash", java.util.List.of("qwen3-vl-plus")));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.models("qwen", "qwen3.7-flash", java.util.List.of("qwen3.7-flash", "qwen3.7-flash")));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.models("qwen", "qwen3.7-flash", java.util.List.of()));
    }
    @Test public void keepingAnExistingKeyDoesNotAllowCrossProviderOrInvalidKeys() {
        assertEquals("example-old-key", VisionPolicy.selectApiKey("qwen", "", "qwen", "example-old-key"));
        assertEquals("example-new-key", VisionPolicy.selectApiKey("qwen", "example-new-key", "qwen", "example-old-key"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.selectApiKey("gemini", "", "qwen", "example-old-key"));
        for (String key : new String[] { "", "short", "bad key example", "bad\nkey-example" }) assertThrows(IllegalArgumentException.class, () -> VisionPolicy.selectApiKey("qwen", key, null, null));
    }
    @Test public void keysCannotBeRedirectedToCustomHostsOrCrossProviderModels() {
        assertEquals("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", VisionPolicy.endpoint("qwen", "qwen3.7-flash"));
        assertEquals("https://generativelanguage.googleapis.com/v1beta/interactions", VisionPolicy.endpoint("gemini", "gemini-3.5-flash-lite"));
        assertEquals("https://open.bigmodel.cn/api/paas/v4/chat/completions", VisionPolicy.endpoint("glm", "glm-4.6v-flash"));
        assertEquals("https://api.siliconflow.cn/v1/chat/completions", VisionPolicy.endpoint("siliconflow", "Qwen/Qwen3.5-4B"));
        assertEquals("https://openrouter.ai/api/v1/chat/completions", VisionPolicy.endpoint("openrouter", "nvidia/nemotron-3.5-super-vl:free"));
        assertEquals("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", VisionPolicy.endpoint("qwen", "qwen3-vl-plus"));
        assertEquals("https://api.deepseek.com/chat/completions", VisionPolicy.endpoint("deepseek", "deepseek-flash"));
        for (String[] item : new String[][] { {"https://evil.test", "qwen3.7-flash"}, {"qwen", "gemini-3.5-flash-lite"}, {"glm", "qwen3.7-plus"}, {"qwen", "unknown-model"} }) {
            assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint(item[0], item[1]));
        }
    }
    @Test public void freeRoutingCannotFallBackToPaidModelsAndProviderOptionsStaySeparate() {
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("openrouter", "google/gemma-4-31b-it"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("openrouter", "openrouter/free"));
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("siliconflow", "google/gemma-4-31b-it:free"));
        Map<?, ?> routing = (Map<?, ?>) VisionPolicy.chatOptions("openrouter").get("provider");
        assertEquals(false, routing.get("allow_fallbacks"));
        assertEquals(Map.of("prompt", 0, "completion", 0, "request", 0), routing.get("max_price"));
        assertFalse(VisionPolicy.chatOptions("openrouter").containsKey("thinking"));
        assertEquals(false, VisionPolicy.chatOptions("siliconflow").get("enable_thinking"));
    }
    @Test public void failuresAreActionableWithoutEchoingProviderBodies() {
        assertTrue(VisionPolicy.httpError(401).contains("Key"));
        assertTrue(VisionPolicy.httpError(403).contains("地域"));
        assertTrue(VisionPolicy.httpError(429).contains("429"));
        assertTrue(VisionPolicy.httpError(302).contains("重定向"));
        assertTrue(VisionPolicy.httpError(503).contains("503"));
    }
    @Test public void deepSeekRejectsTextOnlyModelsAndDoesNotUseAnotherProvidersParameters() {
        for (String model : new String[] {"deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash-vision-exp"}) {
            assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("deepseek", model));
        }
        assertThrows(IllegalArgumentException.class, () -> VisionPolicy.endpoint("siliconflow", "deepseek-flash"));
        assertEquals(Map.of("thinking", Map.of("type", "disabled")), VisionPolicy.chatOptions("deepseek"));
        assertTrue(VisionPolicy.httpError(402).contains("余额"));
    }
}
