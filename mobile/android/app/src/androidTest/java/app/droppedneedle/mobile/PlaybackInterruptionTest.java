package app.droppedneedle.mobile;

import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.media.AudioManager;
import android.os.IBinder;
import android.os.SystemClock;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.SilenceMediaSource;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class PlaybackInterruptionTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private PlaybackService playback;
    private ExoPlayer player;

    @Test public void aTransientInterruptionPausesThePhonePlayerAndResumesTheSameTrack() throws Exception {
        Context app = instrumentation.getTargetContext();
        CountDownLatch connected = new CountDownLatch(1);
        ServiceConnection binding = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                playback = ((PlaybackService.LocalBinder) binder).service();
                player = (ExoPlayer) playback.onGetSession(null).getPlayer();
                connected.countDown();
            }
            @Override public void onServiceDisconnected(ComponentName name) {}
        };
        AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        AudioManager.OnAudioFocusChangeListener interruption = focus -> {};
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            awaitAppReady(activity);
            Intent intent = new Intent(app, PlaybackService.class).setAction(PlaybackService.LOCAL_BIND);
            assertTrue(app.bindService(intent, binding, Context.BIND_AUTO_CREATE));
            try {
                assertTrue("Playback service connected", connected.await(10, TimeUnit.SECONDS));
                instrumentation.runOnMainSync(() -> {
                    // Keep the service's queue and production audio-focus configuration. Substitute
                    // a finite silent source so the interruption is independent of codecs and TLS.
                    JSObject track = new JSObject();
                    track.put("id", "focus-test");
                    track.put("title", "Interruption");
                    track.put("artist", "Test artist");
                    track.put("album", "Test album");
                    String address = "https://127.0.0.1:1";
                    track.put("streamUrl", address + "/api/v3/stream/local/focus-test");
                    try {
                        JSArray queue = new JSArray();
                        queue.put(track);
                        playback.setQueue(address, "fixture", queue, 0, null);
                    } catch (org.json.JSONException error) {
                        throw new AssertionError(error);
                    }
                    SilenceMediaSource.Factory source = new SilenceMediaSource.Factory().setDurationUs(120_000_000L);
                    player.setMediaSources(java.util.Arrays.asList(source.createMediaSource(), source.createMediaSource()));
                    player.prepare();
                });
                await("Track is audible", () -> player.isPlaying() && playback.snapshot().optBoolean("playing"));
                assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED,
                        audio.requestAudioFocus(interruption, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT));
                await("Android suppressed playback", () -> player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS);
                instrumentation.runOnMainSync(() -> {
                    assertFalse("The phone must show that playback is interrupted", playback.snapshot().optBoolean("playing"));
                    assertEquals(0, playback.snapshot().optInt("index"));
                });
                audio.abandonAudioFocus(interruption);
                await("The same track resumed", () -> player.isPlaying() && playback.snapshot().optBoolean("playing") && playback.snapshot().optInt("index") == 0);
                instrumentation.runOnMainSync(() -> {
                    androidx.media3.common.MediaItem current = player.getCurrentMediaItem();
                    long before = player.getCurrentPosition();
                    assertEquals(2, player.getMediaItemCount());
                    playback.command("clearUpcoming", 0, -1);
                    assertEquals(1, player.getMediaItemCount());
                    assertSame(current, player.getCurrentMediaItem());
                    assertTrue(player.isPlaying());
                    assertTrue(player.getCurrentPosition() >= before);
                });
            } finally {
                audio.abandonAudioFocus(interruption);
                if (playback != null) instrumentation.runOnMainSync(() -> playback.command("clear", 0, -1));
                app.unbindService(binding);
            }
        }
    }

    // Startup intentionally clears orphaned playback before rendering the signed-out form.
    private void awaitAppReady(ActivityScenario<MainActivity> activity) throws Exception {
        long end = SystemClock.elapsedRealtime() + 10_000;
        do {
            CompletableFuture<Boolean> ready = new CompletableFuture<>();
            activity.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(
                    "Boolean(document.querySelector('main form, nav[aria-label=Music]'))",
                    value -> ready.complete("true".equals(value))));
            if (ready.get(2, TimeUnit.SECONDS)) return;
            SystemClock.sleep(50);
        } while (SystemClock.elapsedRealtime() < end);
        fail("The application did not finish restoring its session.");
    }

    private void await(String description, BooleanSupplier condition) {
        long end = SystemClock.elapsedRealtime() + 10_000;
        AtomicBoolean satisfied = new AtomicBoolean();
        do {
            instrumentation.runOnMainSync(() -> satisfied.set(condition.getAsBoolean()));
            if (satisfied.get()) return;
            SystemClock.sleep(25);
        } while (SystemClock.elapsedRealtime() < end);
        fail(description);
    }
}
