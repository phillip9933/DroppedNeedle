package app.droppedneedle.mobile;

import androidx.annotation.Nullable;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Supplier;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONException;
import org.json.JSONObject;

/** The local player fetches loudness for its active song, independently of audio delivery. */
final class PlaybackLoudness {
    private static final int MAX_BYTES = 4096;
    private final LinkedHashMap<String, JSONObject> recent = new LinkedHashMap<>(16, 0.75f, true);
    private Call pending;
    private String selected;

    @Nullable JSONObject get(String id) { return recent.get(id); }

    static Request request(HttpUrl base, String id, String token) {
        if (!OfflineStore.validTrackId(id)) throw new IllegalArgumentException("Invalid local track.");
        HttpUrl url = base.newBuilder().encodedPath(base.encodedPath().replaceAll("/+$", "") + "/api/v3/library/tracks")
                .addPathSegment(id).addPathSegment("loudness").query(null).fragment(null).build();
        return new Request.Builder().url(url).header("Authorization", "Bearer " + token).build();
    }

    // select, reset and their completion run on the player thread. A canceled reply can never affect a new queue.
    void select(@Nullable String id, Supplier<Call> open, Consumer<Runnable> post, Runnable changed) {
        if (Objects.equals(id, selected)) return;
        if (pending != null) pending.cancel();
        pending = null;
        selected = id;
        if (id == null || recent.containsKey(id)) return;
        Call call = open.get();
        pending = call;
        call.timeout().timeout(5, TimeUnit.SECONDS);
        call.enqueue(new Callback() {
            @Override public void onFailure(Call unused, IOException unavailable) {
                post.accept(() -> { if (pending == call) pending = null; });
            }
            @Override public void onResponse(Call unused, Response response) {
                JSONObject values = null;
                try (Response reply = response) {
                    ResponseBody body = reply.body();
                    if (reply.isSuccessful() && body != null && !body.source().request(MAX_BYTES + 1L))
                        values = decode(body.string());
                } catch (IOException | JSONException ignored) {
                    // Missing endpoints, proxy error pages and incomplete reads leave the track's existing tags in use.
                }
                JSONObject levels = values;
                post.accept(() -> {
                    if (pending != call) return;
                    pending = null;
                    if (levels == null || levels.length() == 0) return;
                    recent.put(id, levels);
                    if (recent.size() > 128) recent.remove(recent.keySet().iterator().next());
                    changed.run();
                });
            }
        });
    }

    void reset() {
        if (pending != null) pending.cancel();
        pending = null;
        selected = null;
        recent.clear();
    }

    private static JSONObject decode(String text) throws JSONException {
        JSONObject response = new JSONObject(text), levels = new JSONObject();
        read(response, levels, "track_gain_db", "replayGainTrackDb", false);
        read(response, levels, "album_gain_db", "replayGainAlbumDb", false);
        read(response, levels, "track_peak", "replayGainTrackPeak", true);
        read(response, levels, "album_peak", "replayGainAlbumPeak", true);
        return levels;
    }
    private static void read(JSONObject response, JSONObject levels, String key, String tag, boolean peak) throws JSONException {
        Object value = response.opt(key);
        if (value instanceof Number number && Double.isFinite(number.doubleValue()) && (!peak || number.doubleValue() > 0))
            levels.put(tag, number.doubleValue());
    }
}
