package app.droppedneedle.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSourceBitmapLoader;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.CacheBitmapLoader;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.ArrayList;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.json.JSONException;
import org.json.JSONObject;

public final class PlaybackService extends MediaSessionService {
    static final String LOCAL_BIND = "app.droppedneedle.mobile.LOCAL_PLAYER";
    final class LocalBinder extends Binder {
        PlaybackService service() { return PlaybackService.this; }
    }

    private static final class Access {
        final HttpUrl base;
        final String apiPath;
        final String token;

        Access(String address, String token) {
            base = HttpUrl.parse(address);
            if (base == null || !base.isHttps() || !base.username().isEmpty()
                    || !base.password().isEmpty() || token == null || token.isEmpty()) {
                throw new IllegalArgumentException("Connect to DroppedNeedle over HTTPS.");
            }
            this.token = token;
            apiPath = base.encodedPath().replaceAll("/+$", "") + "/api/v3/";
        }

        boolean permits(HttpUrl url, String path) {
            return url != null && url.isHttps() && url.host().equals(base.host())
                    && url.port() == base.port() && url.username().isEmpty() && url.password().isEmpty()
                    && url.encodedPath().startsWith(apiPath + path);
        }
    }

    private final LocalBinder binder = new LocalBinder();
    private volatile Access access;
    private ExoPlayer player;
    private MediaSession session;
    private JSArray tracks = new JSArray();

    @Override public void onCreate() {
        super.onCreate();
        OkHttpClient http = new OkHttpClient.Builder()
                .followRedirects(false).followSslRedirects(false)
                .addInterceptor(chain -> {
                    Request request = chain.request();
                    Access current = access;
                    if (current == null || !current.permits(request.url(), "")) {
                        throw new IOException("Invalid DroppedNeedle media address.");
                    }
                    return chain.proceed(request.newBuilder()
                            .header("Authorization", "Bearer " + current.token).build());
                }).build();
        OkHttpDataSource.Factory source = new OkHttpDataSource.Factory(http);
        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(source))
                .setAudioAttributes(AudioAttributes.DEFAULT, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();
        MediaSession.Callback callback = new MediaSession.Callback() {
            @Override public MediaSession.ConnectionResult onConnect(
                    MediaSession mediaSession, MediaSession.ControllerInfo controller) {
                Player.Commands commands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                        .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS)
                        .remove(Player.COMMAND_SET_MEDIA_ITEM)
                        .build();
                return new MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
                        .setAvailablePlayerCommands(commands).build();
            }
        };
        session = new MediaSession.Builder(this, player)
                .setCallback(callback)
                .setBitmapLoader(new CacheBitmapLoader(new DataSourceBitmapLoader(
                        DataSourceBitmapLoader.DEFAULT_EXECUTOR_SERVICE.get(), source, null, 512)))
                .build();
        addSession(session);
    }

    @Nullable @Override public IBinder onBind(@Nullable Intent intent) {
        if (intent != null && LOCAL_BIND.equals(intent.getAction())) return binder;
        return super.onBind(intent);
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }

    void setQueue(String address, String token, JSArray queue, int index) throws JSONException {
        if (queue == null || index < 0 || index >= queue.length()) {
            throw new IllegalArgumentException("Choose a track to play.");
        }
        Access next = new Access(address, token);
        ArrayList<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject track = queue.getJSONObject(i);
            String stream = track.getString("streamUrl");
            if (!next.permits(HttpUrl.parse(stream), "stream/local/")) {
                throw new IllegalArgumentException("Invalid DroppedNeedle stream.");
            }
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                    .setTitle(track.getString("title")).setArtist(track.getString("artist"))
                    .setAlbumTitle(track.getString("album"));
            String art = track.optString("artworkUrl", "");
            if (!art.isEmpty() && next.permits(HttpUrl.parse(art), "")) metadata.setArtworkUri(Uri.parse(art));
            items.add(new MediaItem.Builder().setMediaId(track.getString("id"))
                    .setUri(stream).setMediaMetadata(metadata.build()).build());
        }
        player.stop();
        access = next;
        tracks = queue;
        player.setMediaItems(items, index, 0);
        player.prepare();
        player.play();
    }

    void command(String action, double value) {
        if ("clear".equals(action)) {
            player.pause();
            player.stop();
            player.clearMediaItems();
            access = null;
            tracks = new JSArray();
            stopSelf();
            return;
        }
        if (tracks.length() == 0) return;
        switch (action) {
            case "toggle":
                if (showsPauseControl()) {
                    player.pause();
                } else {
                    if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                    if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                    player.play();
                }
                break;
            case "previous":
                player.seekToPrevious();
                break;
            case "next":
                player.seekToNextMediaItem();
                break;
            case "seek":
                if (Double.isFinite(value)) player.seekTo((long) (Math.max(0, value) * 1000));
                break;
            case "skipTo":
                if (value != (int) value || value < 0 || value >= tracks.length()) {
                    throw new IllegalArgumentException("Choose a track in the queue.");
                }
                player.seekTo((int) value, 0);
                if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play();
                break;
            default:
                throw new IllegalArgumentException("Unknown playback command.");
        }
    }

    private boolean showsPauseControl() {
        // Buffering can still be paused. An audio-focus interruption has stopped output.
        return player.getPlayWhenReady()
                && player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_NONE
                && player.getPlayerError() == null && player.getPlaybackState() != Player.STATE_ENDED;
    }

    JSObject snapshot() {
        int index = tracks.length() == 0 ? -1 : player.getCurrentMediaItemIndex();
        JSONObject track = tracks.optJSONObject(index);
        double duration = player.getDuration() == C.TIME_UNSET
                ? (track == null ? 0 : track.optDouble("duration", 0)) : player.getDuration() / 1000.0;
        JSObject result = new JSObject();
        result.put("tracks", tracks);
        result.put("index", index);
        result.put("playing", index >= 0 && showsPauseControl());
        result.put("position", player.getCurrentPosition() / 1000.0);
        result.put("duration", duration);
        result.put("error", player.getPlayerError() == null ? JSONObject.NULL : "This track could not be played.");
        return result;
    }

    @Override public void onDestroy() {
        access = null;
        session.release();
        player.release();
        super.onDestroy();
    }
}
