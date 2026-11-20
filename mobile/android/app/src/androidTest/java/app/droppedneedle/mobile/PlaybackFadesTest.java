package app.droppedneedle.mobile;

import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.SilenceMediaSource;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class PlaybackFadesTest {
    @Test public void realPlayerRampsUpAndDownAndCanDisableFades() throws Exception {
        Instrumentation test = InstrumentationRegistry.getInstrumentation();
        Context app = test.getTargetContext();
        SharedPreferences isolated = app.getSharedPreferences("test_track_fades", Context.MODE_PRIVATE);
        Context preferenceContext = new ContextWrapper(app) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return isolated; }
        };
        CompletableFuture<Boolean> full = new CompletableFuture<>(), tail = new CompletableFuture<>();
        ExoPlayer[] player = new ExoPlayer[1];
        PlaybackFades[] fades = new PlaybackFades[1];
        try {
            test.runOnMainSync(() -> {
                player[0] = new ExoPlayer.Builder(app).build();
                ExoPlayer audio = player[0];
                fades[0] = new PlaybackFades(preferenceContext, audio);
                fades[0].configure(500);
                audio.addListener(new Player.Listener() {
                    @Override public void onVolumeChanged(float volume) {
                        if (audio.getCurrentPosition() >= 400 && volume >= .98f) full.complete(true);
                        if (full.isDone() && audio.getCurrentPosition() > 1800 && volume <= .4f) tail.complete(true);
                    }
                    @Override public void onPlayerError(PlaybackException error) {
                        full.completeExceptionally(error);
                        tail.completeExceptionally(error);
                    }
                });
                audio.setMediaSource(new SilenceMediaSource.Factory().setDurationUs(2200000L).createMediaSource());
                audio.prepare();
                audio.play();
            });
            assertTrue(full.get(8, TimeUnit.SECONDS));
            assertTrue(tail.get(8, TimeUnit.SECONDS));
            test.runOnMainSync(() -> {
                fades[0].release();
                fades[0] = new PlaybackFades(preferenceContext, player[0]);
                assertEquals(500, fades[0].length());
                fades[0].configure(0);
                assertEquals(1.0f, player[0].getVolume(), 0.001f);
            });
        } finally {
            test.runOnMainSync(() -> {
                if (fades[0] != null) fades[0].release();
                if (player[0] != null) player[0].release();
            });
            isolated.edit().clear().commit();
        }
    }
}
