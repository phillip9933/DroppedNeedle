package app.droppedneedle.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.PowerManager;
import androidx.media3.common.C;
import androidx.media3.common.DeviceInfo;
import androidx.media3.common.ForwardingSimpleBasePlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** The media session and the app share the same queue and transport, including on a renderer. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class RoutedPlayer extends ForwardingSimpleBasePlayer {
    interface Sources { CastRelay.Source forItem(MediaItem item); }
    final Player local;
    private final Sources sources;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService control = Executors.newSingleThreadExecutor();
    private final Runnable poll = this::poll;
    private final Runnable idleTimeout = () -> disconnect(true, "The paused cast expired.");
    private final PowerManager.WakeLock networkPlayback;
    private boolean idleTimer, stopAtTrackEnd;
    private long lastWake;
    private static final DeviceInfo REMOTE = new DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_REMOTE).build();
    private NetworkRenderer device;
    private CastRelay relay;
    private MediaItem item;
    private boolean working, wanted, ended, sawPlay, polling;
    private long position, at, duration;
    private volatile int connection, selection;
    private int failures, intent;
    private String media = "", lastOwned = "", error = "";
    private Consumer<String> pendingConnect;

    RoutedPlayer(Context context, Player local, Sources sources) {
        super(local);
        this.local = local;
        this.sources = sources;
        PowerManager power = context.getSystemService(PowerManager.class);
        networkPlayback = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DroppedNeedle:cast-playback");
        networkPlayback.setReferenceCounted(false);
        local.addListener(new Listener() {
            @Override public void onEvents(Player player, Events events) {
                if (device != null && events.containsAny(EVENT_TIMELINE_CHANGED, EVENT_MEDIA_ITEM_TRANSITION))
                    syncTrack();
            }
        });
    }

    void pauseRemoteAtEnd(boolean enabled) { stopAtTrackEnd = enabled; }
    String destination() { return device == null ? "" : device.name; }
    int routeGeneration() { return connection; }
    String routeError() { return error; }
    private long currentPosition() {
        long value = position + (wanted && !working && !ended ? SystemClock.elapsedRealtime() - at : 0);
        return duration > 0 ? Math.min(duration, value) : value;
    }
    long remoteDuration() { return device == null ? 0 : duration; }
    private void anchor(long ms) { position = Math.max(0, ms); at = SystemClock.elapsedRealtime(); }

    private void updatePower() {
        if (device != null && (wanted || working)) {
            long now = SystemClock.elapsedRealtime();
            if (!networkPlayback.isHeld() || now - lastWake > 300_000) {
                networkPlayback.acquire(600_000);
                lastWake = now;
            }
        } else if (networkPlayback.isHeld()) networkPlayback.release();
        boolean idle = device != null && !wanted && !working;
        if (idle != idleTimer) {
            idleTimer = idle;
            main.removeCallbacks(idleTimeout);
            if (idle) main.postDelayed(idleTimeout, 600_000);
        }
    }

    void connect(NetworkRenderer selected, Consumer<String> complete) {
        if (device != null || pendingConnect != null) { complete.accept("Stop the current cast before changing speakers."); return; }
        int id = ++connection;
        error = "";
        pendingConnect = complete;
        control.execute(() -> {
            try {
                CastRelay next = new CastRelay(selected.local, selected.peer);
                main.post(() -> {
                    if (connection != id) { next.close(); return; }
                    boolean play = local.getPlayWhenReady();
                    long start = local.getCurrentPosition();
                    local.pause();
                    local.stop();
                    device = selected;
                    relay = next;
                    wanted = play;
                    selection++;
                    anchor(start);
                    if (local.getCurrentMediaItem() == null) finishConnect("");
                    else load(local.getCurrentMediaItem(), start);
                    updatePower();
                    invalidateState();
                });
            } catch (IOException e) {
                main.post(() -> { if (connection == id) finishConnect("This Wi-Fi route is no longer available."); });
            }
        });
    }
    private void finishConnect(String problem) {
        Consumer<String> cb = pendingConnect;
        pendingConnect = null;
        if (cb != null) cb.accept(problem);
    }

    /** Release the media tokens immediately. A renderer taken over by another controller is left alone. */
    void disconnect(boolean stop, String problem) {
        connection++;
        selection++;
        intent++;
        NetworkRenderer old = device;
        String oldMedia = lastOwned;
        long resumeAt = currentPosition();
        device = null;
        item = null;
        media = lastOwned = "";
        if (relay != null) relay.close();
        relay = null;
        if (old != null) control.execute(() -> {
            try {
                if (stop && !oldMedia.isEmpty() && oldMedia.equals(old.read().uri)) old.stop();
            } catch (IOException ignored) { /* The receiver may already have left Wi-Fi. */ }
            finally { old.leave(); }
        });
        working = wanted = ended = sawPlay = polling = false;
        duration = 0;
        updatePower();
        main.removeCallbacks(poll);
        if (old != null && local.getCurrentMediaItem() != null) local.seekTo(resumeAt);
        error = problem;
        finishConnect(problem.isEmpty() ? "Cast connection canceled." : problem);
        invalidateState();
    }

    private void syncTrack() {
        MediaItem next = local.getCurrentMediaItem();
        if (next == null) {
            if (item != null) disconnect(true, "");
        } else if (item == null || next.localConfiguration.tag != item.localConfiguration.tag) {
            load(next, local.getCurrentPosition());
        }
    }

    private void load(MediaItem next, long start) {
        int rev = ++selection;
        intent++;
        item = next;
        duration = next.localConfiguration.tag instanceof org.json.JSONObject
                ? (long) (((org.json.JSONObject) next.localConfiguration.tag).optDouble("duration", 0) * 1000) : 0;
        working = true;
        updatePower();
        ended = sawPlay = polling = false;
        media = error = "";
        failures = 0;
        anchor(start);
        main.removeCallbacks(poll);
        NetworkRenderer target = device;
        CastRelay publisher = relay;
        publisher.revoke();
        CastRelay.Source source = sources.forItem(next);
        String title = string(next.mediaMetadata.title), artist = string(next.mediaMetadata.artist), album = string(next.mediaMetadata.albumTitle);
        control.execute(() -> {
            if (rev != selection) return;
            try {
                CastRelay.Publication key = publisher.publish(source);
                if (rev != selection) return;
                String url = publisher.url(key);
                target.load(url, key.mime, title, artist, album);
                if (rev != selection) {
                    try { if (url.equals(target.read().uri)) target.stop(); } catch (IOException ignored) { }
                    return;
                }
                main.post(() -> {
                    if (rev != selection) return;
                    media = lastOwned = url;
                    working = false;
                    updatePower();
                    long startAt = position;
                    anchor(startAt);
                    if (wanted) transport(true, startAt, true);
                    else { finishConnect(""); schedulePoll(); }
                    invalidateState();
                });
            } catch (IOException e) {
                main.post(() -> { if (rev == selection) disconnect(true, "The renderer could not load this song. Check its supported audio formats and the Wi-Fi connection."); });
            }
        });
        invalidateState();
    }
    private static String string(CharSequence text) { return text == null ? "" : text.toString(); }
    private void schedulePoll() {
        main.removeCallbacks(poll);
        if (device != null && item != null) main.postDelayed(poll, 1500);
    }

    private void transport(boolean play, long seek, boolean changePlay) {
        int rev = selection, command = ++intent;
        NetworkRenderer target = device;
        control.execute(() -> {
            if (rev != selection || target == null) return;
            try {
                if (changePlay) {
                    if (play) target.play();
                    else target.pause();
                }
                String warning = "";
                if (seek >= 0 && (seek > 0 || !changePlay)) {
                    try { target.seek(seek); }
                    catch (IOException unsupported) { warning = "This renderer could not seek to that position."; }
                }
                String message = warning;
                main.post(() -> {
                    if (rev != selection || command != intent) return;
                    error = message;
                    finishConnect("");
                    schedulePoll();
                    invalidateState();
                });
            } catch (IOException e) {
                main.post(() -> {
                    if (rev != selection || command != intent) return;
                    if (pendingConnect != null) disconnect(true, "The renderer could not start playback.");
                    else {
                        error = "The renderer could not complete this command.";
                        schedulePoll();
                        invalidateState();
                    }
                });
            }
        });
    }

    private void poll() {
        if (device == null || working || polling || media.isEmpty()) return;
        polling = true;
        int rev = selection, command = intent;
        NetworkRenderer target = device;
        control.execute(() -> {
            try {
                NetworkRenderer.Reading read = target.read();
                main.post(() -> {
                    if (rev != selection) return;
                    polling = false;
                    if (command == intent) accept(read);
                    schedulePoll();
                });
            } catch (IOException e) {
                main.post(() -> {
                    if (rev != selection) return;
                    polling = false;
                    if (++failures >= 3) disconnect(false, "Lost the network speaker. Playback is paused on this phone.");
                    else schedulePoll();
                });
            }
        });
    }
    private void accept(NetworkRenderer.Reading reading) {
        failures = 0;
        if (!reading.uri.isEmpty() && !reading.uri.equals("NOT_IMPLEMENTED") && !media.equals(reading.uri)) {
            disconnect(false, "Another source is using this renderer.");
            return;
        }
        if (reading.duration > 0) duration = reading.duration;
        long previous = currentPosition();
        if (("FINISHED".equals(reading.state) || "STOPPED".equals(reading.state) && sawPlay) && wanted) {
            sawPlay = false;
            if ("FINISHED".equals(reading.state) || duration <= 0 || previous >= duration - 3500) {
                int i = local.getCurrentMediaItemIndex();
                int next = local.getRepeatMode() == REPEAT_MODE_ONE ? i : local.getNextMediaItemIndex();
                if (!stopAtTrackEnd && next != C.INDEX_UNSET) {
                    if (next == i) load(item, 0);
                    else { local.seekTo(next, 0); syncTrack(); }
                    return;
                }
                ended = true;
                wanted = false;
                anchor(duration > 0 ? duration : previous);
            } else { wanted = false; anchor(previous); }
        } else if ("PLAYING".equals(reading.state) || "PAUSED_PLAYBACK".equals(reading.state)) {
            wanted = "PLAYING".equals(reading.state);
            if (wanted) sawPlay = true;
            ended = false;
            anchor(reading.position >= 0 ? reading.position : previous);
        }
        updatePower();
        invalidateState();
    }

    @Override protected State getState() {
        State base = super.getState();
        if (device == null || local.getMediaItemCount() == 0) return base;
        return base.buildUpon().setDeviceInfo(REMOTE)
                .setAvailableCommands(base.availableCommands.buildUpon()
                        .add(COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).add(COMMAND_SEEK_TO_MEDIA_ITEM)
                        .remove(COMMAND_SET_VOLUME).remove(COMMAND_SET_DEVICE_VOLUME)
                        .remove(COMMAND_ADJUST_DEVICE_VOLUME).remove(COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS)
                        .remove(COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS).build())
                .setPlayWhenReady(wanted, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                .setPlaybackState(working ? STATE_BUFFERING : ended ? STATE_ENDED : STATE_READY)
                .setPlaybackSuppressionReason(PLAYBACK_SUPPRESSION_REASON_NONE)
                .setPlayerError(null)
                .setContentPositionMs(this::currentPosition)
                .setContentBufferedPositionMs(this::currentPosition)
                .setTotalBufferedDurationMs(PositionSupplier.ZERO)
                .build();
    }
    @Override protected ListenableFuture<?> handleSetPlayWhenReady(boolean play) {
        if (device == null) { error = ""; return super.handleSetPlayWhenReady(play); }
        long p = currentPosition();
        wanted = play;
        updatePower();
        anchor(p);
        if (ended && play && item != null) load(item, 0);
        else if (!working && !media.isEmpty()) transport(play, play && !sawPlay ? p : -1, true);
        invalidateState();
        return Futures.immediateVoidFuture();
    }
    @Override protected ListenableFuture<?> handlePrepare() {
        if (device == null) return super.handlePrepare();
        syncTrack();
        return Futures.immediateVoidFuture();
    }
    @Override protected ListenableFuture<?> handleStop() {
        if (device == null) return super.handleStop();
        return handleSetPlayWhenReady(false);
    }
    @Override protected ListenableFuture<?> handleSeek(int index, long ms, int seekCommand) {
        if (device == null) return super.handleSeek(index, ms, seekCommand);
        if (index < 0 || index >= local.getMediaItemCount()) return Futures.immediateVoidFuture();
        long start = ms == C.TIME_UNSET ? 0 : Math.max(0, ms);
        MediaItem next = local.getMediaItemAt(index);
        local.seekTo(index, start);
        if (item == null || next.localConfiguration.tag != item.localConfiguration.tag) load(next, start);
        else {
            anchor(start);
            ended = false;
            if (!working && !media.isEmpty()) transport(wanted, start, false);
            invalidateState();
        }
        return Futures.immediateVoidFuture();
    }
    @Override protected ListenableFuture<?> handleRelease() {
        disconnect(true, "");
        control.shutdown();
        return super.handleRelease();
    }
}
