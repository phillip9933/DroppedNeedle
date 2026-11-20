package app.droppedneedle.mobile;

import android.app.Instrumentation;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.SystemClock;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class OfflinePlayHistoryTest {
    private static final String BASE = "https://history-fixture.invalid/dn";
    private static final HttpUrl PLAYBACK = HttpUrl.get(BASE + "/api/v3/playback");
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final Context context = instrumentation.getTargetContext();
    private static long now() { return System.currentTimeMillis() / 1000; }

    private static void until(BooleanSupplier completed) throws Exception {
        long end = SystemClock.elapsedRealtime() + 5000;
        while (!completed.getAsBoolean() && SystemClock.elapsedRealtime() < end) Thread.sleep(10);
        assertTrue("Expected asynchronous storage operation to finish", completed.getAsBoolean());
    }
    private final BlockingQueue<JSONObject> calls = new LinkedBlockingQueue<>();
    private final OkHttpClient fixture = new OkHttpClient.Builder().addInterceptor(chain -> {
        assertEquals("history-fixture.invalid", chain.request().url().host());
        Buffer buffer = new Buffer();
        chain.request().body().writeTo(buffer);
        try {
            calls.add(new JSONObject(buffer.readUtf8())
                    .put("path", chain.request().url().encodedPath())
                    .put("credential", chain.request().header("Authorization")));
        } catch (JSONException invalid) { throw new IOException(invalid); }
        return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(ResponseBody.create(MediaType.get("application/json"), "{\"accepted\":true,\"services\":{}}")).build();
    }).build();

    private JSONObject next(String path) throws Exception {
        JSONObject request = calls.poll(5, TimeUnit.SECONDS);
        assertNotNull("Expected " + path, request);
        assertEquals(path, request.getString("path"));
        return request;
    }

    @Test public void withdrawingConsentDuringPlaybackAndSeekingToTheEndNeverRecordAnOfflinePlay() throws Exception {
        File path = File.createTempFile("dn-history-", ".sqlite", context.getCacheDir());
        File wav = File.createTempFile("dn-tone-", ".wav", context.getCacheDir());
        try (FileOutputStream output = new FileOutputStream(wav)) { output.write(OfflinePlaybackTest.wav()); }
        OfflineStore owner = OfflineStore.forUser(context, BASE, "fixture-consent");
        boolean consent = owner.recordsHistory();
        JSONObject options = owner.options();
        try (OfflinePlayStore db = new OfflinePlayStore(context, path)) {
            owner.recordHistory(true);
            owner.configure(new JSONObject(options.toString()).put("offlineOnly", false));
            play(wav, new OfflinePlayHistory(db, fixture, OfflinePlayHistoryTest::now), owner, () -> false,
                    0, "fixture", () -> {
                        try { owner.recordHistory(false); owner.recordHistory(true); }
                        catch (IOException error) { throw new AssertionError(error); }
                    });
            play(wav, new OfflinePlayHistory(db, fixture, OfflinePlayHistoryTest::now), owner, () -> false,
                    475, "fixture", () -> {});
            play(wav, new OfflinePlayHistory(db, fixture, OfflinePlayHistoryTest::now), owner, () -> false,
                    0, "fixture", () -> {});
            until(() -> db.count(owner.account) > 0);
            assertEquals(1, db.count(owner.account));
            assertTrue(calls.isEmpty());
            db.discard(owner.account);
            play(wav, new OfflinePlayHistory(db, fixture, OfflinePlayHistoryTest::now), owner, () -> true,
                    0, "fixture", () -> {});
            next("/dn/api/v3/playback/start");
            JSONObject stop;
            do {
                stop = calls.poll(5, TimeUnit.SECONDS);
                assertNotNull("Expected counted live stop", stop);
                assertTrue(stop.getString("path").startsWith("/dn/api/v3/playback/"));
            } while (!stop.getString("path").endsWith("/stop"));
            assertFalse(stop.getBoolean("ignore_scrobble"));
            assertEquals(0, db.count(owner.account));
        } finally {
            owner.recordHistory(consent);
            owner.configure(options);
            SQLiteDatabase.deleteDatabase(path);
            wav.delete();
        }
    }

    private void play(File wav, OfflinePlayHistory history, OfflineStore offline, BooleanSupplier net,
            long start, String token, Runnable audible) throws Exception {
        CompletableFuture<Boolean> ended = new CompletableFuture<>();
        ExoPlayer[] player = new ExoPlayer[1];
        PlaybackReporter[] reporter = new PlaybackReporter[1];
        instrumentation.runOnMainSync(() -> {
            ExoPlayer exo = new ExoPlayer.Builder(context).build();
            player[0] = exo;
            exo.setVolume(0);
            reporter[0] = new PlaybackReporter(context, exo, history, fixture, net);
            reporter[0].connect(PLAYBACK, token, offline);
            exo.addListener(new Player.Listener() {
                boolean started;
                @Override public void onEvents(Player ignored, Player.Events events) {
                    if (!started && exo.isPlaying()) {
                        started = true;
                        audible.run();
                    }
                    if (exo.getPlaybackState() == Player.STATE_ENDED) ended.complete(true);
                }
                @Override public void onPlayerError(PlaybackException error) { ended.completeExceptionally(error); }
            });
            MediaItem item = new MediaItem.Builder().setUri(Uri.fromFile(wav)).setMediaId("library-id")
                    .setTag(new JSONObject()).setMediaMetadata(new MediaMetadata.Builder()
                            .setTitle("Fixture tone").setArtist("A listener").setAlbumTitle("A record").build()).build();
            exo.setMediaItem(item, start);
            exo.prepare();
            exo.play();
        });
        try { assertTrue(ended.get(8, TimeUnit.SECONDS)); }
        finally {
            instrumentation.runOnMainSync(() -> {
                reporter[0].close();
                player[0].release();
            });
        }
    }

    @Test public void storedLocalListenWaitsForItsAccountAndOfflineModeThenUsesFreshCredentials() throws Exception {
        File path = File.createTempFile("dn-history-", ".sqlite", context.getCacheDir());
        File wav = File.createTempFile("dn-tone-", ".wav", context.getCacheDir());
        try (FileOutputStream output = new FileOutputStream(wav)) { output.write(OfflinePlaybackTest.wav()); }
        OfflineStore modes = OfflineStore.forUser(context, BASE, "fixture-history-listener");
        JSONObject previous = modes.options();
        OfflinePlayStore first = new OfflinePlayStore(context, path), reopened = new OfflinePlayStore(context, path);
        OfflinePlayHistory replay = new OfflinePlayHistory(reopened, fixture, OfflinePlayHistoryTest::now);
        AtomicBoolean connected = new AtomicBoolean(false);
        OfflinePlayHistory.Session alice = new OfflinePlayHistory.Session(PLAYBACK, "new-login", modes, connected::get);
        try {
            modes.configure(new JSONObject(previous.toString()).put("offlineOnly", true));
            long earliest = now();
            play(wav, new OfflinePlayHistory(first, fixture, OfflinePlayHistoryTest::now), modes,
                    connected::get, 0, "old-login", () -> connected.set(true));
            until(() -> first.last(alice.scope) > 0);
            assertTrue("No live start/progress/stop in offline mode", calls.isEmpty());
            first.close();
            OfflineStore bobStore = OfflineStore.forUser(context, BASE, "fixture-history-other");
            OfflinePlayHistory.Session bob = new OfflinePlayHistory.Session(PLAYBACK, "bob-token", bobStore, () -> true);
            reopened.add(bob.scope, OfflineScrobble.play("other", "Other", "Artist", "", 90_000, now()), now());
            replay.authorize(bob);
            assertEquals("other", next("/dn/api/v3/scrobble/submit").getString("track_id"));
            assertTrue(reopened.last(alice.scope) > 0);
            replay.authorize(alice);
            assertTrue(calls.isEmpty());

            ExoPlayer[] empty = new ExoPlayer[1];
            PlaybackReporter[] auth = new PlaybackReporter[1];
            instrumentation.runOnMainSync(() -> {
                empty[0] = new ExoPlayer.Builder(context).build();
                auth[0] = new PlaybackReporter(context, empty[0], replay, fixture, connected::get);
                auth[0].connect(PLAYBACK, "new-login", modes);
            });
            try {
                modes.configure(new JSONObject(previous.toString()).put("offlineOnly", false));
                JSONObject payload = next("/dn/api/v3/scrobble/submit");
                assertEquals("local", payload.getString("source"));
                assertEquals("library-id", payload.getString("track_id"));
                assertEquals("Fixture tone", payload.getString("track_name"));
                assertEquals("A listener", payload.getString("artist_name"));
                assertEquals("A record", payload.getString("album_name"));
                assertEquals("Bearer new-login", payload.getString("credential"));
                assertTrue(payload.getLong("timestamp") >= earliest && payload.getLong("timestamp") <= now());
                assertEquals(0, reopened.last(alice.scope));
                assertTrue(calls.isEmpty());
            } finally { instrumentation.runOnMainSync(() -> { auth[0].close(); empty[0].release(); }); }
        } finally {
            replay.close();
            first.close();
            reopened.close();
            modes.configure(previous);
            SQLiteDatabase.deleteDatabase(path);
            wav.delete();
        }
    }

    @Test public void uncertainClaimsStayConsumedAndOutOfWindowPlaysExpireAcrossAccounts() throws Exception {
        File path = File.createTempFile("dn-history-", ".sqlite", context.getCacheDir());
        long now = now();
        OfflinePlayHistory.Session source = new OfflinePlayHistory.Session(PLAYBACK, "old",
                OfflineStore.forUser(context, BASE, "fixture-expiry"), () -> true);
        OfflinePlayHistory.Session moved = new OfflinePlayHistory.Session(HttpUrl.get(BASE + "/other/api/v3/playback"),
                "new", OfflineStore.forUser(context, BASE + "/other", "fixture-expiry"), () -> true);
        try {
            try (OfflinePlayStore store = new OfflinePlayStore(context, path)) {
                for (long start : new long[]{now - OfflinePlayStore.MAX_AGE, now - 90, now + 61})
                    store.add(source.scope, OfflineScrobble.play("local", "Song", "Artist", "", 50_000, start), now);
                assertNull(store.claim(moved.scope, Long.MAX_VALUE, now));
                OfflinePlayStore.Play ambiguous = store.claim(source.scope, Long.MAX_VALUE, now);
                assertEquals(now - OfflinePlayStore.MAX_AGE, ambiguous.started);
                assertFalse(ambiguous.body.contains("old"));
            }
            try (OfflinePlayStore after = new OfflinePlayStore(context, path)) {
                OfflinePlayStore.Play next = after.claim(source.scope, Long.MAX_VALUE, now);
                assertEquals(now - 90, next.started);
                assertNull(after.claim(source.scope, Long.MAX_VALUE, now));
                after.put(next);
                OfflinePlayStore.Play inFlight = after.claim(source.scope, Long.MAX_VALUE, now);
                after.discard(source.scope);
                after.retry(inFlight);
                assertEquals(0, after.count(source.scope));
                after.add(source.scope, new JSONObject(next.body), now);
                after.prune(now + OfflinePlayStore.MAX_AGE);
                assertEquals(0, after.last(source.scope));
            }
        } finally { SQLiteDatabase.deleteDatabase(path); }
    }
}
