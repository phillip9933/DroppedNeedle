package app.droppedneedle.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Pinned intents contain an opaque device handle. Resolve it only against the current DN account. */
final class PlaylistShortcut {
    static final String ACTION = "app.droppedneedle.mobile.OPEN_PINNED_PLAYLIST";
    private static final String EXTRA = "dn.playlist.handle";
    private String pending;
    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences("dn-launcher-playlists", Context.MODE_PRIVATE);
    }
    static boolean valid(String id) {
        return id != null && id.length() <= 320 && (id.startsWith("playlist:") && id.length() > 9
                || id.matches("smart:smart-[a-zA-Z0-9-]{1,64}")) && id.chars().noneMatch(Character::isISOControl);
    }
    static String account(HeadsetAccount owner) { return OfflineStore.digest(owner.server + "\n" + owner.userId); }
    static boolean pin(Context context, HeadsetAccount owner, String id, String name) throws JSONException {
        if (Build.VERSION.SDK_INT < 26 || !valid(id) || name == null || name.trim().isEmpty() || name.length() > 512) return false;
        ShortcutManager manager = context.getSystemService(ShortcutManager.class);
        if (manager == null || !manager.isRequestPinShortcutSupported()) return false;
        String domain = account(owner), key = "playlist-" + OfflineStore.digest(domain + "\n" + id);
        SharedPreferences prefs = store(context);
        String handle = prefs.getString(key, null);
        if (handle == null) handle = UUID.randomUUID().toString();
        String entry = new JSONObject().put("scope", domain).put("id", id).toString();
        if (!prefs.edit().putString(key, handle).putString(handle, entry).commit()) return false;
        Intent launch = new Intent(context, MainActivity.class).setAction(ACTION).putExtra(EXTRA, handle)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        ShortcutInfo info = new ShortcutInfo.Builder(context, key).setShortLabel(name)
                .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher)).setIntent(launch).build();
        return manager.requestPinShortcut(info, null);
    }
    synchronized boolean receive(Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction()) || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        String handle = intent.getStringExtra(EXTRA);
        if (handle == null || !handle.matches("[0-9a-f-]{36}")) return false;
        pending = handle;
        return true;
    }
    synchronized void restore(Intent intent, Bundle state) {
        if (state == null) receive(intent); else pending = state.getString(EXTRA);
    }
    synchronized void save(Bundle state) { state.putString(EXTRA, pending); }
    synchronized String take(Context context, HeadsetAccount owner) {
        String handle = pending; pending = null;
        if (handle == null) return null;
        try {
            JSONObject item = new JSONObject(store(context).getString(handle, "{}"));
            String id = item.optString("id");
            return account(owner).equals(item.optString("scope")) && valid(id) ? id : null;
        } catch (JSONException ignore) { return null; }
    }
}
