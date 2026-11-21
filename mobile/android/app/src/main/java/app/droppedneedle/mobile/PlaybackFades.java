package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.ByteArrayDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/** The service owns one queue. A short second audio sink can finish its measured outgoing tail. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlaybackFades implements Player.Listener {
    private static final long PREPARE_AHEAD_MS = 45_000;
    private final Player player;
    private final Context context;
    private final SharedPreferences preferences;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable update = this::refresh;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Supplier<SmartFadeAudio.Reader> analysis;
    private final BooleanSupplier permitsMix;
    private int fadeIn, fadeOut;
    private boolean smart, advancing, closed, updating;
    private Boundary upcoming, mixing;
    private MediaItem gaplessIntro;

    private static final class Boundary {
        final MediaItem from, to;
        TrackWaveform.Job job;
        ExoPlayer tail;
        int overlap, start;
        boolean measured;
        Boundary(MediaItem from, MediaItem to) { this.from = from; this.to = to; }
        void close() {
            if (job != null) { job.cancel(); job = null; }
            if (tail != null) { ExoPlayer previous = tail; tail = null; previous.release(); }
        }
    }

    PlaybackFades(Context context, Player player, Supplier<SmartFadeAudio.Reader> analysis, BooleanSupplier permitsMix) {
        this.player = player;
        this.context = context.getApplicationContext();
        this.analysis = analysis;
        this.permitsMix = permitsMix;
        preferences = context.getSharedPreferences("dn_track_fades", Context.MODE_PRIVATE);
        int previous = allowed(preferences.getInt("milliseconds", 0));
        fadeIn = allowed(preferences.getInt("fadeInMs", previous));
        fadeOut = allowed(preferences.getInt("fadeOutMs", previous));
        smart = preferences.getBoolean("smart", false);
        player.addListener(this);
        refresh();
    }

    private static int allowed(int value) {
        switch (value) {
            case 500: case 2000: case 4000: case 8000: return value;
            default: return 0;
        }
    }

    JSObject settings() {
        JSObject settings = new JSObject();
        settings.put("fadeInMs", fadeIn);
        settings.put("fadeOutMs", fadeOut);
        settings.put("smart", smart);
        if (fadeIn == fadeOut) settings.put("milliseconds", fadeIn);
        return settings;
    }

    void configure(Integer in, Integer out, Boolean automatic) {
        if (in != null) fadeIn = allowed(in);
        if (out != null) fadeOut = allowed(out);
        if (automatic != null && smart != automatic) {
            smart = automatic;
            discardUpcoming();
            finishMix();
            gaplessIntro = null;
        }
        preferences.edit().remove("milliseconds").putInt("fadeInMs", fadeIn)
                .putInt("fadeOutMs", fadeOut).putBoolean("smart", smart).apply();
        refresh();
    }

    private static boolean same(MediaItem a, MediaItem b) { return a == b || a != null && a.equals(b); }

    boolean automaticAdvance(MediaItem item) { return advancing && mixing != null && same(item, mixing.to); }

    @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
        if (automaticAdvance(item)) { gaplessIntro = item; return; }
        boolean natural = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT;
        gaplessIntro = natural && upcoming != null && upcoming.measured && upcoming.overlap == 0 && same(upcoming.to, item)
                ? item : null;
        discardUpcoming();
        finishMix();
    }

    @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK && !advancing) {
            gaplessIntro = null;
            finishMix();
        }
    }

    @Override public void onEvents(Player source, Player.Events events) {
        if (events.containsAny(Player.EVENT_POSITION_DISCONTINUITY, Player.EVENT_IS_PLAYING_CHANGED,
                Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_PLAYBACK_STATE_CHANGED,
                Player.EVENT_TIMELINE_CHANGED, Player.EVENT_PLAYBACK_PARAMETERS_CHANGED,
                Player.EVENT_PLAY_WHEN_READY_CHANGED, Player.EVENT_PLAYBACK_SUPPRESSION_REASON_CHANGED,
                Player.EVENT_REPEAT_MODE_CHANGED, Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED)) refresh();
    }

    private void discardUpcoming() {
        Boundary old = upcoming;
        upcoming = null;
        if (old != null) old.close();
    }

    private void finishMix() {
        Boundary old = mixing;
        mixing = null;
        if (old != null) old.close();
    }

    void sourceChanged() {
        if (closed) return;
        discardUpcoming();
        main.removeCallbacks(update);
        main.post(update);
    }

    private void prepare(Boundary pair) {
        if (SmartFadePlan.albumOrder(SmartFadeAudio.metadata(pair.from), SmartFadeAudio.metadata(pair.to))) {
            pair.measured = true;
            return;
        }
        TrackWaveform.Job job = new TrackWaveform.Job("transition", 32_000);
        pair.job = job;
        SmartFadeAudio.Reader reader = analysis.get(); // captures this queue's authenticated account
        worker.execute(() -> {
            try {
                SmartFadeAudio.Edge outgoing = reader.read(pair.from, true, job);
                job.check();
                SmartFadeAudio.Edge incoming = reader.read(pair.to, false, job);
                job.check();
                int overlap = SmartFadePlan.overlap(outgoing.rms, incoming.rms, outgoing.duration, incoming.duration);
                main.post(() -> measured(pair, outgoing, overlap));
            } catch (IOException | RuntimeException ignored) {
                // Independent fades continue when an edge cannot be measured.
            }
        });
    }

    private void measured(Boundary pair, SmartFadeAudio.Edge edge, int overlap) {
        if (closed || upcoming != pair || !permitsMix.getAsBoolean()) return;
        pair.job = null;
        pair.overlap = overlap;
        if (overlap == 0) {
            pair.measured = true;
        } else {
            try {
                pair.start = edge.windowMs - overlap;
                ExoPlayer tail = new ExoPlayer.Builder(context).setAudioAttributes(AudioAttributes.DEFAULT, false).build();
                pair.tail = tail;
                if (player instanceof ExoPlayer) {
                    int id = ((ExoPlayer) player).getAudioSessionId();
                    if (id > 0) tail.setAudioSessionId(id);
                }
                tail.setVolume(0);
                tail.setPlaybackParameters(player.getPlaybackParameters());
                tail.addListener(new Player.Listener() {
                    @Override public void onPlaybackStateChanged(int state) {
                        if (upcoming == pair && state == Player.STATE_READY) { pair.measured = true; refresh(); }
                        if (mixing == pair && state == Player.STATE_ENDED) { finishMix(); refresh(); }
                    }
                    @Override public void onPlayerError(PlaybackException error) {
                        if (upcoming == pair || mixing == pair) {
                            pair.measured = false;
                            if (mixing == pair) finishMix(); else pair.close();
                            refresh();
                        }
                    }
                });
                byte[] pcm = edge.wave;
                ProgressiveMediaSource source = new ProgressiveMediaSource.Factory(() -> new ByteArrayDataSource(pcm))
                        .createMediaSource(MediaItem.fromUri("memory:///transition.wav"));
                tail.setMediaSource(source, pair.start);
                tail.prepare();
            } catch (RuntimeException unavailable) { pair.close(); }
        }
        refresh();
    }

    void refresh() {
        if (closed) return;
        main.removeCallbacks(update);
        if (updating) { main.post(update); return; }
        updating = true;
        try { tick(); } finally { updating = false; }
    }

    private void tick() {
        MediaItem item = player.getCurrentMediaItem();
        long duration = player.getDuration();
        if (duration <= 0) duration = SmartFadeAudio.durationMs(item);
        long position = player.getCurrentPosition();
        boolean mayMix = smart && permitsMix.getAsBoolean() && item != null && player.getPlayWhenReady()
                && player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_NONE
                && player.getPlayerError() == null && player.getPlaybackState() != Player.STATE_IDLE;
        long delay = Long.MAX_VALUE;

        if (mixing != null) {
            int previous = player.getPreviousMediaItemIndex();
            if (!mayMix || !same(item, mixing.to) || previous == C.INDEX_UNSET
                    || !same(player.getMediaItemAt(previous), mixing.from) || mixing.tail.getPlaybackState() == Player.STATE_ENDED) finishMix();
            else {
                ExoPlayer tail = mixing.tail;
                tail.setPlaybackParameters(player.getPlaybackParameters());
                double progress = Math.min(1, Math.max(0, (tail.getCurrentPosition() - mixing.start) / (double) mixing.overlap));
                level(tail, (float) Math.cos(progress * Math.PI / 2));
                level(player, (float) Math.sin(progress * Math.PI / 2));
                if (progress >= 1) finishMix();
            }
        }

        int next = mayMix && player.getRepeatMode() != Player.REPEAT_MODE_ONE ? player.getNextMediaItemIndex() : C.INDEX_UNSET;
        MediaItem nextItem = next == C.INDEX_UNSET || next == player.getCurrentMediaItemIndex() ? null : player.getMediaItemAt(next);
        if (upcoming != null && (!same(item, upcoming.from) || !same(nextItem, upcoming.to))) discardUpcoming();
        if (nextItem != null && duration > 0 && upcoming == null && player.isPlaying()) {
            long beforePrepare = duration - position - PREPARE_AHEAD_MS;
            if (beforePrepare <= 0) {
                upcoming = new Boundary(item, nextItem);
                prepare(upcoming);
            } else delay = beforePrepare;
        }
        if (mixing != null) { schedule(24); return; }

        int in = same(gaplessIntro, item) ? 0 : fadeIn;
        int out = upcoming != null && upcoming.measured ? 0 : fadeOut;
        if (upcoming != null && upcoming.measured && upcoming.overlap > 0 && player.isPlaying()) {
            long beforeMix = duration - position - upcoming.overlap;
            if (beforeMix > 0) delay = Math.min(delay, beforeMix);
            else if (beforeMix >= -100) {
                Boundary pair = upcoming;
                upcoming = null;
                mixing = pair;
                advancing = true;
                try {
                    pair.tail.setPlaybackParameters(player.getPlaybackParameters());
                    level(pair.tail, 1);
                    pair.tail.play();
                    level(player, 0);
                    player.seekTo(next, 0);
                } finally { advancing = false; }
                main.post(update);
                return;
            } else {
                // Seeking into the planned overlap must never replay the old tail.
                upcoming.measured = false;
                upcoming.close();
                out = fadeOut;
            }
        }
        level(player, item == null ? 1 : SmartFadePlan.manual(position, duration, in, out));
        if (item == null || !player.isPlaying()) return;
        if (in > 0 && position < in) delay = Math.min(delay, 40);
        if (out > 0 && duration > 0) {
            long beforeFade = duration - position - out;
            delay = Math.min(delay, beforeFade <= 0 ? 40 : beforeFade);
        }
        if (delay < Long.MAX_VALUE) schedule(delay);
    }

    private void schedule(long ms) {
        main.postDelayed(update, Math.max(10, (long) (ms / player.getPlaybackParameters().speed)));
    }
    private static void level(Player deck, float volume) {
        if (deck.getVolume() != volume) deck.setVolume(volume);
    }

    void release() {
        closed = true;
        main.removeCallbacks(update);
        discardUpcoming();
        finishMix();
        worker.shutdownNow();
        player.removeListener(this);
    }
}
