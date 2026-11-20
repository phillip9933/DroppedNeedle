package app.droppedneedle.mobile;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final DownloadNotificationRoute downloads = new DownloadNotificationRoute();
    private boolean creating;

    @Override
    public void onCreate(Bundle state) {
        downloads.restore(this, getIntent(), state);
        creating = true;
        registerPlugin(DNPlayerPlugin.class);
        registerPlugin(DNOfflinePlugin.class);
        registerPlugin(DNPlaylistExportPlugin.class);
        registerPlugin(DNAppearancePlugin.class);
        registerPlugin(DNDrawerPlugin.class);
        super.onCreate(state);
        creating = false;
    }

    @Override protected void onNewIntent(Intent intent) {
        // BridgeActivity also dispatches the launch intent here while creating its bridge.
        if (!creating && downloads.receive(this, intent) && getBridge() != null)
            getBridge().triggerWindowJSEvent("dn-download-notification");
        super.onNewIntent(intent);
    }
    @Override public void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        downloads.save(state);
    }
    boolean takeDownloadNotification() { return downloads.take(); }
}
