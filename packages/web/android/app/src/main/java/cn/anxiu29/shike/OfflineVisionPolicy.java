package cn.anxiu29.shike;

import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

final class OfflineVisionPolicy {
    private static final Pattern ITEM = Pattern.compile("(?m)^[ \\t]*(?:[0-9]{1,3}[.、．)）]|[-*•])[ \\t]*\\S");
    private static final Pattern PREFIX = Pattern.compile("^[ \\t]*(?:[0-9]{1,3}[.、．)）]|[-*•])[ \\t]*");
    private static final Pattern SEPARATORS = Pattern.compile("[\\s\\p{P}\\p{N}]+");

    /** 保留原始输出，只在明显循环/过长时停止；不靠去重把异常答案伪装成成功。 */
    static String outputIssue(String output) {
        String compact = SEPARATORS.matcher(output).replaceAll("");
        for (int size = 2; size <= Math.min(80, compact.length() / 4); size++) {
            int end = compact.length();
            String suffix = compact.substring(end - size);
            if (compact.regionMatches(end - size * 2, suffix, 0, size)
                && compact.regionMatches(end - size * 3, suffix, 0, size)
                && compact.regionMatches(end - size * 4, suffix, 0, size)) return "repetition";
        }
        Set<String> names = new HashSet<>();
        int duplicates = 0;
        for (String line : output.split("\\R")) {
            String name = SEPARATORS.matcher(PREFIX.matcher(line).replaceFirst("")).replaceAll("");
            if (!name.isEmpty() && !names.add(name) && ++duplicates >= 3) return "repetition";
        }
        var items = ITEM.matcher(output);
        int count = 0;
        while (items.find()) if (++count > 6) return "list_limit";
        return "";
    }
    static String stopMessage(String reason) {
        return reason.equals("repetition") ? "检测到循环重复，已停止生成。以下为停止前的原始片段，不能作为完整识别结果。"
            : "清单超过6项，已停止生成。回答可能含推测内容，请核对后重新选图或简化问题。";
    }
    /** 使用线性扫描，避免对兆字节图片使用重复分组正则引发栈溢出。 */
    static boolean validImageBase64(String value) {
        int length = value.length();
        if (length == 0 || length > 1_398_104 || length % 4 != 0) return false;
        int end = length;
        if (value.charAt(end - 1) == '=') end--;
        if (value.charAt(end - 1) == '=') end--;
        for (int i = 0; i < end; i++) {
            char c = value.charAt(i);
            if (!(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/')) return false;
        }
        return true;
    }
}
