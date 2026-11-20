package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** The native playback session owns presence, history and scrobbling for a local library track. */
final class PlaybackReporter implements Player.Listener {
    private static final long HEARTBEAT_MS = 5000;
    private static final MediaType JSON = MediaType.get("application/json");
    private final Player player;
    private final String device;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
            .followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).callTimeout(5, TimeUnit.SECONDS).build();
    // Stop must arrive before the following start, including successive plays of the same track.
    private final ThreadPoolExecutor sender = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(64), new ThreadPoolExecutor.DiscardPolicy());
    private final Runnable heartbeat = this::heartbeat;
    private HttpUrl endpoint;
    private String token;
    private MediaItem active;
    private long lengthMs;
    private long positionMs;
    private long heardMs;
    private long playingSince = C.TIME_UNSET;

    PlaybackReporter(Context context, Player player) {
        this.player = player;
        SharedPreferences preferences = context.getSharedPreferences("playback", Context.MODE_PRIVATE);
        String saved = preferences.getString("device", null);
        if (saved == null) {
            saved = "android-" + UUID.randomUUID().toString().substring(0, 8);
            preferences.edit().putString("device", saved).apply();
        }
        device = saved;
        player.addListener(this);
    }

    void connect(HttpUrl api, String credential) {
        disconnect();
        endpoint = api;
        token = credential;
    }

    void disconnect() {
        if (active != null) finish(player.getCurrentPosition());
        endpoint = null;
        token = null;
        main.removeCallbacks(heartbeat);
    }

    private void countTime() {
        if (playingSince == C.TIME_UNSET) return;
        heardMs += Math.max(0, SystemClock.elapsedRealtime() - playingSince);
        playingSince = C.TIME_UNSET;
    }

    private static Object occurrence(@Nullable MediaItem item) {
        return item == null || item.localConfiguration == null ? null : item.localConfiguration.tag;
    }

    @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition,
            Player.PositionInfo newPosition, int reason) {
        if (active == null || occurrence(active) != occurrence(oldPosition.mediaItem)) return;
        if (reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
                || occurrence(oldPosition.mediaItem) != occurrence(newPosition.mediaItem)) {
            finish(oldPosition.positionMs);
        }
    }

    @Override public void onEvents(Player ignored, Player.Events events) {
        if (endpoint == null) return;
        MediaItem item = player.getCurrentMediaItem();
        boolean ended = player.getPlaybackState() == Player.STATE_ENDED;
        if (active != null && (occurrence(active) != occurrence(item) || ended
                || player.getPlaybackState() == Player.STATE_IDLE || player.getPlayerError() != null)) {
            finish(occurrence(active) == occurrence(item) ? player.getCurrentPosition() : positionMs);
        }
        if (item == null || ended || player.getPlayerError() != null) return;
        if (active == null) {
            // Preparing and seeking a paused item must not announce a fresh listen.
            if (!player.isPlaying()) return;
            active = item;
            lengthMs = Math.max(0, player.getDuration());
            positionMs = player.getCurrentPosition();
            heardMs = 0;
            playingSince = SystemClock.elapsedRealtime();
            send("start", body());
        } else {
            countTime();
            positionMs = player.getCurrentPosition();
            if (player.getDuration() > 0) lengthMs = player.getDuration();
            if (player.isPlaying()) playingSince = SystemClock.elapsedRealtime();
            if (events.contains(Player.EVENT_IS_PLAYING_CHANGED)
                    || events.contains(Player.EVENT_POSITION_DISCONTINUITY)) progress();
        }
        main.removeCallbacks(heartbeat);
        if (player.isPlaying()) main.postDelayed(heartbeat, HEARTBEAT_MS);
    }

    private void heartbeat() {
        if (active == null || !player.isPlaying()) return;
        positionMs = player.getCurrentPosition();
        if (player.getDuration() > 0) lengthMs = player.getDuration();
        if (sender.getQueue().isEmpty()) progress();
        main.postDelayed(heartbeat, HEARTBEAT_MS);
    }

    private void progress() {
        JSObject body = body();
        body.put("is_paused", !player.isPlaying());
        send("progress", body);
    }

    private void finish(long position) {
        countTime();
        positionMs = position;
        JSObject body = body();
        // DN counts a local stop past 90% or in the last second. A seek alone is not a listen.
        boolean listened = lengthMs > 0 && heardMs > 0
                && (heardMs > lengthMs * 0.9 || heardMs >= Math.max(lengthMs / 2, lengthMs - 1000));
        body.put("ignore_scrobble", !listened);
        send("stop", body);
        active = null;
        main.removeCallbacks(heartbeat);
    }

    private JSObject body() {
        JSObject body = new JSObject();
        body.put("track_id", active.mediaId);
        body.put("source", "local");
        body.put("device", device);
        body.put("position_ms", Math.max(0, positionMs));
        if (lengthMs > 0) body.put("duration_ms", lengthMs);
        return body;
    }

    private void send(String operation, JSObject body) {
        // Capture both the destination and the session. A queued report never adopts a later login.
        Request request = new Request.Builder().url(endpoint.newBuilder().addPathSegment(operation).build())
                .header("Authorization", "Bearer " + token)
                .post(RequestBody.create(JSON, body.toString())).build();
        sender.execute(() -> {
            try (Response response = http.newCall(request).execute()) {
                if (!response.isSuccessful()) Log.w("DNPlayback", operation + " report returned " + response.code());
            } catch (IOException e) {
                Log.w("DNPlayback", operation + " report was unavailable");
            }
        });
    }

    void close() {
        disconnect();
        player.removeListener(this);
        sender.shutdown();
    }
}
