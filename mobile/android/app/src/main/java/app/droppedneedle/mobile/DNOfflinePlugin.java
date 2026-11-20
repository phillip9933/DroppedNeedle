package app.droppedneedle.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

@CapacitorPlugin(name = "DNOffline")
public final class DNOfflinePlugin extends Plugin {
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final ExecutorService transfers = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient.Builder()
                                              .followRedirects(false)
                                              .followSslRedirects(false)
                                              .callTimeout(10, TimeUnit.MINUTES)
                                              .readTimeout(30, TimeUnit.SECONDS)
                                              .build();

    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final class ChangeEvent implements Runnable {
        final String name;
        boolean posted;
        ChangeEvent(String name) { this.name = name; }
        synchronized void post() { if (!posted) posted = main.postDelayed(this, 100); }
        @Override public synchronized void run() { posted = false; notifyListeners(name, new JSObject()); }
    }
    private final ChangeEvent mediaEvent = new ChangeEvent("mediaChanged"), transferEvent = new ChangeEvent("manualChanged");
    private final Runnable changed = mediaEvent::post;
    private final Runnable manualChanged = transferEvent::post;
    private final Runnable historyChanged = () -> notifyListeners("historyChanged", new JSObject());
    private final ConnectivityManager.NetworkCallback networks = new ConnectivityManager.NetworkCallback() {
        @Override public void onLost(Network network) { transferEvent.post(); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) { transferEvent.post(); }
    };
    @Override public void load() {
        getContext().getSystemService(ConnectivityManager.class).registerDefaultNetworkCallback(networks);
        OfflineStore.mediaChanged = changed;
        OfflinePlayHistory.changed = historyChanged;
        ManualDownloads.get(getContext()).changed = manualChanged;
    }

