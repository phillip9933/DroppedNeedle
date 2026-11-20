package app.droppedneedle.mobile;

import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "DNDrawer")
public final class DNDrawerPlugin extends Plugin {
    private View web;
    private Rect reserved;
    private final View.OnLayoutChangeListener layout = (v, l, t, r, b, ol, ot, or, ob) -> update(true);

    @PluginMethod public void setMenuEdge(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> {
            if (call.getBoolean("enabled", false)) {
                if (web == null) {
                    web = getBridge().getWebView();
                    web.addOnLayoutChangeListener(layout);
                }
                update(true);
            } else clear();
            call.resolve();
        });
    }

    private void update(boolean enabled) {
        if (web == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        float density = web.getResources().getDisplayMetrics().density;
        // The system keeps Back along the rest of the left edge and the entire right edge.
        Rect next = enabled && web.getWidth() > 0 && web.getHeight() > 0
                ? new Rect(0, 0, Math.min(web.getWidth(), Math.round(36 * density)),
                        Math.min(web.getHeight(), Math.round(180 * density))) : null;
        if (java.util.Objects.equals(reserved, next)) return;
        List<Rect> exclusions = new ArrayList<>(web.getSystemGestureExclusionRects());
        if (reserved != null) exclusions.remove(reserved);
        if (next != null) exclusions.add(next);
        web.setSystemGestureExclusionRects(exclusions);
        reserved = next;
    }
    private void clear() {
        if (web == null) return;
        web.removeOnLayoutChangeListener(layout);
        update(false);
        web = null;
    }
    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::clear);
        super.handleOnDestroy();
    }
}
