package app.droppedneedle.mobile;

import android.app.Instrumentation;
import android.content.Context;
import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.ByteArrayDataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class StreamProfilesTest {
    private static final String SERVER = "https://quality.example/music";
    private static final Uri ONE = Uri.parse(SERVER + "/api/v3/stream/local/one");
    private static final Uri TWO = Uri.parse(SERVER + "/api/v3/stream/local/two");
    private final Instrumentation instrument = InstrumentationRegistry.getInstrumentation();
    private final Context target = instrument.getTargetContext();
    private final String account = UUID.randomUUID().toString();
    private final AtomicReference<StreamProfiles.Path> path = new AtomicReference<>(StreamProfiles.Path.WIFI);
    private final StreamProfiles profiles = new StreamProfiles(target, SERVER, account, path::get);

    private static JSONObject quality(String format, int kbps) throws Exception {
        return new JSONObject().put("format", format).put("rate", kbps);
    }

    @Test public void preparedQueueOpensTheNextSongUsingTheNewConnection() throws Exception {
        profiles.set(quality("mp3", 160), quality("opus", 64));
        byte[] sample = OfflinePlaybackTest.wav();
        List<Uri> requests = new CopyOnWriteArrayList<>();
        CompletableFuture<Boolean> ended = new CompletableFuture<>();
        ExoPlayer[] holder = new ExoPlayer[1];
        instrument.runOnMainSync(() -> {
            ConversionSource media = new ConversionSource(timeline -> new OfflineDataSource(null,
                    () -> new ByteArrayDataSource(uri -> {
                        requests.add(uri);
                        // The user selected both songs on Wi-Fi. The route changes while the first
                        // stream is open. Even if ExoPlayer prebuffers the next one, it now uses cellular.
                        if ("one".equals(uri.getLastPathSegment())) path.set(StreamProfiles.Path.CELLULAR);
                        return sample;
                    }), timeline, profiles.track()));
            ExoPlayer player = new ExoPlayer.Builder(target).setMediaSourceFactory(media).build();
            holder[0] = player;
            player.setVolume(0);
            player.addListener(new Player.Listener() {
                @Override public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_ENDED) ended.complete(true);
                }
                @Override public void onPlayerError(PlaybackException failure) { ended.completeExceptionally(failure); }
            });
            player.setMediaItems(Arrays.asList(MediaItem.fromUri(ONE), MediaItem.fromUri(TWO)));
            player.prepare();
            player.play();
        });
        try {
            assertTrue(ended.get(12, TimeUnit.SECONDS));
            assertTrue(requests.stream().anyMatch(uri -> "one".equals(uri.getLastPathSegment())));
            assertTrue(requests.stream().anyMatch(uri -> "two".equals(uri.getLastPathSegment())));
            for (Uri uri : requests) {
                boolean first = "one".equals(uri.getLastPathSegment());
                assertEquals(first ? "mp3" : "opus", uri.getQueryParameter("format"));
                assertEquals(first ? "160" : "64", uri.getQueryParameter("max_bitrate"));
            }
        } finally { instrument.runOnMainSync(() -> holder[0].release()); }
    }

    @Test public void retriesAndByteRangesKeepAStartedRepresentationAndReconnectPicksAFreshOne() throws Exception {
        profiles.set(quality("mp3", 192), quality("opus", 128));
        List<Uri> requests = new CopyOnWriteArrayList<>();
        byte[] bytes = {1, 2, 3, 4};
        OfflineDataSource playing = new OfflineDataSource(null, () -> new ByteArrayDataSource(uri -> {
            requests.add(uri);
            return bytes;
        }), new ConversionSource.Timeline(C.TIME_UNSET), profiles.track());
        path.set(StreamProfiles.Path.OFFLINE);
        try {
            playing.open(new DataSpec(ONE));
            fail("No HTTP open should be attempted without a route.");
        } catch (IOException expected) { assertTrue(requests.isEmpty()); }
        path.set(StreamProfiles.Path.CELLULAR);
        playing.open(new DataSpec(ONE));
        playing.close();
        path.set(StreamProfiles.Path.WIFI);
        profiles.set(quality("original", 192), quality("mp3", 96));
        playing.open(new DataSpec.Builder().setUri(ONE).setPosition(1).setLength(2).build());
        playing.close();
        assertEquals(2, requests.size());
        assertEquals(requests.get(0), requests.get(1));
        assertEquals("opus", requests.get(1).getQueryParameter("format"));
        assertEquals("128", requests.get(1).getQueryParameter("max_bitrate"));
        assertEquals(TWO, profiles.track().forRequest(TWO));
    }

    @Test public void legacyQueuesAndMigrationStayPrivateToOneServerAndListener() throws Exception {
        Uri legacy = ONE.buildUpon().appendQueryParameter("format", "mp3").appendQueryParameter("max_bitrate", "256").build();
        assertEquals(legacy, profiles.track().forRequest(legacy));
        JSONObject migrated = new JSONObject().put("wifi", quality("opus", 192)).put("cellular", quality("opus", 96));
        profiles.migrate(migrated);
        assertEquals("opus", profiles.track().forRequest(legacy).getQueryParameter("format"));
        profiles.set(quality("original", 192), quality("mp3", 128));
        StreamProfiles reopened = new StreamProfiles(target, SERVER + "/", account, path::get);
        reopened.migrate(migrated);
        assertEquals(ONE, reopened.track().forRequest(legacy));
        assertEquals(legacy, new StreamProfiles(target, SERVER, account + "2", path::get).track().forRequest(legacy));
        assertEquals(legacy, new StreamProfiles(target, SERVER + "/other", account, path::get).track().forRequest(legacy));
        path.set(StreamProfiles.Path.UNKNOWN);
        assertEquals("128", profiles.track().forRequest(legacy).getQueryParameter("max_bitrate"));
        assertEquals(StreamProfiles.Path.WIFI, StreamProfiles.classify(false, true, false, true));
        assertEquals(StreamProfiles.Path.WIFI, StreamProfiles.classify(true, false, false, false));
        assertEquals(StreamProfiles.Path.CELLULAR, StreamProfiles.classify(false, false, true, true));
        assertEquals(StreamProfiles.Path.CELLULAR, StreamProfiles.classify(true, false, true, false));
        assertEquals(StreamProfiles.Path.CELLULAR, StreamProfiles.classify(false, false, false, false));
        assertEquals(StreamProfiles.Path.UNKNOWN, StreamProfiles.classify(false, false, false, true));
    }
}
