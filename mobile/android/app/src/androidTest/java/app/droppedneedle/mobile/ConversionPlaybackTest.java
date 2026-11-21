package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.Context;
import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.ByteArrayDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.TransferListener;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class ConversionPlaybackTest {
    private static final String ADDRESS = "https://offline.example/dn";
    private static final String STREAM = ADDRESS + "/api/v3/stream/local/track";
    private final Instrumentation instrument = InstrumentationRegistry.getInstrumentation();
    private final Context context = instrument.getTargetContext();

    /** The fixture serves short real ffmpeg segments. A seek outside one must restart the server source. */
    private static final class Gateway implements DataSource {
        private final String format;
        private final ByteArrayDataSource audio;
        private final List<DataSpec> requests;
        private final boolean fallback;
        private final boolean live;
        private boolean direct;

        Gateway(String format, byte[] bytes, List<DataSpec> requests, boolean fallback, boolean live) {
            this.format = format;
            this.audio = new ByteArrayDataSource(bytes);
            this.requests = requests;
            this.fallback = fallback;
            this.live = live;
        }
        @Override
        public long open(DataSpec spec) throws IOException {
            requests.add(spec);
            direct = "raw".equals(spec.uri.getQueryParameter("format"));
            if (fallback && !direct)
                throw new HttpDataSource.InvalidResponseCodeException(
                        409, "", null, Collections.emptyMap(), spec, new byte[0]);
            long size = audio.open(spec);
            return direct ? size : C.LENGTH_UNSET;
        }
        @Override
        public Map<String, List<String>> getResponseHeaders() {
            return Map.of("Accept-Ranges", List.of(direct ? "bytes" : "none"), "Content-Type",
                    List.of(format.equals("opus") ? "audio/ogg" : "audio/mpeg"));
        }
        @Override
        public void addTransferListener(TransferListener listener) {
            audio.addTransferListener(listener);
        }
        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = audio.read(buffer, offset, length);
            if (live && count == C.RESULT_END_OF_INPUT) {
                // Ten seconds of this 180-second song are available. Keep the producer open like a
                // network stream so an out-of-buffer seek must reopen it. Media3 interrupts on seek.
                try {
                    Thread.sleep(10_000);
                } catch (InterruptedException cancelled) {
                    throw new java.io.InterruptedIOException();
                }
                throw new IOException("The simulated live input timed out.");
            }
            return count;
        }
        @Override
        public Uri getUri() {
            return audio.getUri();
        }
        @Override
        public void close() {
            audio.close();
        }
    }
    private byte[] sample(String format) throws IOException {
        try (InputStream in = instrument.getContext().getAssets().open("offline/silence." + format)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int count;
            while ((count = in.read(buffer)) != -1)
                out.write(buffer, 0, count);
            return out.toByteArray();
        }
    }
    @Test
    public void mp3ReopensAtBothRequestedTimesAndDecodesAtAbsolutePosition() throws Exception {
        seek("mp3");
    }
    @Test
    public void opusReopensAtBothRequestedTimesAndDecodesAtAbsolutePosition() throws Exception {
        seek("opus");
    }
    private void seek(String format) throws Exception {
        byte[] bytes = sample(format);
        List<DataSpec> requests = new CopyOnWriteArrayList<>();
        CompletableFuture<Boolean> initial = new CompletableFuture<>();
        ExoPlayer[] holder = new ExoPlayer[1];
        JSONObject track = new JSONObject().put("duration", 180);
        instrument.runOnMainSync(() -> {
            ConversionSource source = new ConversionSource(timeline
                    -> new OfflineDataSource(
                            null, () -> new Gateway(format, bytes, requests, false, true), timeline));
            ExoPlayer player = new ExoPlayer.Builder(context).setMediaSourceFactory(source).build();
            holder[0] = player;
            player.setVolume(0);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY)
                        initial.complete(true);
                }
                @Override
                public void onPlayerError(PlaybackException failure) {
                    initial.completeExceptionally(failure);
                }
            });
            player.setMediaItem(new MediaItem.Builder()
                            .setUri(STREAM + "?format=" + format + "&max_bitrate=128")
                            .setTag(track)
                            .build());
            player.prepare();
        });
        try {
            assertTrue(initial.get(8, TimeUnit.SECONDS));
            // Android may deliver a queued READY notification from the previous command. Wait for the
            // requested network segment and its decoded samples before issuing a second user gesture.
            for (long target : new long[] {93_250, 31_125}) {
                instrument.runOnMainSync(() -> {
                    assertTrue(holder[0].isCurrentMediaItemSeekable());
                    assertEquals(180_000, holder[0].getDuration());
                    holder[0].seekTo(target);
                    holder[0].play();
                });
                long deadline = android.os.SystemClock.elapsedRealtime() + 4_000;
                boolean played = false;
                long[] observation = new long[2];
                String expected = String.format(java.util.Locale.ROOT, "%.3f", target / 1000.0);
                while (!played && android.os.SystemClock.elapsedRealtime() < deadline) {
                    instrument.runOnMainSync(() -> {
                        observation[0] = holder[0].getCurrentPosition();
                        observation[1] = holder[0].isPlaying() ? 1 : 0;
                    });
                    played = requests.stream().anyMatch(
                                     s -> expected.equals(s.uri.getQueryParameter("start_seconds")))
                            && observation[1] == 1 && observation[0] > target + 50;
                    if (!played)
                        Thread.sleep(20);
                }
                StringBuilder captured = new StringBuilder();
                for (DataSpec s : requests)
                    captured.append(s.uri).append(" [").append(s.position).append("] ");
                assertTrue("Expected " + expected + "s; position=" + observation[0] + ", playing=" + observation[1]
                                + ", opened " + captured,
                        played);
                instrument.runOnMainSync(() -> holder[0].pause());
            }
            for (DataSpec s : requests)
                assertEquals("The server receives a time seek at byte zero", 0, s.position);
        } finally {
            instrument.runOnMainSync(() -> holder[0].release());
        }
    }

    @Test
    public void HTTP409RetriesOriginalAndOnlyCompleteByteZeroReadsPopulateTheCache() throws Exception {
        byte[] bytes = sample("mp3");
        List<DataSpec> requests = new CopyOnWriteArrayList<>();
        OfflineStore store = OfflineStore.forUser(context, ADDRESS, UUID.randomUUID().toString());
        store.configure(new JSONObject()
                        .put("autoCache", true)
                        .put("offlineOnly", false)
                        .put("unmeteredOnly", false)
                        .put("cacheMiB", 128));
        JSONObject track = new JSONObject().put("id", "track").put("title", "Fixture track");
        OfflineDataSource.Library library = new OfflineDataSource.Library() {
            @Override
            public OfflineStore store() {
                return store;
            }
            @Override
            public JSONObject metadata(String id) {
                return track;
            }
        };
        Uri converted = Uri.parse(STREAM + "?format=mp3&max_bitrate=96");
        try {
            OfflineDataSource first =
                    new OfflineDataSource(library, () -> new Gateway("mp3", bytes, requests, false, false));
            first.open(new DataSpec(ConversionSource.streamAt(converted, 5000)));
            drain(first);
            assertNull("An offset conversion must not masquerade as a full song", store.playable(STREAM));
            OfflineDataSource source =
                    new OfflineDataSource(library, () -> new Gateway("mp3", bytes, requests, true, false));
            source.open(new DataSpec(converted));
            assertArrayEquals(bytes, drain(source));
            assertEquals("raw", requests.get(requests.size() - 1).uri.getQueryParameter("format"));
            assertNotNull(store.playable(STREAM));
            int before = requests.size();
            DataSpec range = new DataSpec.Builder().setUri(converted).setPosition(37).setLength(31).build();
            source.open(range);
            assertArrayEquals(java.util.Arrays.copyOfRange(bytes, 37, 68), drain(source));
            assertEquals(before, requests.size());
        } finally {
            store.remove(new JSONArray().put("track"));
        }
    }
    private byte[] drain(DataSource source) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[256];
            int count;
            while ((count = source.read(buffer, 0, buffer.length)) != C.RESULT_END_OF_INPUT)
                out.write(buffer, 0, count);
            return out.toByteArray();
        } finally {
            source.close();
        }
    }
    @Test public void completedMp3AndOpusDownloadsServeLocalByteSeeksOffline() throws Exception {
        for (String format : new String[]{"mp3","opus"}) {
            byte[] audio = sample(format);
            OfflineStore store = OfflineStore.forUser(context,ADDRESS,UUID.randomUUID().toString());
            JSONObject track = new JSONObject().put("id","track").put("title","Offline");
            try (OfflineStore.Capture output = store.begin(track,true,audio.length)) {
                output.write(audio,0,audio.length);
                output.finish(format.equals("mp3") ? "audio/mpeg" : "audio/ogg");
            }
            store.configure(store.options().put("offlineOnly",true));
            OfflineDataSource.Library library = new OfflineDataSource.Library() {
                public OfflineStore store() { return store; }
                public JSONObject metadata(String id) { return track; }
            };
            OfflineDataSource source = new OfflineDataSource(library,() -> { throw new AssertionError("Offline seek reached the network"); },new ConversionSource.Timeline(180000));
            try {
                int offset = audio.length / 2;
                DataSpec request = new DataSpec.Builder().setUri(STREAM + "?format=mp3&max_bitrate=192").setPosition(offset).build();
                assertEquals(audio.length - offset,source.open(request));
                byte[] data = new byte[8];
                assertEquals(8,source.read(data,0,8));
                assertArrayEquals(java.util.Arrays.copyOfRange(audio,offset,offset+8),data);
                assertEquals("file",source.getUri().getScheme());
            } finally { source.close(); store.remove(new org.json.JSONArray().put("track")); }
        }
    }

}
