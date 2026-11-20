package app.droppedneedle.mobile;

import android.content.Context;
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

    PlaybackEqualizer(Context context) {
        preferences = context.getSharedPreferences("dn_playback_equalizer", Context.MODE_PRIVATE);
    }

    void setSession(int next) {
        if (session == next) return;
        release();
        session = next;
        if (preferences.getBoolean("enabled", false)) attach();
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
            JSONObject curve = new JSONObject(preferences.getString("curve", "{}"));
            short[] range = effect.getBandLevelRange();
            for (short i = 0; i < effect.getNumberOfBands(); i++) {
                int stored = curve.optInt(Integer.toString(effect.getCenterFreq(i)), 0);
                effect.setBandLevel(i, (short) Math.max(range[0], Math.min(range[1], stored)));
            }
            if (effect.setEnabled(preferences.getBoolean("enabled", false)) != AudioEffect.SUCCESS)
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
            result.put("preset", preferences.getString("preset", "Flat"));
            return result;
        } catch (RuntimeException error) {
            discardEffect();
            return unavailable("The equalizer is unavailable on the current audio output.");
        }
    }

    JSObject configure(boolean enabled, String preset, JSONArray centers, JSONArray levels) throws JSONException {
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
        preferences.edit().putBoolean("enabled", enabled).putString("curve", curve.toString())
                .putString("preset", preset == null ? "" : preset).apply();
        return read();
    }
}
