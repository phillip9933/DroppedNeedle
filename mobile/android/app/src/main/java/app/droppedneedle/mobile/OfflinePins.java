package app.droppedneedle.mobile;

import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Arrays;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Stored collection definitions contain identifiers and filter values, never URLs or credentials. */
final class OfflinePins {
    static final String SOURCE = "pinnedCollections";
    private static final Set<String> FILTERS = new HashSet<>(
            Arrays.asList("q", "sort", "order", "favorites", "rating", "rating_mode", "formats", "format_mode"));

    private static final Set<String> KINDS =
            new HashSet<>(Arrays.asList("recent", "favorites", "playlist", "artist", "filter"));
    private static final Set<String> GROUPS = new HashSet<>(Arrays.asList("songs", "albums", "artists"));

    static JSONArray validate(JSONArray pins) throws JSONException {
        JSONArray clean = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < pins.length(); i++) {
            JSONObject pin = pins.getJSONObject(i);
            String kind = pin.getString("kind"), id = pin.getString("id"), name = pin.getString("name");
            if (!KINDS.contains(kind) || id.isEmpty() || id.length() > 256 || id.equals(".") || id.equals("..")
                    || id.chars().anyMatch(Character::isISOControl) || name.trim().isEmpty() || name.length() > 512)
                throw new JSONException("Choose a valid offline collection.");
            if ((kind.equals("recent") || kind.equals("favorites")) && !kind.equals(id))
                throw new JSONException("Invalid collection.");
            if (!seen.add(kind + "\n" + id))
                continue;
            JSONObject copy = new JSONObject().put("kind", kind).put("id", id).put("name", name);
            if (kind.equals("filter")) {
                String group = pin.getString("group");
                if (!GROUPS.contains(group))
                    throw new JSONException("Invalid library filter.");
                JSONObject safe = new JSONObject(), filters = pin.getJSONObject("filters");
                for (Iterator<String> keys = filters.keys(); keys.hasNext();) {
                    String key = keys.next();
                    Object value = filters.get(key);
                    if (!FILTERS.contains(key) || !(value instanceof String) || ((String) value).length() > 4096)
                        throw new JSONException("Invalid library filter.");
                    safe.put(key, value);
                }
                copy.put("group", group).put("filters", safe);
            }
            clean.put(copy);
        }
        return clean;
    }

    static JSONArray effective(String legacy, JSONArray extra) throws JSONException {
        JSONArray all = new JSONArray();
        if (OfflineStore.enabledSource(legacy)) {
            String id = legacy, kind = legacy, name = "recent".equals(kind) ? "Recently added" : "Favorites";
            if (legacy.startsWith("playlist:")) {
                kind = "playlist";
                id = new String(
                        Base64.decode(legacy.substring(9), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING),
                        StandardCharsets.UTF_8);
                name = "DN playlist";
            }
            all.put(new JSONObject().put("kind", kind).put("id", id).put("name", name));
        }
        for (int i = 0; i < extra.length(); i++) all.put(extra.getJSONObject(i));
        return validate(all);
    }
}
