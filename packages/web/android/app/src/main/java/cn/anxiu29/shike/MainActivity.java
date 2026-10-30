package cn.anxiu29.shike;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        // 在 BridgeActivity 建桥前注册项目自定义插件；网页通过插件名调用，不能直接调用任意 Java 方法。
        // 本地 APK 与局域网预览共用宿主，涉及模型/相机/Key 的插件入口各自再检查运行来源。
        registerPlugin(PersonalVisionPlugin.class);
        registerPlugin(FoodCatalogPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(OfflineAiPlugin.class);
        registerPlugin(OfflineVisionPlugin.class);
        registerPlugin(SystemPhotoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
