package app.droppedneedle.mobile;

import android.content.res.Configuration;
import android.graphics.Color;
import android.content.res.Resources;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;
import com.getcapacitor.JSObject;
import android.os.Build;
import android.view.Window;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DNAppearance")
public class DNAppearancePlugin extends Plugin {
    private Integer background;

    private JSObject language() {
        LocaleListCompat configured = AppCompatDelegate.getApplicationLocales();
        String requested = configured.isEmpty() ? "system" : configured.get(0).getLanguage();
        String system = Resources.getSystem().getConfiguration().getLocales().get(0).getLanguage();
        JSObject result = new JSObject();
        result.put("choice", "ja".equals(requested) || "en".equals(requested) ? requested : "system");
        result.put("effective", "ja".equals("system".equals(requested) ? system : requested) ? "ja" : "en");
        return result;
    }

    @PluginMethod
    public void getLanguage(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(language()));
    }

    @PluginMethod
    public void setLanguage(PluginCall call) {
        String choice = call.getString("choice", "");
        if (!"system".equals(choice) && !"ja".equals(choice) && !"en".equals(choice)) {
            call.reject("Unknown app language.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            LocaleListCompat locales = "system".equals(choice)
                    ? LocaleListCompat.getEmptyLocaleList() : LocaleListCompat.forLanguageTags(choice);
            AppCompatDelegate.setApplicationLocales(locales);
            call.resolve(language());
        });
    }

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
        getBridge().triggerWindowJSEvent("dn-language-change");
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
