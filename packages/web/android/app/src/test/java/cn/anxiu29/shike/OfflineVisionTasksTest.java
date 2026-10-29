package cn.anxiu29.shike;
import org.junit.Test;
import static org.junit.Assert.*;
public class OfflineVisionTasksTest {
    @Test public void structuredTasksUseBoundedSchemas() {
        for (String task : new String[]{"food_estimate", "package_label"}) {
            assertTrue(OfflineVisionTasks.valid(task)); assertTrue(OfflineVisionTasks.structured(task));
            assertEquals(512, OfflineVisionTasks.limit(task));
            assertTrue(OfflineVisionTasks.schema(task).contains("\"additionalProperties\":false"));
        }
        assertFalse(OfflineVisionTasks.valid("custom")); assertNull(OfflineVisionTasks.schema("test"));
        assertEquals(128, OfflineVisionTasks.limit("names"));
    }
    @Test public void jsonNullsAndRepeatedKeysAreNotFoodRepetition() {
        String json = "{\"foods\":[{\"name\":\"米饭\",\"estimatedWeightG\":null},{\"name\":\"鸡蛋\",\"estimatedWeightG\":null},{\"name\":\"牛奶\",\"estimatedWeightG\":null}]}";
        assertEquals("", OfflineVisionTasks.outputIssue("food_estimate", json));
        assertEquals("", OfflineVisionTasks.outputIssue("package_label", "null ".repeat(10)));
        assertEquals("repetition", OfflineVisionTasks.outputIssue("names", "蔬菜".repeat(10)));
        assertEquals("list_limit", OfflineVisionTasks.outputIssue("package_label", "x".repeat(5001)));
    }
}
