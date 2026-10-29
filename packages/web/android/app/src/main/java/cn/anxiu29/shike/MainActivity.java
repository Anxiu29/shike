package cn.anxiu29.shike;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PersonalVisionPlugin.class);
        registerPlugin(FoodCatalogPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(OfflineAiPlugin.class);
        registerPlugin(OfflineVisionPlugin.class);
        registerPlugin(SystemPhotoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
