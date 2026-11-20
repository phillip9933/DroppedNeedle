package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.os.SystemClock;
import androidx.media3.common.DeviceInfo;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.cast.MediaLoadRequestData;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class CastPlaybackTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final Context context = instrumentation.getTargetContext();
    private RoutedPlayer player;

    private static MediaItem song(String id) throws Exception {
        return new MediaItem.Builder().setMediaId(id).setUri("https://dn.example/api/v3/stream/local/" + id)
                .setTag(new JSONObject().put("duration", 120)).setMediaMetadata(new MediaMetadata.Builder()
                        .setTitle(id).setArtist("Fixture").setAlbumTitle("Only on this device").build()).build();
    }
    private void await(String description, BooleanSupplier condition) throws Exception {
        long end = SystemClock.elapsedRealtime() + 6500;
        do {
            CompletableFuture<Boolean> result = new CompletableFuture<>();
            instrumentation.runOnMainSync(() -> result.complete(condition.getAsBoolean()));
            if (result.get(2, TimeUnit.SECONDS)) return;
            SystemClock.sleep(80);
        } while (SystemClock.elapsedRealtime() < end);
        fail(description);
    }

    @Test public void realPlayerCastsMediaControlsAndQueueToALoopbackRenderer() throws Exception {
        File sample = File.createTempFile("dn-cast", ".mp3", context.getCacheDir());
        try (FileOutputStream stream = new FileOutputStream(sample)) {
            stream.write("ID3fixture".getBytes(StandardCharsets.US_ASCII));
        }
        try (SyntheticSpeaker speaker = new SyntheticSpeaker()) {
            DlnaRenderer device = speaker.describe();
            MediaItem first = song("First"), next = song("Second");
            CompletableFuture<String> connected = new CompletableFuture<>();
            try {
                instrumentation.runOnMainSync(() -> {
                    player = new RoutedPlayer(context, new ExoPlayer.Builder(context).build(),
                            item -> CastRelay.fromFile(sample, "audio/mpeg"));
                    player.connect(device, connected::complete);
                });
                assertEquals("", connected.get(5, TimeUnit.SECONDS));
                instrumentation.runOnMainSync(() -> {
                    player.setMediaItems(Arrays.asList(first, next), 0, 0);
                    player.prepare();
                    player.play();
                });
                await("The selected speaker is playing", () -> speaker.state.equals("PLAYING") && player.isPlaying());
                assertEquals("D3f", speaker.sample);
                String firstUrl = speaker.uri;
                instrumentation.runOnMainSync(() -> {
                    assertEquals(DeviceInfo.PLAYBACK_TYPE_REMOTE, player.getDeviceInfo().playbackType);
                    player.seekTo(42000);
                });
                await("Seek reached speaker", () -> speaker.time.equals("0:00:42"));
                instrumentation.runOnMainSync(() -> player.pause());
                await("Pause reached speaker", () -> speaker.state.equals("PAUSED_PLAYBACK") && !player.isPlaying());
                instrumentation.runOnMainSync(() -> { player.pauseRemoteAtEnd(true); player.play(); });
                await("The selected speaker resumed", () -> speaker.state.equals("PLAYING") && player.isPlaying());
                speaker.time = "0:01:59";
                await("The renderer reported the final second", () -> player.getCurrentPosition() >= 119000);
                speaker.state = "STOPPED";
                await("The renderer ended without advancing the queue", () -> !player.isPlaying()
                        && player.getPlaybackState() == androidx.media3.common.Player.STATE_ENDED);
                assertEquals(firstUrl, speaker.uri);
                instrumentation.runOnMainSync(() -> { assertEquals(0, player.getCurrentMediaItemIndex());
                    player.pauseRemoteAtEnd(false); player.seekToNextMediaItem(); player.play(); });
                await("Next item replaced the published media",
                        () -> !speaker.uri.equals(firstUrl) && speaker.state.equals("PLAYING") && player.getCurrentMediaItemIndex() == 1);
                assertEquals("Second", SyntheticSpeaker.element(speaker.metadata, "dc:title"));
                instrumentation.runOnMainSync(() -> player.disconnect(true, ""));
                await("Disconnect stopped the receiver", () -> speaker.state.equals("STOPPED"));
                instrumentation.runOnMainSync(() -> {
                    assertFalse(player.isPlaying());
                    assertEquals(1, player.getCurrentMediaItemIndex());
                    assertEquals(DeviceInfo.PLAYBACK_TYPE_LOCAL, player.getDeviceInfo().playbackType);
                });
            } finally {
                if (player != null) instrumentation.runOnMainSync(() -> player.release());
            }
        } finally { sample.delete(); }
    }

    @Test public void googleDefaultReceiverLoadContainsOnlyPhoneMediaAndTrackMetadata() {
        String uri = "http://192.0.2.17:53000/audio/synthetic.mp3";
        MediaLoadRequestData request = GoogleRenderer.request(uri, "audio/mpeg", "Song", "Artist", "Album");
        assertEquals(uri, request.getMediaInfo().getContentId());
        assertEquals("audio/mpeg", request.getMediaInfo().getContentType());
        assertEquals("Artist", request.getMediaInfo().getMetadata().getString(com.google.android.gms.cast.MediaMetadata.KEY_ARTIST));
        assertNull(request.getCredentials());
        assertNull(request.getCustomData());
        assertFalse(request.getAutoplay());
        assertEquals(com.google.android.gms.cast.CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID,
                new GoogleCastOptions().getCastOptions(context).getReceiverApplicationId());
    }
}
