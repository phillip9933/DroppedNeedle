package app.droppedneedle.mobile;

import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Main-thread queue and network ownership. Only the response parser runs on OkHttp's worker. */
final class LibraryQueuePager {
    interface Dispatch {
        void post(Runnable task);
        void later(Runnable task, long delay);
        void cancel(Runnable task);
    }

    interface Host {
        JSONArray tracks();
        int index();
        int count();
        boolean offlineOnly();
        boolean active();
        void apply(LibraryWindow.Batch batch, boolean restart, boolean resume) throws JSONException;
    }

    private final Host host;
    private final Dispatch main;
    private final OkHttpClient http;
    private HttpUrl base;
    private String path, token;
    private LibraryWindow current;
    private Call fetching;
    private String problem;
    private boolean waiting;
    private final Runnable retry = () -> {
        if (hostActive())
            load(true);
    };

    LibraryQueuePager(Host host, Dispatch main, OkHttpClient http) {
        this.host = host;
        this.main = main;
        this.http = http;
    }

    void attach(@Nullable LibraryWindow cursor, HttpUrl origin, String path, String token) {
        detach();
        if (cursor == null)
            return;
        this.current = cursor;
        this.base = origin;
        this.path = path;
        this.token = token;
    }

    void detach() {
        if (fetching != null)
            fetching.cancel();
        main.cancel(retry);
        fetching = null;
        current = null;
        base = null;
        token = path = problem = null;
        waiting = false;
    }

    boolean attached() {
        return current != null;
    }
    boolean hasNext() {
        return attached() && current.after != null;
    }
    boolean waiting() {
        return waiting;
    }
    void cancelAdvance() {
        waiting = false;
    }
    private boolean hostActive() {
        return current != null && (waiting || host.active());
    }
    @Nullable
    JSONObject saved() {
        return current == null ? null : current.state();
    }

    @Nullable
    JSObject status(int count) {
        if (current == null)
            return null;
        JSObject status = new JSObject();
        status.put("loaded", current.loaded);
        status.put("total", current.total);
        status.put("offset", Math.max(0, current.loaded - count));
        status.put("more", current.after != null);
        if (problem != null)
            status.put("problem", problem);
        return status;
    }

    void end(boolean explicit) {
        waiting = true;
        load(explicit);
    }

    void load(boolean explicit) {
        LibraryWindow cursor = current;
        if (cursor == null || fetching != null || problem != null && !explicit)
            return;
        if (!explicit && !hostActive())
            return;
        boolean restart = cursor.after == null;
        if (restart && !waiting)
            return;
        if (!restart && host.count() - 1 - host.index() > LibraryWindow.AHEAD)
            return;
        main.cancel(retry);
        if (host.offlineOnly()) {
            problem = "Turn off offline-only mode to load more library tracks.";
            return;
        }
        problem = null;
        Set<String> ids = new HashSet<>();
        if (!restart) {
            JSONArray tracks = host.tracks();
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject track = tracks.optJSONObject(i);
                if (track != null)
                    ids.add(track.optString("id"));
            }
        }
        final HttpUrl owner = base;
        final String prefix = path;
        Request request =
                new Request.Builder().url(cursor.url(owner, prefix)).header("Authorization", "Bearer " + token).build();
        fetching = http.newCall(request);
        fetching.enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                main.post(() -> failed(call, "Could not load more library tracks.", !explicit));
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response body = response) {
                    LibraryWindow.Batch batch = cursor.read(body, owner, prefix, ids);
                    main.post(() -> accept(call, cursor, batch, restart));
                } catch (JSONException badPage) {
                    main.post(() -> failed(call, LibraryWindow.CHANGED, false));
                } catch (IOException error) {
                    main.post(() -> failed(call, "Could not load more library tracks.", !explicit));
                }
            }
        });
    }

    private void accept(Call call, LibraryWindow expected, LibraryWindow.Batch batch, boolean restart) {
        if (fetching != call || current != expected)
            return;
        fetching = null;
        if (restart ? !waiting : host.count() - 1 - host.index() > LibraryWindow.AHEAD)
            return;
        boolean resume = waiting;
        waiting = false;
        current = batch.cursor;
        try {
            host.apply(batch, restart, resume);
        } catch (JSONException | IllegalArgumentException error) {
            current = expected;
            waiting = resume;
            problem = "This library page exceeds the mobile queue limits. Refine the library filters.";
        }
    }

    private void failed(Call call, String message, boolean autoRetry) {
        if (fetching != call)
            return;
        fetching = null;
        problem = message;
        if (autoRetry)
            main.later(retry, 2200);
    }
}
