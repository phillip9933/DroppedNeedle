package app.droppedneedle.mobile;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DNAppearance")
public class DNAppearancePlugin extends Plugin {
    private Integer background;

    @PluginMethod
    public void setBackground(PluginCall call) {
        String hex = call.getString("color");
        if (hex == null || !hex.matches("#[a-fA-F0-9]{6}")) {
            call.reject("Expected a six-digit background color.");
            return;
        }
        int color = Color.parseColor(hex);
        getActivity().runOnUiThread(() -> {
            background = color;
            applyBackground();
            call.resolve();
        });
    }
    @Override
    protected void handleOnConfigurationChanged(Configuration config) {
        super.handleOnConfigurationChanged(config);
        // Core SystemBars reapplies its colors synchronously on rotation and UI-mode changes.
        getActivity().getWindow().getDecorView().post(this::applyBackground);
    }

    private void applyBackground() {
        if (background == null) return;
        Window window = getActivity().getWindow();
        // On older WebViews, Capacitor applies system insets to decor outside the HTML.
        window.getDecorView().setBackgroundColor(background);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.setStatusBarColor(background);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) window.setNavigationBarColor(background);
        }
    }

}
