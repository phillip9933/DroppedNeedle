package app.droppedneedle.mobile;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioRouting;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Looper;
import android.os.Handler;
import android.content.SharedPreferences;
import android.media.audiofx.AudioEffect;
import android.media.audiofx.Equalizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Device-local EQ attached only to the audio session owned by this playback service. */
final class PlaybackEqualizer {
    private final SharedPreferences preferences;
    private int session;
    private Equalizer effect;
    private AudioTrack routeTrack;
    private String outputId = "", outputName = "";
    private boolean closed;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioRouting.OnRoutingChangedListener routeListener = source -> {
        if (source == routeTrack) readRoute();
    };

    PlaybackEqualizer(Context context) {
        preferences = context.getSharedPreferences("dn_playback_equalizer", Context.MODE_PRIVATE);
    }

    void monitor(AudioTrack track) {
        if (closed || routeTrack == track)
            return;
        if (routeTrack != null)
            routeTrack.removeOnRoutingChangedListener(routeListener);
        routeTrack = track;
        routeTrack.addOnRoutingChangedListener(routeListener, main);
        readRoute();
    }

    private void readRoute() {
        if (routeTrack == null)
            return;
        AudioDeviceInfo device = routeTrack.getRoutedDevice();
        if (device == null)
            return; // AudioTrack reports its actual route once output has started.
        String name = device.getProductName() == null ? "" : device.getProductName().toString();
        String address = "";
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                address = device.getAddress();
            } catch (
                    SecurityException unavailable) { /* Use the product name when Android withholds its address. */
            }
        }
        String id = java.util.UUID
                            .nameUUIDFromBytes((device.getType() + ":" + (address.isEmpty() ? name : address))
                                            .getBytes(java.nio.charset.StandardCharsets.UTF_8))
                            .toString();
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                name = "Phone speaker";
                break;
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                name = "Phone earpiece";
                break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                name = "Wired headphones";
                break;
        }
        route(id, name.isEmpty() ? "Audio output" : name);
    }

    void describeOutput(JSObject result) {
        // Asking for the signal path must never attach an effect or change playback.
        if (effect == null) result.put("equalizer", false);
        else try {
            if (effect.hasControl()) result.put("equalizer", effect.getEnabled());
        } catch (RuntimeException unavailable) { /* The audio session may have already closed. */ }
        AudioTrack track = routeTrack;
        if (track == null || track.getState() == AudioTrack.STATE_UNINITIALIZED) return;
        try {
            AudioDeviceInfo device = track.getRoutedDevice();
            if (device == null) return;
            int rate = track.getSampleRate();
            if (rate > 0) result.put("outputRate", rate);
            String name = device.getProductName() == null ? "" : device.getProductName().toString();
            if (!name.isEmpty()) result.put("destination", name);
            switch (device.getType()) {
                case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: result.put("route", "speaker"); break;
                case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: result.put("route", "earpiece"); break;
                case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: result.put("route", "wired"); break;
                case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                case AudioDeviceInfo.TYPE_BLE_HEADSET:
                case AudioDeviceInfo.TYPE_BLE_SPEAKER: result.put("route", "bluetooth"); break;
                case AudioDeviceInfo.TYPE_USB_DEVICE:
                case AudioDeviceInfo.TYPE_USB_ACCESSORY:
                case AudioDeviceInfo.TYPE_USB_HEADSET: result.put("route", "usb"); break;
                case AudioDeviceInfo.TYPE_HDMI:
                case AudioDeviceInfo.TYPE_HDMI_ARC:
                case AudioDeviceInfo.TYPE_HDMI_EARC: result.put("route", "hdmi"); break;
            }
        } catch (RuntimeException unavailable) { /* Device was detached between the two reads. */ }
    }
    void route(String id, String name) {
        if (id.equals(outputId))
            return;
        outputId = id;
        outputName = name;
        if (effect != null && effect.hasControl())
            restore();
        else if (preferences.getBoolean(key("enabled"), false))
            attach();
    }
    private boolean assigned() { return !outputId.isEmpty() && preferences.contains(outputId + ".curve"); }
    private String key(String field) { return assigned() ? outputId + "." + field : field; }
    private void verifyOutput(String expected) {
        if (expected != null && !expected.equals(outputId)) throw new IllegalArgumentException("The active audio output changed.");
    }

    JSObject assign(String expected, boolean enable) {
        if (expected == null || expected.isEmpty())
            throw new IllegalArgumentException("Choose an active audio output.");
        verifyOutput(expected);
        if (enable != assigned()) {
            SharedPreferences.Editor edit = preferences.edit();
            for (String field : new String[] {"enabled", "curve", "preset"}) {
                if (!enable)
                    edit.remove(outputId + "." + field);
                else if (field.equals("enabled"))
                    edit.putBoolean(outputId + ".enabled", preferences.getBoolean("enabled", false));
                else
                    edit.putString(outputId + "." + field,
                            preferences.getString(field, field.equals("preset") ? "Flat" : "{}"));
            }
            edit.apply();
            if (effect != null && effect.hasControl())
                restore();
        }
        return read();
    }
    void close() {
        closed = true;
        if (routeTrack != null)
            routeTrack.removeOnRoutingChangedListener(routeListener);
        routeTrack = null;
        release();
    }
    void setSession(int next) {
        if (session == next) return;
        release();
        session = next;
        if (preferences.getBoolean(key("enabled"), false)) attach();
    }

    void release() {
        if (effect != null) {
            effect.release();
            effect = null;
        }
        session = 0;
    }

    private void attach() {
        if (session <= 0 || effect != null) return;
        try {
            effect = new Equalizer(0, session);
            effect.setControlStatusListener((ignored, granted) -> {
                if (granted && effect == ignored) restore();
            });
            if (effect.hasControl()) restore();
        } catch (RuntimeException error) {
            discardEffect();
        }
    }

    private void discardEffect() {
        if (effect != null) effect.release();
        effect = null;
    }

    private void restore() {
        try {
            JSONObject curve = new JSONObject(preferences.getString(key("curve"), "{}"));
            short[] range = effect.getBandLevelRange();
            for (short i = 0; i < effect.getNumberOfBands(); i++) {
                int stored = curve.optInt(Integer.toString(effect.getCenterFreq(i)), 0);
                effect.setBandLevel(i, (short) Math.max(range[0], Math.min(range[1], stored)));
            }
            if (effect.setEnabled(preferences.getBoolean(key("enabled"), false)) != AudioEffect.SUCCESS)
                discardEffect();
        } catch (RuntimeException | JSONException error) {
            discardEffect();
        }
    }

    private JSObject unavailable(String reason) {
        JSObject result = new JSObject();
        result.put("available", false);
        result.put("reason", reason);
        return result;
    }

    JSObject read() {
        attach();
        if (effect == null) return unavailable("This audio output does not provide an equalizer for DroppedNeedle.");
        try {
            if (!effect.hasControl()) return unavailable("Another audio effect controls the equalizer on this output.");
            short count = effect.getNumberOfBands();
            short[] range = effect.getBandLevelRange();
            if (count <= 0 || range[0] >= range[1]) return unavailable("This audio output has no adjustable bands.");
            JSArray centers = new JSArray(), levels = new JSArray();
            for (short i = 0; i < count; i++) {
                centers.put(effect.getCenterFreq(i)); // milliHertz, as defined by the platform API
                levels.put((int) effect.getBandLevel(i)); // milliBels
            }
            JSObject result = new JSObject();
            result.put("available", true);
            result.put("enabled", effect.getEnabled());
            result.put("centers", centers);
            result.put("levels", levels);
            result.put("minimum", (int) range[0]);
            result.put("maximum", (int) range[1]);
            result.put("preset", preferences.getString(key("preset"), "Flat"));
            if (!outputId.isEmpty()) {
                JSObject output=new JSObject();
                output.put("id",outputId); output.put("name",outputName); output.put("assigned",assigned());
                result.put("output",output);
            }
            return result;
        } catch (RuntimeException error) {
            discardEffect();
            return unavailable("The equalizer is unavailable on the current audio output.");
        }
    }

    JSObject configure(boolean enabled, String preset, JSONArray centers, JSONArray levels) throws JSONException {
        return configure(enabled,preset,centers,levels,null);
    }

    JSObject configure(boolean enabled,String preset,JSONArray centers,JSONArray levels,String expected) throws JSONException {
        verifyOutput(expected);
        JSObject current = read();
        if (!current.getBoolean("available")) return current;
        short count = effect.getNumberOfBands();
        short[] range = effect.getBandLevelRange();
        short[] before = new short[count], desired = new short[count];
        boolean wasEnabled = effect.getEnabled();
        if (centers == null || levels == null || centers.length() != count || levels.length() != count)
            throw new IllegalArgumentException("The output bands changed.");
        JSONObject curve = new JSONObject();
        for (short i = 0; i < count; i++) {
            int center = effect.getCenterFreq(i), level = levels.getInt(i);
            if (centers.getInt(i) != center || level < range[0] || level > range[1])
                throw new IllegalArgumentException("The output band range changed.");
            before[i] = effect.getBandLevel(i);
            desired[i] = (short) level;
            curve.put(Integer.toString(center), level);
        }
        try {
            for (short i = 0; i < count; i++) {
                if (desired[i] != before[i]) effect.setBandLevel(i, desired[i]);
            }
            if (enabled != wasEnabled && effect.setEnabled(enabled) != AudioEffect.SUCCESS)
                throw new IllegalStateException("Could not switch the equalizer.");
        } catch (RuntimeException error) {
            // Undo any partial band writes by restoring the last committed curve.
            if (effect != null && effect.hasControl()) restore();
            throw error;
        }
        preferences.edit().putBoolean(key("enabled"), enabled).putString(key("curve"), curve.toString())
                .putString(key("preset"), preset == null ? "" : preset).apply();
        return read();
    }
}
