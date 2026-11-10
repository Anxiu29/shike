package cn.anxiu29.shike;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineVisionPolicyTest {
    @Test public void acceptsFullSizeImageWithoutRecursiveRegex() {
        assertTrue(OfflineVisionPolicy.validImageBase64("A".repeat(1_398_100) + "AA=="));
        assertFalse(OfflineVisionPolicy.validImageBase64("A".repeat(1_398_108)));
    }
    @Test public void rejectsNonImageEncodingsAndInvalidPadding() {
        for (String invalid : new String[] {"", "AAA", "=AAA", "A===", "AA=A", "A A=", "AA\n=", "data:image/jpeg;base64,AAAA", "AAAA-AAA"}) assertFalse(invalid, OfflineVisionPolicy.validImageBase64(invalid));
        for (String valid : new String[] {"AAAA", "AAA=", "AA==", "/+AA"}) assertTrue(valid, OfflineVisionPolicy.validImageBase64(valid));
    }
    @Test public void catchesRepeatedVegetablesAcrossNumberedAndUnnumberedLines() {
        assertEquals("repetition", OfflineVisionPolicy.outputIssue("蔬菜\n蔬菜\n蔬菜\n蔬菜"));
        assertEquals("repetition", OfflineVisionPolicy.outputIssue("1. 蔬菜\n2. 蔬菜\n3. 蔬菜\n4. 蔬菜"));
        assertEquals("repetition", OfflineVisionPolicy.outputIssue("可见食物：蔬菜、蔬菜、蔬菜、蔬菜"));
    }
    @Test public void userReportedSeasoningCycleIsRejectedBeforeItExpandsToFortyItems() {
        String[] names = {"米饭", "西兰花", "鸡肉", "土豆", "红辣椒", "蒜", "葱花", "黑木耳", "黑胡椒", "盐", "酱油", "醋", "辣椒油", "花生酱", "芝麻酱", "辣椒粉", "辣椒", "花椒", "姜", "蒜", "葱花", "黑胡椒", "盐", "酱油", "醋", "辣椒油", "花生酱", "芝麻酱", "辣椒粉", "辣椒", "花椒", "姜", "蒜", "葱花", "黑胡椒", "盐", "酱油", "醋", "辣椒油", "花生酱", "芝麻酱"};
        StringBuilder response = new StringBuilder();
        String firstIssue = "";
        int firstItem = 0;
        for (int i = 0; i < names.length; i++) {
            response.append(i + 1).append(". ").append(names[i]).append('\n');
            if (firstIssue.isEmpty() && !OfflineVisionPolicy.outputIssue(response.toString()).isEmpty()) {
                firstIssue = OfflineVisionPolicy.outputIssue(response.toString()); firstItem = i + 1;
            }
        }
        assertEquals("list_limit", firstIssue); assertEquals(7, firstItem);
        assertEquals("repetition", OfflineVisionPolicy.outputIssue(response.toString()));
    }
    @Test public void legitimateQuantitiesAndSharedUnitsDoNotLookLikeRepeatedFoods() {
        assertEquals("", OfflineVisionPolicy.outputIssue("1. 鸡蛋1个\n2. 馒头1个\n3. 苹果1个\n4. 橙子1个\n5. 梨1个\n6. 土豆1个"));
        assertEquals("", OfflineVisionPolicy.outputIssue("米饭1碗\n西兰花数量不确定\n鸡肉数量不确定"));
        assertEquals("", OfflineVisionPolicy.outputIssue("看不清，无法确定食物。"));
    }
    @Test public void alternatingRepeatedFoodNamesAreAlsoDetected() {
        assertEquals("repetition", OfflineVisionPolicy.outputIssue("1. 米饭\n2. 鸡蛋\n3. 米饭\n4. 鸡蛋\n5. 米饭\n6. 鸡蛋"));
    }
    @Test public void overlongBulletListStopsButEmptySeventhPrefixDoesNot() {
        String firstSix = "- 鸡蛋\n- 米饭\n- 西兰花\n- 鸡肉\n- 土豆\n- 胡萝卜\n";
        assertEquals("", OfflineVisionPolicy.outputIssue(firstSix + "- "));
        assertEquals("list_limit", OfflineVisionPolicy.outputIssue(firstSix + "- 牛奶"));
    }
}
