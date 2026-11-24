package app.droppedneedle.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DNLauncher")
public class DNLauncherPlugin extends Plugin {
    private HeadsetAccount current(PluginCall call) {
        HeadsetAccount owner = HeadsetAccount.read(getContext());
        okhttp3.HttpUrl server = okhttp3.HttpUrl.parse(call.getString("serverUrl", ""));
        if (owner != null && owner.server.equals(server) && owner.userId.equals(call.getString("userId"))) return owner;
        return null;
    }
    @PluginMethod public void takeSharedSong(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject reply = new JSObject();
            if (getActivity() instanceof MainActivity activity) reply.put("text", activity.takeSharedSong());
            call.resolve(reply);
        });
    }
    @PluginMethod public void takePlayerNotification(PluginCall call) {
        boolean open = getActivity() instanceof MainActivity activity
                && activity.notifications.take(NotificationRoute.Destination.PLAYER);
        call.resolve(new JSObject().put("open", open));
    }
    @PluginMethod public void pinPlaylist(PluginCall call) {
        HeadsetAccount owner = current(call);
        if (owner == null) { call.reject("Connect your DroppedNeedle account in OtoHari first."); return; }
        try {
            if (!PlaylistShortcut.pin(getActivity(), owner, call.getString("id"), call.getString("name")))
                call.reject("This launcher could not pin the playlist.");
            else call.resolve();
        } catch (Exception invalid) { call.reject("Could not pin this playlist."); }
    }
    @PluginMethod public void takePlaylist(PluginCall call) {
        HeadsetAccount owner = current(call);
        JSObject reply = new JSObject();
        if (owner != null) reply.put("id", ((MainActivity)getActivity()).shortcuts.take(getContext(), owner));
        call.resolve(reply);
    }
    @PluginMethod public void carPlaylistIndex(PluginCall call) {
        SavedQueue.io(() -> {
            HeadsetAccount owner = current(call);
            if (owner == null) { call.reject("Connect your DroppedNeedle account in OtoHari first."); return; }
            try {
                call.resolve(new JSObject().put("completed", new CarSmartPlaylists(getContext(), owner)
                        .replace(call.getArray("lists"))));
            } catch (Exception error) { call.reject("Could not update car playlists.", error); }
        });
    }
    @PluginMethod public void carPlaylistReady(PluginCall call) {
        SavedQueue.io(() -> {
            HeadsetAccount owner = current(call);
            if (owner == null) { call.reject("Connect your DroppedNeedle account in OtoHari first."); return; }
            try {
                new CarSmartPlaylists(getContext(), owner).publish(call.getString("id"), call.getString("definition"),
                        call.getString("snapshot"), call.getInt("total", -1), call.getData().getLong("completedAt"));
                call.resolve();
            } catch (Exception error) { call.reject("Could not save car playlist.", error); }
        });
    }
    @PluginMethod public void replaceHomePins(PluginCall call) {
        HeadsetAccount owner = current(call);
        if (owner == null) { call.reject("Connect your DroppedNeedle account in OtoHari first."); return; }
        try {
            new CarHomePins(getContext(), owner).replace(call.getArray("pins"));
            call.resolve();
        } catch (org.json.JSONException invalid) { call.reject("Invalid Home pins."); }
    }
}
