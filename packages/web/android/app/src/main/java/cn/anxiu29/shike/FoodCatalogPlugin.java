package cn.anxiu29.shike;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** 免费只读商品查询：固定域名、无Key、禁止重定向，不上传照片或个人资料。 */
@CapacitorPlugin(name = "FoodCatalog")
public class FoodCatalogPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private long previous = 0;
    private static final String FIELDS = "code,product_name,product_name_zh,brands,product_quantity,product_quantity_unit,quantity,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments";
    /**
     * 只接受标准位数条码，拼到固定商品库地址；调用入口限频，网络与有界正文读取交给 worker。
     * 原生只返回原 JSON，商品字段与营养单位仍由共享层验证，HTTP 成功不能等同于数据可靠。
     */
    @PluginMethod public void lookup(PluginCall call) {
        String code = call.getString("barcode", "");
        if (!code.matches("(?:\\d{8}|\\d{12}|\\d{13}|\\d{14})")) { call.reject("商品条码格式无效。"); return; }
        synchronized (this) { long now = android.os.SystemClock.elapsedRealtime(); if (previous > 0 && now - previous < 4000) { call.reject("请间隔4秒后再查询免费商品库。"); return; } previous = now; }
        worker.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) new URL("https://world.openfoodfacts.org/api/v3.6/product/" + code + ".json?fields=" + FIELDS).openConnection();
                connection.setConnectTimeout(8000); connection.setReadTimeout(8000); connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("User-Agent", "Shike/0.7.0 (https://github.com/Anxiu29/shike)");
                int status = connection.getResponseCode();
                if (status == 429) { call.reject("免费商品库暂时限流，请稍后重试。"); return; }
                if (status != 200 && status != 404) { call.reject("免费商品库暂时不可用，可拍营养表或手动填写。"); return; }
                // 保留404原JSON供共享校验区分未收录与接口异常，不能将所有404伪装为没收录。
                try (InputStream stream = status == 404 ? connection.getErrorStream() : connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096]; int count;
                    while ((count = stream.read(buffer)) != -1) { if (out.size() + count > 262144) throw new Exception("oversize"); out.write(buffer, 0, count); }
                    call.resolve(new JSObject().put("data", out.toString(StandardCharsets.UTF_8.name())));
                }
            } catch (Exception error) { call.reject("商品库连接失败，请稍后重试；本地记录仍可使用。"); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
