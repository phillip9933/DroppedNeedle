package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** An atomic directory of the phone's last completed, session-encrypted match lists. */
final class CarSmartPlaylists {
    private final HeadsetAccount owner;
    private final SharedPreferences prefs;
    private final SmartQueueStore pages;

    CarSmartPlaylists(Context app, HeadsetAccount owner) {
        this.owner = owner;
        prefs = app.getSharedPreferences("dn-car-smart-" + PlaylistShortcut.account(owner), Context.MODE_PRIVATE);
        pages = new SmartQueueStore(app);
    }

    private JSONObject directory() throws JSONException {
        return new JSONObject(prefs.getString("lists", "{}"));
    }
    private boolean currentSession() {
        return OfflineStore.digest(owner.token).equals(prefs.getString("session", ""));
    }
    JSONArray lists() throws JSONException {
        JSONArray all = new JSONArray();
        if (!currentSession()) return all;
        JSONObject lists = directory();
        for (java.util.Iterator<String> i = lists.keys(); i.hasNext();) all.put(lists.getJSONObject(i.next()));
        return all;
    }

    // All index writers run on SavedQueue's serial worker. Pages stay readable while replaced.
    JSONObject replace(JSONArray definitions) throws JSONException, IOException {
        JSONObject previous = directory(), next = new JSONObject(), times = new JSONObject();
        boolean sameSession = currentSession();
        List<String> retired = new ArrayList<>();
        for (int i = 0; i < definitions.length(); i++) {
            JSONObject def = definitions.getJSONObject(i);
            String id = def.getString("id"), name = def.getString("name"), rules = def.getString("definition");
            if (!id.matches("smart-[a-zA-Z0-9-]{1,64}") || name.trim().isEmpty() || name.length() > 64 || rules.isEmpty())
                throw new IOException("Invalid smart playlist.");
            JSONObject old = previous.optJSONObject(id);
            if (sameSession && old != null && rules.equals(old.getString("definition"))) {
                next.put(id, old.put("name", name));
                times.put(id, old.optLong("completedAt"));
                previous.remove(id);
            } else next.put(id, new JSONObject().put("id", id).put("name", name).put("definition", rules));
        }
        for (java.util.Iterator<String> i = previous.keys(); i.hasNext();) retired.add(previous.getJSONObject(i.next()).optString("snapshot"));
        if (!prefs.edit().putString("lists", next.toString()).putString("session", OfflineStore.digest(owner.token)).commit())
            throw new IOException("Could not update car playlists.");
        for (String snapshot : retired) pages.releaseCar(snapshot);
        return times;
    }

    void publish(String id, String definition, String snapshot, int total, long completedAt)
            throws JSONException, IOException, GeneralSecurityException {
        JSONObject lists = directory(), item = lists.optJSONObject(id);
        if (!currentSession() || item == null || !item.getString("definition").equals(definition)
                || completedAt < item.optLong("completedAt") || total < 0 || total > SmartQueueStore.MAX)
            throw new IOException("Playlist changed while updating.");
        if (total > 0) {
            pages.carPage(owner, snapshot, (total - 1) / LibraryWindow.PAGE * LibraryWindow.PAGE, total);
            pages.retainCar(snapshot);
        }
        String old = item.optString("snapshot");
        item.put("snapshot", total == 0 ? "" : snapshot).put("total", total).put("completedAt", completedAt);
        if (!prefs.edit().putString("lists", lists.toString()).commit()) {
            if (!old.equals(snapshot)) pages.releaseCar(snapshot);
            throw new IOException("Could not save car playlist matches.");
        }
        if (!old.equals(snapshot)) pages.releaseCar(old);
    }
    JSONObject get(String id) throws JSONException, IOException {
        JSONObject list = currentSession() && id != null ? directory().optJSONObject(id) : null;
        if (list == null) throw new IOException("Unknown car playlist.");
        return list;
    }
    JSONArray page(JSONObject list, int offset) throws IOException, JSONException {
        int total = list.optInt("total");
        if (offset == 0 && total == 0) return new JSONArray();
        if (offset < 0 || offset >= total || offset % LibraryWindow.PAGE != 0) throw new IOException("Invalid car playlist page.");
        try { return pages.carPage(owner, list.getString("snapshot"), offset, total); }
        catch (GeneralSecurityException failure) { throw new IOException("Playlist needs to sync.", failure); }
    }
}
