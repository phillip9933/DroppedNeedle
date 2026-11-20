package app.droppedneedle.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.media.AudioManager;
import android.os.Binder;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
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

    static final class Access implements OfflineDataSource.Library {
        final String artworkScope = UUID.randomUUID().toString();
        final HttpUrl base;
        final String apiPath;
        final String token;
        final String userId;
        final OfflineStore offline;
        final StreamProfiles profiles;
        final ConcurrentHashMap<String, JSONObject> metadata = new ConcurrentHashMap<>();

        Access(Context context, String address, String token, @Nullable String userId) {
            offline = OfflineStore.forUser(context, address, userId);
            profiles = new StreamProfiles(context, address, userId, () -> StreamProfiles.active(context));
            base = HttpUrl.parse(address);
            if (base == null || !base.isHttps() || !base.username().isEmpty()
                    || !base.password().isEmpty() || token == null || token.isEmpty()) {
                throw new IllegalArgumentException("Connect to DroppedNeedle over HTTPS.");
            }
            this.token = token;
            this.userId = userId;
            apiPath = base.encodedPath().replaceAll("/+$", "") + "/api/v3/";
        }

        @Override public OfflineStore store() { return offline; }
        @Override public JSONObject metadata(String id) { return metadata.get(id); }

        boolean allowsOnlineMedia() { return offline == null || !offline.offlineOnly(); }

        boolean permits(HttpUrl url, String path) {
            return url != null && url.isHttps() && url.host().equals(base.host())
                    && url.port() == base.port() && url.username().isEmpty() && url.password().isEmpty()
                    && url.encodedPath().startsWith(apiPath + path);
        }
    }

    private final LocalBinder binder = new LocalBinder();
    private volatile Access access;
    private RoutedPlayer player;
    private MediaSession session;
    private PlaybackReporter reporter;
    private PlaybackEqualizer equalizer;
    private PlaybackFades fades;
    private PlaybackSleepTimer sleep;
    private final TrackWaveform waveforms = new TrackWaveform();
    private OkHttpClient playbackHttp;
    private ExoPlayer localPlayback;
    private LibraryQueuePager pager;
    private boolean changingWindow, repeatLibrary, wasPlaying;
    private SavedQueue saved;
    private SecretKey queueKey;
    private String revision;
    private long generation;
    private SettableFuture<MediaSession.MediaItemsWithStartPosition> headsetPlay;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable checkpoint = this::checkpoint;

    private void checkpoint() {
        save(false);
        main.removeCallbacks(checkpoint);
        if (player.isPlaying()) main.postDelayed(checkpoint, 5000);
    }

    private void save(boolean includeTracks) {
        if (changingWindow || queueKey == null || player.getMediaItemCount() == 0) return;
        if (includeTracks) revision = UUID.randomUUID().toString();
        if (revision == null) return;
        JSObject state = new JSObject();
        state.put("revision", revision);
        if (access != null && access.userId != null) state.put("userId", access.userId);
        state.put("index", player.getCurrentMediaItemIndex());
        state.put("position", Math.max(0, player.getCurrentPosition()));
        state.put("repeat", repeatMode());
        if (pager.attached()) state.put("continuation", pager.saved());
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
                    String authorization = request.header("Authorization");
                    if (current == null || !current.permits(request.url(), "") ||
                            (authorization != null && !authorization.equals("Bearer " + current.token))) {
                        throw new IOException("Invalid DroppedNeedle media address.");
                    }
                    return chain.proceed(request.newBuilder()
                            .header("Authorization", "Bearer " + current.token).build());
                }).addNetworkInterceptor(chain -> {
                    Access mediaOwner = chain.request().tag(Access.class);
                    if (mediaOwner != null && (mediaOwner != access || !mediaOwner.allowsOnlineMedia()))
                        throw new IOException("Online media is unavailable.");
                    return chain.proceed(chain.request());
                }).build();
        playbackHttp = http;
        OkHttpDataSource.Factory source = new OkHttpDataSource.Factory(http);
        ConversionSource audioSource = new ConversionSource(timeline -> {
            Access current = access;
            DataSource.Factory stream = current == null ? source : new OkHttpDataSource.Factory(http)
                    .setDefaultRequestProperties(Collections.singletonMap("Authorization", "Bearer " + current.token));
            return new OfflineDataSource(current, stream, timeline, current == null ? null : current.profiles.track());
        });
        ExoPlayer local = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(audioSource)
                .setAudioAttributes(AudioAttributes.DEFAULT, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();
        localPlayback = local;
        player = new RoutedPlayer(this, local, item -> {
            Access owner = access;
            Uri canonical = item.localConfiguration.uri;
            String url = canonical.toString();
            StreamProfiles.Selection stream = owner == null ? null : owner.profiles.track();
            return (range, head) -> {
                Access current = access;
                if (owner == null || current == null || !owner.token.equals(current.token)
                        || !owner.base.equals(current.base) || !owner.permits(HttpUrl.parse(url), "stream/local/")) {
                    throw new IOException("The playback session changed.");
                }
                if (owner.offline != null) {
                    File file = owner.offline.playable(url);
                    if (file != null) return CastRelay.fromFile(file, CastRelay.audioType(file)).open(range, head);
                    if (owner.offline.offlineOnly()) throw new IOException("This song is not saved on this device.");
                }
                Uri selected = stream.forRequest(canonical);
                CastRelay.Media media = CastRelay.fromDn(http, selected.toString(), owner.token).open(range, head);
                if (media.status == 409 && ConversionSource.requested(selected)) {
                    media.close();
                    selected = ConversionSource.original(canonical);
                    media = CastRelay.fromDn(http, selected.toString(), owner.token).open(range, head);
                }
                if (media.status >= 200 && media.status < 300) stream.opened(selected);
                return media;
            };
        });
        sleep = new PlaybackSleepTimer(new PlaybackSleepTimer.Host() {
            @Override public long elapsed() { return SystemClock.elapsedRealtime(); }
            @Override public void schedule(Runnable task, long ms) { main.postDelayed(task, ms); }
            @Override public void unschedule(Runnable task) { main.removeCallbacks(task); }
            @Override public void pause() {
                wasPlaying = false;
                pager.cancelAdvance();
                player.pause();
            }
            @Override public void pauseAtEnd(boolean enabled) {
                local.setPauseAtEndOfMediaItems(enabled);
                player.pauseRemoteAtEnd(enabled);
            }
            @Override public Object playingTrack() {
                return showsPauseControl() ? trackIdentity(player.getCurrentMediaItem()) : null;
            }
        });
        player.remoteAdvance = item -> sleep.changedTrack(trackIdentity(item), true);
        pager = new LibraryQueuePager(new LibraryQueuePager.Host() {
            @Override public JSArray tracks() { return queueTracks(); }
            @Override public int index() { return player.getCurrentMediaItemIndex(); }
            @Override public int count() { return player.getMediaItemCount(); }
            @Override public boolean active() { return showsPauseControl(); }
            @Override public boolean offlineOnly() { return access == null || access.offline != null && access.offline.offlineOnly(); }
            @Override public void apply(LibraryWindow.Batch batch, boolean restart, boolean resume) throws JSONException {
                applyPage(batch, restart, resume);
            }
        }, new LibraryQueuePager.Dispatch() {
            @Override public void post(Runnable task) { main.post(task); }
            @Override public void later(Runnable task, long delay) { main.postDelayed(task, delay); }
            @Override public void cancel(Runnable task) { main.removeCallbacks(task); }
        }, http);
        fades = new PlaybackFades(this, local);
        equalizer = new PlaybackEqualizer(this);
        int audioSession = local.getAudioSessionId();
        if (audioSession <= 0) {
            try {
                AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
                int allocated = audio == null ? 0 : audio.generateAudioSessionId();
                if (allocated > 0) {
                    local.setAudioSessionId(allocated);
                    audioSession = allocated;
                }
            } catch (RuntimeException ignored) {
                // Playback can still use the framework-selected session when one becomes available.
            }
        }
        equalizer.setSession(audioSession);
        saved = new SavedQueue(this);
        reporter = new PlaybackReporter(this, player);
        local.addListener(new Player.Listener() {
            @Override public void onPlayWhenReadyChanged(boolean ready, int reason) {
                if (!ready && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM && sleep.afterTrack()) {
                    wasPlaying = false;
                    pager.cancelAdvance();
                    sleep.finishedTrack();
                }
            }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                sleep.changedTrack(trackIdentity(item), reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                        || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT);
            }
            @Override public void onAudioSessionIdChanged(int id) { equalizer.setSession(id); }
        });
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player source, Player.Events events) {
                sleep.check();
                boolean ended = source.getPlaybackState() == Player.STATE_ENDED;
                boolean sleepBoundary = sleep.afterTrack() && ended;
                if (ended && (sleepBoundary || !pager.attached() || !pager.hasNext() && !repeatLibrary)) sleep.finishedTrack();
                if (!changingWindow && pager.attached()) {
                    if (events.contains(Player.EVENT_REPEAT_MODE_CHANGED) && source.getRepeatMode() == Player.REPEAT_MODE_ALL)
                        setRepeat(Player.REPEAT_MODE_ALL);
                    if (ended && wasPlaying) {
                        wasPlaying = false;
                        if (!sleepBoundary && (pager.hasNext() || repeatLibrary)) pager.end(false);
                    } else if (!ended) {
                        wasPlaying = showsPauseControl();
                        if (wasPlaying) pager.load(false);
                    }
                }
                if (events.containsAny(Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_POSITION_DISCONTINUITY,
                        Player.EVENT_REPEAT_MODE_CHANGED, Player.EVENT_PLAYBACK_STATE_CHANGED)) checkpoint();
            }
        });
        MediaSession.Callback callback = new MediaSession.Callback() {
            @Override public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(
                    MediaSession mediaSession, MediaSession.ControllerInfo controller) {
                return resumeHeadset(controller);
            }
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
                .setBitmapLoader(new PlaybackArtwork(() -> access, http))
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
            metadata.setArtworkUri(PlaybackArtwork.uri(access, track.getString("id")));

            items.add(new MediaItem.Builder().setMediaId(track.getString("id"))
                    .setUri(stream).setTag(track).setMediaMetadata(metadata.build()).build());
        }
        return items;
    }

    private int repeatMode() { return repeatLibrary ? Player.REPEAT_MODE_ALL : player.getRepeatMode(); }

    private void setRepeat(int mode) {
        repeatLibrary = pager.attached() && mode == Player.REPEAT_MODE_ALL;
        if (!repeatLibrary && !pager.hasNext()) pager.cancelAdvance();
        player.setRepeatMode(repeatLibrary ? Player.REPEAT_MODE_OFF : mode);
    }

    private void detachWindow() {
        int repeat = repeatMode();
        pager.detach();
        wasPlaying = false;
        setRepeat(repeat);
    }

    private static void remember(Access owner, ArrayList<MediaItem> items) {
        for (MediaItem item : items) owner.metadata.put(item.mediaId, (JSONObject) trackIdentity(item));
    }

    private void applyPage(LibraryWindow.Batch batch, boolean restart, boolean resume) throws JSONException {
        Access owner = access;
        int before = player.getMediaItemCount();
        int prefix = restart ? before : Math.max(0, player.getCurrentMediaItemIndex() - LibraryWindow.HISTORY);
        JSArray incoming = new JSArray(batch.tracks.toString());
        ArrayList<MediaItem> newItems = items(owner, incoming);
        int bytes = 2;
        java.util.HashSet<String> retained = new java.util.HashSet<>();
        for (int i = prefix; i < before; i++) {
            MediaItem item = player.getMediaItemAt(i);
            bytes += trackIdentity(item).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length + 1;
            retained.add(item.mediaId);
        }
        bytes += incoming.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        if (bytes > LibraryWindow.MAX_BYTES || before - prefix + incoming.length() > 300)
            throw new IllegalArgumentException("The library queue is too large.");
        changingWindow = true;
        try {
            remember(owner, newItems);
            for (MediaItem item : newItems) retained.add(item.mediaId);
            if (restart) {
                player.setMediaItems(newItems, 0, 0);
            } else {
                player.addMediaItems(newItems);
                if (prefix > 0) player.removeMediaItems(0, prefix);
            }
            owner.metadata.keySet().retainAll(retained);
            if (resume) {
                int nextIndex = restart ? 0 : before - prefix;
                sleep.changedTrack(trackIdentity(player.getMediaItemAt(nextIndex)), true);
                player.seekTo(nextIndex, 0);
                player.prepare();
                player.play();
            }
        } finally { changingWindow = false; }
        save(true);
    }

    void setQueue(String address, String token, @Nullable String userId, JSArray queue, int index,
            @Nullable String placement, @Nullable JSONObject profiles) throws JSONException {
        setQueue(address, token, userId, queue, index, placement, profiles, null);
    }

    void setQueue(String address, String token, @Nullable String userId, JSArray queue, int index,
            @Nullable String placement, @Nullable JSONObject profiles, @Nullable JSONObject continuation) throws JSONException {
        if (queue == null || index < 0 || index >= queue.length()) {
            throw new IllegalArgumentException("Choose a track to play.");
        }
        cancelHeadset();
        generation++;
        Access next = new Access(this, address, token, userId);
        next.profiles.migrate(profiles);
        boolean append = placement != null && player.getMediaItemCount() > 0;
        if (append && (access == null || !access.base.equals(next.base) || !access.token.equals(token)
                || !java.util.Objects.equals(access.userId, userId))) {
            throw new IllegalArgumentException("This queue belongs to a different session.");
        }
        Access owner = append ? access : next;
        ArrayList<MediaItem> items = items(owner, queue);
        LibraryWindow window = LibraryWindow.parse(continuation, items.size());
        if (window != null && placement != null) throw new IllegalArgumentException("Invalid initial library queue.");
        remember(owner, items);
        if (append) {
            int at = "next".equals(placement) ? player.getCurrentMediaItemIndex() + 1 : player.getMediaItemCount();
            detachWindow();
            player.addMediaItems(at, items);
            save(true);
            return;
        }
        changingWindow = true;
        try {
            int repeat = repeatMode();
            detachWindow();
            sleep.changedTrack(null);
            attach(next);
            pager.attach(window, next.base, next.apiPath, next.token);
            setRepeat(repeat);
            player.stop();
            player.setMediaItems(items, index, 0);
            player.prepare();
            player.play();
        } finally { changingWindow = false; }
        wasPlaying = showsPauseControl();
        pager.load(false);
        save(true);
    }

    private static Object trackIdentity(@Nullable MediaItem item) {
        return item == null || item.localConfiguration == null ? null : item.localConfiguration.tag;
    }

    private void attach(Access next) {
        if (access != null && (!access.base.equals(next.base) || !access.token.equals(next.token)
                || !java.util.Objects.equals(access.userId, next.userId))) {
            sleep.cancel();
            player.disconnect(true, "");
        }
        revision = null;
        queueKey = SavedQueue.key(next.base.toString(), next.token);
        authorizeReports(next);
        access = next;
    }
    private void authorizeReports(Access account) {
        reporter.connect(account.base.newBuilder().encodedPath(account.apiPath + "playback").build(),
                account.token, account.offline);
    }

    private MediaSession.MediaItemsWithStartPosition restoreArchive(Access next, JSONObject record, boolean headset)
            throws JSONException {
        JSArray queue = new JSArray(record.getJSONArray("tracks").toString());
        int index = record.getInt("index"), repeat = record.getInt("repeat");
        long position = Math.max(0, record.getLong("position"));
        String savedRevision = record.getString("revision");
        if (index < 0 || index >= queue.length() || repeat < Player.REPEAT_MODE_OFF || repeat > Player.REPEAT_MODE_ALL)
            throw new JSONException("Invalid saved cursor");
        ArrayList<MediaItem> checked = items(next, queue);
        LibraryWindow window;
        try { window = LibraryWindow.parse(record.optJSONObject("continuation"), checked.size()); }
        catch (JSONException badCursor) { window = null; }
        if (headset && (next.offline.offlineOnly() || StreamProfiles.active(this) == StreamProfiles.Path.OFFLINE)
                && next.offline.playable(checked.get(index).localConfiguration.uri.toString()) == null)
            throw new IllegalArgumentException("The current song is unavailable offline.");
        remember(next, checked);
        attach(next);
        pager.attach(window, next.base, next.apiPath, next.token);
        setRepeat(repeat);
        revision = savedRevision;
        return new MediaSession.MediaItemsWithStartPosition(checked, index, position);
    }
    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> resumeHeadset(MediaSession.ControllerInfo controller) {
        if ((!controller.isTrusted() && controller.getUid() != android.os.Process.myUid())
                || !HeadsetAccount.unlocked(this) || !SavedQueue.exists(this) || headsetPlay != null)
            return Futures.immediateFailedFuture(new IllegalStateException("No eligible playback session."));
        SettableFuture<MediaSession.MediaItemsWithStartPosition> result = SettableFuture.create();
        headsetPlay = result;
        saved.forHeadset(this, (owner, record) -> {
            if (headsetPlay != result) return;
            headsetPlay = null;
            try {
                if (owner == null || record == null || !HeadsetAccount.unlocked(this) || player.getMediaItemCount() != 0)
                    throw new IllegalArgumentException("No eligible playback session.");
                Access next = new Access(this, owner.server.toString(), owner.token, owner.userId);
                result.set(restoreArchive(next, record, true));
            } catch (JSONException | IllegalArgumentException unavailable) {
                result.setException(new IllegalStateException("No eligible playback session."));
                if (player.getMediaItemCount() == 0) player.pause();
            }
        });
        return result;
    }
    private void cancelHeadset() {
        if (headsetPlay == null) return;
        SettableFuture<MediaSession.MediaItemsWithStartPosition> old = headsetPlay;
        headsetPlay = null;
        old.cancel(false);
        // Media3 1.8 forwards Play to the player after a failed resumption, even for an empty queue.
        if (player.getMediaItemCount() == 0) player.pause();
    }

    void restore(String address, String token, @Nullable String userId, @Nullable JSONObject profiles,
            Runnable complete, Runnable superseded) throws JSONException {
        cancelHeadset();
        Access next = new Access(this, address, token, userId);
        next.profiles.migrate(profiles);
        long version = ++generation;
        if (access != null) {
            if (!access.base.equals(next.base) || !access.token.equals(next.token)
                    || !java.util.Objects.equals(access.userId, next.userId)) {
                command("clear", -1, -1);
                long cleared = generation;
                saved.afterWrite(() -> {
                    if (generation == cleared) { authorizeReports(next); complete.run(); } else superseded.run();
                });
            } else {
                reporter.retryOfflineHistory();
                complete.run();
            }
            return;
        }
        saved.load(SavedQueue.key(next.base.toString(), next.token), record -> {
            if (version != generation) { superseded.run(); return; }
            // A headset request can arrive while this signed-in restore is reading the old archive.
            // Resolve it before another account's paused queue is placed on the player.
            cancelHeadset();
            if (record != null) {
                try {
                    player.pause();
                    MediaSession.MediaItemsWithStartPosition restored = restoreArchive(next, record, false);
                    player.setMediaItems(restored.mediaItems, restored.startIndex, restored.startPositionMs);
                    // An older queue gets its verified owner only through a normal signed-in app restore.
                    if (!record.has("userId") && next.userId != null) save(true);
                    // Preparing a paused restoration would fetch audio before the listener presses play.
                } catch (JSONException | IllegalArgumentException e) {
                    command("clear", -1, -1);
                    Log.w("DNPlayback", "The saved queue could not be restored.");
                }
            }
            // A fresh credential can submit saved listens even when it has no restorable player queue.
            if (access == null) authorizeReports(next);
            complete.run();
        });
    }

    PlaybackEqualizer equalizer() { return equalizer; }

    PlaybackFades fades() { return fades; }
    RoutedPlayer output() { return player; }

    void afterWrite(Runnable complete) { saved.afterWrite(complete); }

    void command(String action, double value, int to) {
        cancelHeadset();
        sleep.check();
        int count = player.getMediaItemCount();
        int item = (int) value;
        if ("clear".equals(action) || ("remove".equals(action) && count == 1 && item == 0)) {
            generation++;
            revision = null;
            queueKey = null;
            sleep.cancel();
            detachWindow();
            saved.clear();
            reporter.disconnect();
            player.disconnect(true, "");
            player.pause();
            player.stop();
            player.clearMediaItems();
            access = null;
            player.setRepeatMode(Player.REPEAT_MODE_OFF);
            stopSelf();
            return;
        }
        if ("cancelSleepTimer".equals(action)) { sleep.cancel(); return; }
        if ("setSleepMinutes".equals(action) || "sleepAfterTrack".equals(action)) {
            if (count == 0) throw new IllegalStateException("Choose a track first.");
            if ("setSleepMinutes".equals(action)) sleep.minutes(value, to == 1);
            else sleep.afterTracks(trackIdentity(player.getCurrentMediaItem()), value < 1 ? 1 : value);
            return;
        }
        if (count == 0) return;
        boolean edit = "clearUpcoming".equals(action) || "shuffleUpcoming".equals(action)
                || "move".equals(action) && item >= 0 && item < count && to >= 0 && to < count
                || "remove".equals(action) && item >= 0 && item < count;
        if (edit) detachWindow();
        generation++;
        switch (action) {
            case "cycleRepeat":
                int repeat = repeatMode();
                setRepeat(repeat == Player.REPEAT_MODE_OFF ? Player.REPEAT_MODE_ALL
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
            case "retryLibraryWindow":
                pager.load(true);
                break;
            case "toggle":
                if (pager.waiting()) {
                    pager.cancelAdvance();
                    wasPlaying = false;
                    player.pause();
                } else if (showsPauseControl()) {
                    wasPlaying = false;
                    player.pause();
                } else {
                    if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                    if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                    player.play();
                }
                break;
            case "previous":
                pager.cancelAdvance();
                player.seekToPrevious();
                break;
            case "next":
                if (pager.attached() && player.getCurrentMediaItemIndex() == count - 1 && (pager.hasNext() || repeatLibrary)) {
                    pager.end(true);
                } else player.seekToNextMediaItem();
                break;
            case "seek":
                pager.cancelAdvance();
                if (Double.isFinite(value)) player.seekTo((long) (Math.max(0, value) * 1000));
                break;
            case "skipTo":
                if (value != (int) value || value < 0 || value >= count) {
                    throw new IllegalArgumentException("Choose a track in the queue.");
                }
                pager.cancelAdvance();
                player.seekTo((int) value, 0);
                if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play();
                break;
            default:
                throw new IllegalArgumentException("Unknown playback command.");
        }
        save(edit);
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

    void readWaveform(String trackId, String request, java.util.function.Consumer<JSObject> result) {
        MediaItem item = player.getCurrentMediaItem();
        Access owner = access;
        if (request.isEmpty() || owner == null || item == null || item.localConfiguration == null
                || !item.mediaId.equals(trackId)) {
            JSObject empty = new JSObject();
            empty.put("peaks", new JSArray());
            result.accept(empty);
            return;
        }
        double seconds = player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration() / 1000.0;
        waveforms.read(request, getCacheDir(), owner, item.localConfiguration.uri, seconds, playbackHttp, result);
    }

    void cancelWaveform(String request) { waveforms.cancel(request); }

    @Nullable
    private JSObject currentQuality() {
        if (!player.destination().isEmpty()) return null;
        androidx.media3.common.Format format = localPlayback.getAudioFormat();
        if (format == null || format.sampleMimeType == null) return null;
        String codec;
        switch (format.sampleMimeType) {
            case "audio/raw": codec = "PCM"; break;
            case "audio/mp4a-latm": codec = "AAC"; break;
            case "audio/mpeg": codec = "MP3"; break;
            case "audio/opus": codec = "Opus"; break;
            case "audio/vorbis": codec = "Vorbis"; break;
            default: codec = format.sampleMimeType.replace("audio/", "").toUpperCase(java.util.Locale.ROOT);
        }
        JSObject out = new JSObject();
        out.put("format", codec);
        if (format.sampleRate > 0) out.put("sampleRate", format.sampleRate);
        if (format.averageBitrate > 0) out.put("bitrate", Math.round(format.averageBitrate / 1000f));
        if (androidx.media3.common.util.Util.isEncodingLinearPcm(format.pcmEncoding))
            out.put("bitDepth", androidx.media3.common.util.Util.getPcmFrameSize(format.pcmEncoding, 1) * 8);
        return out;
    }

    JSObject snapshot() {
        sleep.check();
        JSArray tracks = queueTracks();
        int index = tracks.length() == 0 ? -1 : player.getCurrentMediaItemIndex();
        JSONObject track = tracks.optJSONObject(index);
        double duration = player.getDuration() == C.TIME_UNSET
                ? (track == null ? 0 : track.optDouble("duration", 0)) : player.getDuration() / 1000.0;
        if (player.remoteDuration() > 0) duration = player.remoteDuration() / 1000.0;
        JSObject result = new JSObject();
        int repeat = repeatMode();
        if (pager.attached()) result.put("libraryWindow", pager.status(tracks.length()));
        JSObject timer = new JSObject();
        long remaining = sleep.remaining();
        if (sleep.tracks() > 0) {
            timer.put("mode", "track");
            timer.put("remaining", sleep.tracks());
        } else if (remaining > 0) {
            timer.put("mode", "minutes");
            timer.put("endsAt", System.currentTimeMillis() + remaining);
            timer.put("finishTrack", sleep.finishLast());
        }
        result.put("sleepTimer", timer.length() > 0 ? timer : JSONObject.NULL);
        result.put("quality", currentQuality());
        result.put("repeat", repeat == Player.REPEAT_MODE_ONE ? "one" : repeat == Player.REPEAT_MODE_ALL ? "all" : "off");
        result.put("tracks", tracks);
        result.put("index", index);
        result.put("playing", index >= 0 && (showsPauseControl() || pager.waiting()));
        result.put("position", player.getCurrentPosition() / 1000.0);
        result.put("duration", duration);
        result.put("error", !player.routeError().isEmpty() ? player.routeError()
                : player.getPlayerError() == null ? JSONObject.NULL : "This track could not be played.");
        return result;
    }

    @Override public void onDestroy() {
        waveforms.close();
        cancelHeadset();
        generation++;
        save(false);
        queueKey = null;
        main.removeCallbacks(checkpoint);
        pager.detach();
        reporter.close();
        sleep.cancel();
        fades.release();
        equalizer.release();
        access = null;
        session.release();
        player.release();
        super.onDestroy();
    }
}