    private interface Task {
        JSONObject run(OfflineStore store) throws Exception;
    }
    private void execute(PluginCall call, ExecutorService executor, Task task) {
        executor.execute(() -> {
            try {
                OfflineStore store =
                        OfflineStore.forUser(getContext(), call.getString("serverUrl"), call.getString("userId"));
                if (store == null)
                    throw new IllegalArgumentException("Reconnect to DN to identify this offline library.");
                JSONObject value = task.run(store);
                if (value == null)
                    call.resolve();
                else
                    call.resolve(new JSObject(value.toString()));
            } catch (Exception e) {
                String message =
                        e instanceof IOException || e instanceof IllegalArgumentException ? e.getMessage() : null;
                call.reject(message == null ? "Offline storage could not complete this action." : message);
            }
        });
    }
    @PluginMethod
    public void snapshot(PluginCall call) {
        execute(call, storage, OfflineStore::snapshot);
    }
    @PluginMethod
    public void options(PluginCall call) {
        execute(call, storage, OfflineStore::options);
    }
    @PluginMethod public void historySettings(PluginCall call) {
        execute(call, storage, s -> OfflinePlayHistory.settings(getContext(), s));
    }
    @PluginMethod public void setOfflineHistory(PluginCall call) {
        execute(call, storage, s -> {
            Boolean enabled = call.getBoolean("enabled");
            if (enabled == null) throw new IllegalArgumentException("Choose whether to record offline listens.");
            s.recordHistory(enabled);
            historyChanged.run();
            return OfflinePlayHistory.settings(getContext(), s);
        });
    }
    @PluginMethod public void discardOfflineHistory(PluginCall call) {
        execute(call, storage, s -> {
            OfflinePlayHistory.discard(getContext(), s);
            return OfflinePlayHistory.settings(getContext(), s);
        });
    }
    @PluginMethod
    public void configure(PluginCall call) {
        execute(call, storage, s -> {
            boolean offline = s.offlineOnly(), unmetered = s.unmeteredOnly();
            JSONObject options = s.configure(call.getObject("options"));
            if (offline != s.offlineOnly() || unmetered != s.unmeteredOnly()) ManualDownloads.get(getContext()).policyChanged(s);
            return options;
        });
    }
    @PluginMethod
    public void remove(PluginCall call) {
        execute(call, storage, s -> {
            ManualDownloads.get(getContext()).remove(s, call.getArray("ids"));
            return null;
        });
    }
    @PluginMethod public void enqueueManual(PluginCall call) {
        execute(call, storage, s -> ManualDownloads.get(getContext()).enqueue(s, call.getArray("tracks")));
    }
    @PluginMethod public void manualStatus(PluginCall call) {
        execute(call, storage, s -> ManualDownloads.get(getContext()).status(s));
    }
    @PluginMethod public void takeDownloadNotification(PluginCall call) {
        boolean open = getActivity() instanceof MainActivity activity && activity.takeDownloadNotification();
        call.resolve(new JSObject().put("open", open));
    }
    @PluginMethod public void downloadNotificationSettings(PluginCall call) {
        try {
            call.resolve(new JSObject().put("state", DownloadNotificationSettings.read(getContext()).state));
        } catch (SecurityException e) {
            call.reject("Could not read Android notification settings.");
        }
    }
    @PluginMethod public void openDownloadNotificationSettings(PluginCall call) {
        main.post(() -> {
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Return to DroppedNeedle before opening Android notification settings.");
                return;
            }
            try {
                DownloadNotificationSettings.read(activity).open(activity);
                call.resolve();
            } catch (ActivityNotFoundException | SecurityException e) {
                call.reject("Android notification settings are unavailable on this device.");
            }
        });
    }
    @PluginMethod public void retryManual(PluginCall call) {
        execute(call, storage, s -> ManualDownloads.get(getContext()).retry(s));
    }
    @PluginMethod public void cancelManual(PluginCall call) {
        try {
            OfflineStore owner = OfflineStore.forUser(getContext(), call.getString("serverUrl"), call.getString("userId"));
            if (owner != null) ManualDownloads.get(getContext()).interrupt(owner.account);
        } catch (IllegalArgumentException invalid) { call.reject("Invalid offline account."); return; }
        execute(call, storage, s -> ManualDownloads.get(getContext()).cancel(s));
    }
    @PluginMethod
    public void clearCache(PluginCall call) {
        execute(call, storage, s -> {
            s.clearCache();
            return null;
        });
    }
    @PluginMethod
    public void cancelAutomatic(PluginCall call) {
        execute(call, storage, s -> { s.cancelAutomatic(); return null; });
    }
    @PluginMethod
    public void planAutomatic(PluginCall call) {
        execute(call, storage, s -> s.planAutomatic(call.getString("source"), call.getArray("ids")));
    }
    @PluginMethod
    public void save(PluginCall call) {
        execute(call, transfers, s -> {
            JSONObject track = call.getObject("track");
            String id = track.getString("id");
            String source = call.getString("source");
            long revision = s.itemRevision(id), generation = s.autoGeneration();
            if (s.keepExisting(id, source, track))
                return null;
            if (s.offlineOnly()) throw new IOException("Turn off offline-only playback to download new songs.");
            if (!s.permittedNetwork())
                throw new IOException("Connect to an unmetered network or change Offline settings.");
            String token = call.getString("token");
            if (token == null || token.isEmpty())
                throw new IllegalArgumentException("Reconnect to DN to download.");
            Request req = new Request.Builder()
                                  .url(s.original(id).newBuilder().addQueryParameter("format", "raw").build())
                                  .header("Authorization", "Bearer " + token)
                                  .header("Accept-Encoding", "identity")
                                  .build();
            try (Response response = http.newCall(req).execute()) {
                ResponseBody body = response.body();
                if (response.code() != 200 || body == null
                        || !OfflineStore.isAudio(response.header("Content-Type")))
                    throw new IOException("DN could not serve this audio file (HTTP " + response.code() + ").");
                try (OfflineStore.Capture capture = s.begin(track, source == null ? OfflineStore.DOWNLOAD : OfflineStore.AUTOMATIC, source, body.contentLength());
                        InputStream input = body.byteStream()) {
                    if (revision != s.itemRevision(id) || (source != null && generation != s.autoGeneration()))
                        throw new IOException("The offline download changed during this request.");
                    if (capture == null)
                        throw new IOException("Could not start this download.");
                    byte[] buf = new byte[65536];
                    int count;
                    while ((count = input.read(buf)) != -1)
                        capture.write(buf, 0, count);
                    capture.finish();
                }
            }
            return null;
        });
    }
    @Override
    protected void handleOnDestroy() {
        if (OfflineStore.mediaChanged == changed) OfflineStore.mediaChanged = null;
        if (OfflinePlayHistory.changed == historyChanged) OfflinePlayHistory.changed = null;
        ManualDownloads downloads = ManualDownloads.get(getContext());
        if (downloads.changed == manualChanged) downloads.changed = null;
        getContext().getSystemService(ConnectivityManager.class).unregisterNetworkCallback(networks);
        main.removeCallbacks(mediaEvent);
        main.removeCallbacks(transferEvent);
        http.dispatcher().cancelAll();
        transfers.shutdownNow();
        storage.shutdown();
        super.handleOnDestroy();
    }
}
