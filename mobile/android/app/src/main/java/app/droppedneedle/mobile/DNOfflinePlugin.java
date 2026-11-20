package app.droppedneedle.mobile;

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

    private final Runnable changed = () -> notifyListeners("mediaChanged", new JSObject());
    private final Runnable historyChanged = () -> notifyListeners("historyChanged", new JSObject());
    @Override public void load() { OfflineStore.mediaChanged = changed; OfflinePlayHistory.changed = historyChanged; }

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
        execute(call, storage, s -> s.configure(call.getObject("options")));
    }
    @PluginMethod
    public void remove(PluginCall call) {
        execute(call, storage, s -> {
            s.remove(call.getArray("ids"));
            return null;
        });
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
        http.dispatcher().cancelAll();
        transfers.shutdownNow();
        storage.shutdown();
        super.handleOnDestroy();
    }
}
