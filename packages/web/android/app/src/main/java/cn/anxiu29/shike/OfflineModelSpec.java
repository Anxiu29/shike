package cn.anxiu29.shike;

/** 两个固定模型互不覆盖；视觉版身份来自转换仓库的固定版本manifest。 */
final class OfflineModelSpec {
    static final OfflineModelSpec TEXT = new OfflineModelSpec("offline-ai", OfflineModelPolicy.FILE, OfflineModelPolicy.BYTES, OfflineModelPolicy.SHA256, OfflineModelPolicy.URL, false);
    static final String VISION_REVISION = "ff11c109e8e56797cd1ee5befa856975bb465afc";
    static final OfflineModelSpec VISION = new OfflineModelSpec("offline-vision", "Qwen3.5-0.8B-VL_int8.litertlm", 1_303_671_472L,
        "1ab56460263fe94fde5fec160363d3aacbae9c5ee3638121c11feb51e483e29d",
        "https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/" + VISION_REVISION + "/Qwen3.5-0.8B-VL_int8.litertlm", true);
    // 规格作为不可变身份一起传递；仅更改文件名不能使另一份权重成为可用模型。
    // directory 同时隔离正式文件、续传片段和运行缓存，避免文字/视觉两种任务互相覆盖。
    final String directory, file, sha256, url;
    final long bytes;
    final boolean vision;
    private OfflineModelSpec(String directory, String file, long bytes, String sha256, String url, boolean vision) {
        this.directory = directory; this.file = file; this.bytes = bytes; this.sha256 = sha256; this.url = url; this.vision = vision;
    }
}
