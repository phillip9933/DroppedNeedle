package app.droppedneedle.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(DNPlayerPlugin.class);
        registerPlugin(DNOfflinePlugin.class);
        registerPlugin(DNAppearancePlugin.class);
        registerPlugin(DNDrawerPlugin.class);
        super.onCreate(state);
    }
}
