package app.droppedneedle.mobile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;
import org.json.JSONException;
import org.json.JSONObject;

final class OfflineScrobble {
    private static final MediaType JSON = MediaType.get("application/json");

    static boolean heardEnough(long duration, long heard) {
        return duration > 0 && heard > 0
                && (heard > duration * 0.9 || heard >= Math.max(duration / 2, duration - 1000));
    }
    static boolean qualifies(long duration, long heard, long position) {
        return heardEnough(duration, heard) && (position > duration * 0.9 || position >= duration - 1000);
    }
    static JSONObject play(String id, String title, String artist, String album, long duration, long started)
            throws JSONException {
        JSONObject body = new JSONObject().put("source", "local").put("track_id", id)
                .put("track_name", title).put("artist_name", artist)
                .put("duration_ms", duration).put("timestamp", started);
        if (!album.isEmpty()) body.put("album_name", album);
        return body;
    }

    // DN's one-hour, 200-entry dedup cache can be evicted or lost on restart. A lost answer after
    // sending a body is terminal. Only a pre-body failure or DN's explicit rejection is safe to retry.
    static boolean retryRequired(OkHttpClient http, HttpUrl endpoint, String credential, String payload,
            BooleanSupplier permitted) {
        if (!permitted.getAsBoolean()) return true;
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        AtomicBoolean writing = new AtomicBoolean();
        RequestBody body = new RequestBody() {
            @Override public MediaType contentType() { return JSON; }
            @Override public long contentLength() { return bytes.length; }
            @Override public boolean isOneShot() { return true; }
            @Override public void writeTo(BufferedSink target) throws IOException {
                if (!permitted.getAsBoolean()) throw new IOException("Listening session changed.");
                writing.set(true);
                target.write(bytes);
            }
        };
        Request request = new Request.Builder().url(endpoint).header("Authorization", "Bearer " + credential)
                .header("Accept", "application/json").post(body).build();
        try (Response response = http.newCall(request).execute()) {
            MediaType type = response.body() == null ? null : response.body().contentType();
            if (type == null || !type.subtype().endsWith("json")) return false;
            JSONObject answer = new JSONObject(response.peekBody(8192).string());
            if (response.code() == 401) {
                JSONObject error = answer.optJSONObject("error");
                return error != null && "UNAUTHORIZED".equals(error.optString("code"));
            }
            return response.isSuccessful() && Boolean.FALSE.equals(answer.opt("accepted"))
                    && answer.optJSONObject("services") != null;
        } catch (IOException | JSONException failure) {
            return !writing.get();
        }
    }
}
