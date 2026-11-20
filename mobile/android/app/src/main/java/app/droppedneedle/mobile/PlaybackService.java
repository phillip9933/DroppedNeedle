package app.droppedneedle.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
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
import java.util.Collections;
import java.util.UUID;
import javax.crypto.SecretKey;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.json.JSONException;
import org.json.JSONObject;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
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
    private PlaybackReporter reporter;
    private SavedQueue saved;
    private SecretKey queueKey;
    private String revision;
    private long generation;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable checkpoint = this::checkpoint;

    private void checkpoint() {
        save(false);
        main.removeCallbacks(checkpoint);
        if (player.isPlaying()) main.postDelayed(checkpoint, 5000);
    }

    private void save(boolean includeTracks) {
        if (queueKey == null || player.getMediaItemCount() == 0) return;
        if (includeTracks) revision = UUID.randomUUID().toString();
        if (revision == null) return;
        JSObject state = new JSObject();
        state.put("revision", revision);
        state.put("index", player.getCurrentMediaItemIndex());
        state.put("position", Math.max(0, player.getCurrentPosition()));
        state.put("repeat", player.getRepeatMode());
        if (includeTracks) state.put("tracks", queueTracks());
        saved.write(queueKey, state, includeTracks);
    }

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
        saved = new SavedQueue(this);
        reporter = new PlaybackReporter(this, player);
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player source, Player.Events events) {
                if (events.containsAny(Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_POSITION_DISCONTINUITY,
                        Player.EVENT_REPEAT_MODE_CHANGED, Player.EVENT_PLAYBACK_STATE_CHANGED)) checkpoint();
            }
        });
        MediaSession.Callback callback = new MediaSession.Callback() {
            @Override public MediaSession.ConnectionResult onConnect(
                    MediaSession mediaSession, MediaSession.ControllerInfo controller) {
                Player.Commands commands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                        .remove(Player.COMMAND_SET_SHUFFLE_MODE)
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

    private static ArrayList<MediaItem> items(Access access, JSArray queue) throws JSONException {
        ArrayList<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject track = queue.getJSONObject(i);
            String stream = track.getString("streamUrl");
            if (!access.permits(HttpUrl.parse(stream), "stream/local/")) {
                throw new IllegalArgumentException("Invalid DroppedNeedle stream.");
            }
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                    .setTitle(track.getString("title")).setArtist(track.getString("artist"))
                    .setAlbumTitle(track.getString("album"));
            String art = track.optString("artworkUrl", "");
            if (!art.isEmpty() && access.permits(HttpUrl.parse(art), "")) metadata.setArtworkUri(Uri.parse(art));
            items.add(new MediaItem.Builder().setMediaId(track.getString("id"))
                    .setUri(stream).setTag(track).setMediaMetadata(metadata.build()).build());
        }
        return items;
    }

    void setQueue(String address, String token, JSArray queue, int index, @Nullable String placement) throws JSONException {
        if (queue == null || index < 0 || index >= queue.length()) {
            throw new IllegalArgumentException("Choose a track to play.");
        }
        generation++;
        Access next = new Access(address, token);
        ArrayList<MediaItem> items = items(next, queue);
        if (placement != null && player.getMediaItemCount() > 0) {
            if (access == null || !access.base.equals(next.base) || !access.token.equals(token)) {
                throw new IllegalArgumentException("This queue belongs to a different session.");
            }
            int at = "next".equals(placement) ? player.getCurrentMediaItemIndex() + 1 : player.getMediaItemCount();
            player.addMediaItems(at, items);
            save(true);
            return;
        }
        attach(next);
        player.stop();
        player.setMediaItems(items, index, 0);
        player.prepare();
        player.play();
        save(true);
    }

    private void attach(Access next) {
        revision = null;
        queueKey = SavedQueue.key(next.base.toString(), next.token);
        reporter.connect(next.base.newBuilder().encodedPath(next.apiPath + "playback").build(), next.token);
        access = next;
    }

    void restore(String address, String token, Runnable complete, Runnable superseded) {
        Access next = new Access(address, token);
        long version = ++generation;
        if (access != null) {
            if (!access.base.equals(next.base) || !access.token.equals(next.token)) {
                command("clear", -1, -1);
                long cleared = generation;
                saved.afterWrite(() -> {
                    if (generation == cleared) complete.run(); else superseded.run();
                });
            } else complete.run();
            return;
        }
        saved.load(SavedQueue.key(next.base.toString(), next.token), record -> {
            if (version != generation) { superseded.run(); return; }
            if (record != null) {
                try {
                    JSArray queue = new JSArray(record.getJSONArray("tracks").toString());
                    int index = record.getInt("index");
                    int repeat = record.getInt("repeat");
                    String savedRevision = record.getString("revision");
                    if (index < 0 || index >= queue.length() || repeat < Player.REPEAT_MODE_OFF
                            || repeat > Player.REPEAT_MODE_ALL) throw new JSONException("Invalid saved cursor");
                    ArrayList<MediaItem> checked = items(next, queue);
                    attach(next);
                    player.pause();
                    player.setRepeatMode(repeat);
                    player.setMediaItems(checked, index, Math.max(0, record.getLong("position")));
                    revision = savedRevision;
                    // Preparing a paused restoration would fetch audio before the listener presses play.
                } catch (JSONException | IllegalArgumentException e) {
                    command("clear", -1, -1);
                    Log.w("DNPlayback", "The saved queue could not be restored.");
                }
            }
            complete.run();
        });
    }

    void afterWrite(Runnable complete) { saved.afterWrite(complete); }

    void command(String action, double value, int to) {
        int count = player.getMediaItemCount();
        int item = (int) value;
        if ("clear".equals(action) || ("remove".equals(action) && count == 1 && item == 0)) {
            generation++;
            revision = null;
            queueKey = null;
            saved.clear();
            reporter.disconnect();
            player.pause();
            player.stop();
            player.clearMediaItems();
            access = null;
            player.setRepeatMode(Player.REPEAT_MODE_OFF);
            stopSelf();
            return;
        }
        if (count == 0) return;
        generation++;
        switch (action) {
            case "cycleRepeat":
                int repeat = player.getRepeatMode();
                player.setRepeatMode(repeat == Player.REPEAT_MODE_OFF ? Player.REPEAT_MODE_ALL
                        : repeat == Player.REPEAT_MODE_ALL ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
                break;
            case "clearUpcoming":
                player.removeMediaItems(player.getCurrentMediaItemIndex() + 1, count);
                break;
            case "shuffleUpcoming":
                int start = player.getCurrentMediaItemIndex() + 1;
                if (start + 1 >= count) break;
                ArrayList<MediaItem> upcoming = new ArrayList<>();
                for (int i = start; i < count; i++) upcoming.add(player.getMediaItemAt(i));
                Collections.shuffle(upcoming);
                player.replaceMediaItems(start, count, upcoming);
                break;
            case "move":
                if (item >= 0 && item < count && to >= 0 && to < count) player.moveMediaItem(item, to);
                break;
            case "remove":
                if (item >= 0 && item < count) {
                    if (item == count - 1 && item == player.getCurrentMediaItemIndex()) player.seekTo(item - 1, 0);
                    player.removeMediaItem(item);
                }
                break;
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
                if (value != (int) value || value < 0 || value >= count) {
                    throw new IllegalArgumentException("Choose a track in the queue.");
                }
                player.seekTo((int) value, 0);
                if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play();
                break;
            default:
                throw new IllegalArgumentException("Unknown playback command.");
        }
        save("move".equals(action) || "remove".equals(action) || "shuffleUpcoming".equals(action) || "clearUpcoming".equals(action));
    }

    private boolean showsPauseControl() {
        // Buffering can still be paused. An audio-focus interruption has stopped output.
        return player.getPlayWhenReady()
                && player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_NONE
                && player.getPlayerError() == null && player.getPlaybackState() != Player.STATE_ENDED;
    }

    private JSArray queueTracks() {
        JSArray tracks = new JSArray();
        for (int i = 0; i < player.getMediaItemCount(); i++) {
            MediaItem item = player.getMediaItemAt(i);
            tracks.put(item.localConfiguration.tag);
        }
        return tracks;
    }

    JSObject snapshot() {
        JSArray tracks = queueTracks();
        int index = tracks.length() == 0 ? -1 : player.getCurrentMediaItemIndex();
        JSONObject track = tracks.optJSONObject(index);
        double duration = player.getDuration() == C.TIME_UNSET
                ? (track == null ? 0 : track.optDouble("duration", 0)) : player.getDuration() / 1000.0;
        JSObject result = new JSObject();
        int repeat = player.getRepeatMode();
        result.put("repeat", repeat == Player.REPEAT_MODE_ONE ? "one" : repeat == Player.REPEAT_MODE_ALL ? "all" : "off");
        result.put("tracks", tracks);
        result.put("index", index);
        result.put("playing", index >= 0 && showsPauseControl());
        result.put("position", player.getCurrentPosition() / 1000.0);
        result.put("duration", duration);
        result.put("error", player.getPlayerError() == null ? JSONObject.NULL : "This track could not be played.");
        return result;
    }

    @Override public void onDestroy() {
        generation++;
        save(false);
        queueKey = null;
        main.removeCallbacks(checkpoint);
        reporter.close();
        access = null;
        session.release();
        player.release();
        super.onDestroy();
    }
}
