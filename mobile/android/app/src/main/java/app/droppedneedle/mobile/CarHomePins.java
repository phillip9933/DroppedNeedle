package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Media3 may start before the WebView. Store pin metadata under the active DN server and listener. */
final class CarHomePins {
    private final SharedPreferences prefs;
    CarHomePins(Context app, HeadsetAccount owner) {
        prefs = app.getSharedPreferences("dn-car-home-" + PlaylistShortcut.account(owner), Context.MODE_PRIVATE);
    }
    void replace(JSONArray rows) throws JSONException {
        if (rows == null) throw new JSONException("Missing pins.");
        SharedPreferences.Editor edit = prefs.edit();
        java.util.Set<String> retained = new java.util.HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject pin = rows.getJSONObject(i);
            if (pin.getString("title").isEmpty() || pin.getString("id").isEmpty())
                throw new JSONException("Invalid pin.");
            if (pin.has("plan")) retained.add(planKey(pin));
        }
        for (String key : prefs.getAll().keySet())
            if (key.startsWith("plan-") && !retained.contains(key)) edit.remove(key);
        edit.putString("pins", rows.toString()).apply();
    }
    JSONArray list() throws JSONException { return new JSONArray(prefs.getString("pins", "[]")); }
    static String handle(JSONObject pin) {
        return OfflineStore.digest(pin.optString("kind") + "\n" + pin.optString("stationType") + "\n" + pin.optString("id"));
    }
    JSONObject find(String id) throws JSONException, IOException {
        JSONArray pins = list();
        for (int i = 0; i < pins.length(); i++)
            if (handle(pins.getJSONObject(i)).equals(id)) return pins.getJSONObject(i);
        throw new IOException("This pin is no longer on Home.");
    }
    private static String planKey(JSONObject pin) {
        return "plan-" + OfflineStore.digest(handle(pin) + "\n" + pin.optJSONObject("plan"));
    }
    JSONArray lastPlan(JSONObject pin) throws JSONException {
        JSONArray songs = pin.optJSONArray("songs");
        return songs != null && songs.length() > 0 ? songs : new JSONArray(prefs.getString(planKey(pin), "[]"));
    }
    JSONArray savePlan(JSONObject pin, JSONArray rows) throws JSONException {
        JSONArray songs = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String id = row.isNull("local_file_id") ? null : row.optString("local_file_id");
            if (!row.optBoolean("in_library") || !OfflineStore.validTrackId(id) || !seen.add(id)) continue;
            songs.put(new JSONObject().put("id", id).put("title", row.getString("track_name"))
                    .put("artist", row.optString("artist_name")).put("album", row.isNull("album_name") ? "" : row.optString("album_name")));
        }
        if (songs.length() > 0) prefs.edit().putString(planKey(pin), songs.toString()).apply();
        return songs;
    }
    static Map<String, JSONObject> saved(JSONArray items) throws JSONException {
        Map<String, JSONObject> byId = new LinkedHashMap<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject track = items.getJSONObject(i).getJSONObject("track");
            byId.put(track.getString("id"), track);
        }
        return byId;
    }
    List<JSONObject> offline(JSONObject pin, Map<String, JSONObject> saved) throws JSONException {
        String kind = pin.getString("kind"), id = pin.getString("id");
        List<JSONObject> result = new ArrayList<>();
        JSONArray ids = "playlist".equals(kind) ? pin.optJSONArray("playlistIds") : null;
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) if (saved.containsKey(ids.optString(i))) result.add(saved.get(ids.optString(i)));
            return result;
        }
        if ("station".equals(kind) || "mix".equals(kind)) {
            JSONArray plan = lastPlan(pin);
            for (int i = 0; i < plan.length(); i++) {
                JSONObject t = saved.get(plan.getJSONObject(i).optString("id"));
                if (t != null) result.add(t);
            }
            if (!result.isEmpty()) return result;
            if ("station".equals(kind)) kind = pin.optString("stationType");
        }
        for (JSONObject t : saved.values()) {
            String local = pin.optString("localId", id), mbid = pin.optString("mbid", id);
            boolean include = false;
            switch (kind) {
                case "track": include = id.equals(t.optString("id")); break;
                case "album": include = local.equals(t.optString("albumId")) || mbid.equals(t.optString("releaseGroupMbid")); break;
                case "artist": include = local.equals(t.optString("artistId")) || local.equals(t.optString("albumArtistId"))
                    || mbid.equals(t.optString("artistMbid")); break;
                case "genre": include = id.equalsIgnoreCase(t.optString("genre")); break;
                case "mix":
                    JSONObject plan = pin.optJSONObject("plan");
                    JSONArray seeds = plan == null ? null : plan.optJSONArray("items");
                    for (int i = 0; seeds != null && i < seeds.length() && !include; i++) {
                        JSONObject item = seeds.getJSONObject(i);
                        include = item.has("album_mbid") ? item.optString("album_mbid").equals(t.optString("releaseGroupMbid"))
                            : item.optString("artist_mbid").equals(t.optString("artistMbid"));
                    }
                    break;
                default: break;
            }
            if (include) result.add(t);
        }
        return result;
    }
}
