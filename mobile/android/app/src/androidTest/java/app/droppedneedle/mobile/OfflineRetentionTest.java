package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;

public class OfflineRetentionTest {
    final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    final HeadsetAccount owner = new HeadsetAccount(
            HttpUrl.get("https://fixture.invalid/music"), "private-session", UUID.randomUUID().toString());
    final OfflineStore store = OfflineStore.forUser(context, owner.server.toString(), owner.userId);
    JSONObject track(String id) throws Exception {
        return new JSONObject()
                .put("id", id)
                .put("title", "Private title")
                .put("artist", "Private artist")
                .put("album", "Private album")
                .put("albumId", "prior-album")
                .put("rating", 3)
                .put("artworkUrl", "/api/v3/library/albums/album/artwork?size=500");
    }
    void save(JSONObject track, boolean manual) throws Exception {
        try (OfflineStore.Capture file = store.begin(track, manual, 4)) {
            assertNotNull(file);
            file.write(new byte[] {1, 2, 3, 4}, 0, 4);
            file.finish();
        }
    }
    @Test
    public void readAheadSettingsSurviveOldClientsAndObsoleteCaptureNeverPublishes() throws Exception {
        JSONObject options = store.options();
        assertEquals(0, options.getInt("readAheadCellular"));
        store.configure(options.put("autoCache", true)
                        .put("unmeteredOnly", false)
                        .put("completeDownloads", false)
                        .put("readAheadWifi", 5)
                        .put("readAheadCellular", 1)
                        .put("readAheadCellularKiBps", 128));
        JSONObject legacy = store.options();
        legacy.remove("readAheadWifi");
        legacy.remove("readAheadCellularKiBps");
        store.configure(legacy);
        assertEquals(5, store.ahead(StreamProfiles.Path.WIFI, false));
        assertEquals(1, store.ahead(StreamProfiles.Path.CELLULAR, false));
        assertEquals(128, store.ahead(StreamProfiles.Path.CELLULAR, true));
        try (OfflineStore.Capture file = store.begin(track("stale"), false, 4)) {
            file.write(new byte[4], 0, 4);
            file.finish(null, () -> false);
        }
        assertFalse(store.hasAudio("stale"));
        save(track("nearer"), false);
        long capacity = store.cacheRoom(Set.of());
        assertEquals(capacity - 4, store.cacheRoom(Set.of("nearer")));
        assertNull(store.begin(track("farther"), OfflineStore.CACHE, null, capacity, Set.of("nearer")));
        assertTrue(store.hasAudio("nearer"));
        save(track("mine"), true);
        assertFalse(store.wantsAhead("mine"));
        store.clearCache();
        assertTrue(store.hasAudio("mine"));
        store.remove(new JSONArray().put("mine"));
        assertFalse(store.wantsAhead("mine"));
    }
    @Test
    public void changedQueueCancelsInFlightCallAndFetchesSelectedStreamQualityAsCache() throws Exception {
        var route = StreamProfiles.active(context);
        org.junit.Assume.assumeTrue(route == StreamProfiles.Path.WIFI || route == StreamProfiles.Path.CELLULAR);
        store.configure(
                store.options().put("readAheadWifi", 2).put("readAheadCellular", 2).put("completeDownloads", false));
        var access = new PlaybackService.Access(context, owner.server.toString(), owner.token, owner.userId);
        var profile = new JSONObject().put("format", "opus").put("rate", 96);
        access.profiles.set(profile, profile);
        var requested = new java.util.concurrent.CountDownLatch(1);
        var canceled = new java.util.concurrent.atomic.AtomicReference<okhttp3.Call>();
        byte[] song = OfflinePlaybackTest.wav();
        var originals = new AtomicInteger();
        var http = new OkHttpClient.Builder()
                           .addInterceptor(chain -> {
                               var req = chain.request();
                               assertEquals("Bearer " + owner.token, req.header("Authorization"));
                               assertSame(access, req.tag(PlaybackService.Access.class));
                               boolean raw = "raw".equals(req.url().queryParameter("format"));
                               if (!raw) {
                                   assertEquals("opus", req.url().queryParameter("format"));
                                   assertEquals("96", req.url().queryParameter("max_bitrate"));
                               }
                               if (req.url().encodedPath().endsWith("/old")) {
                                   canceled.set(chain.call());
                                   requested.countDown();
                                   try {
                                       new java.util.concurrent.CountDownLatch(1).await(
                                               5, java.util.concurrent.TimeUnit.SECONDS);
                                   } catch (InterruptedException stop) {
                                       throw new java.io.IOException("Canceled", stop);
                                   }
                               }
                               if (!raw)
                                   return new Response.Builder()
                                           .request(req)
                                           .protocol(Protocol.HTTP_1_1)
                                           .code(409)
                                           .message("Conversion unavailable")
                                           .body(ResponseBody.create(null, new byte[0]))
                                           .build();
                               originals.incrementAndGet();
                               return new Response.Builder()
                                       .request(req)
                                       .protocol(Protocol.HTTP_1_1)
                                       .code(200)
                                       .message("OK")
                                       .header("Content-Type", "audio/wav")
                                       .body(ResponseBody.create(MediaType.get("audio/wav"), song))
                                       .build();
                           })
                           .build();
        var worker = new QueueReadAhead();
        try {
            for (String id : List.of("old", "new")) {
                android.net.Uri uri =
                        access.profiles.track().forRequest(android.net.Uri.parse(store.original(id).toString()));
                worker.schedule(context, access, route, 0, List.of(new QueueReadAhead.Entry(id, uri, track(id))),
                        "playing", http);
                if (id.equals("old"))
                    assertTrue(requested.await(5, java.util.concurrent.TimeUnit.SECONDS));
            }
            long end = android.os.SystemClock.elapsedRealtime() + 5000;
            while (!store.hasAudio("new") && android.os.SystemClock.elapsedRealtime() < end)
                android.os.SystemClock.sleep(20);
            assertTrue(canceled.get().isCanceled());
            assertFalse(store.hasAudio("old"));
            assertTrue(store.hasAudio("new"));
            assertEquals("cached", store.snapshot().getJSONArray("items").getJSONObject(0).getString("origin"));
            assertEquals(1, originals.get());
            store.configure(store.options().put("offlineOnly", true));
            var source = new OfflineDataSource(access,
                    () -> { throw new AssertionError("An offline play must use the completed queue cache."); });
            try {
                var address = android.net.Uri.parse(store.original("new").toString());
                assertEquals(song.length, source.open(new androidx.media3.datasource.DataSpec(address)));
                byte[] played = new byte[song.length];
                int read = 0;
                while (read < played.length) {
                    int count = source.read(played, read, played.length - read);
                    assertTrue(count > 0);
                    read += count;
                }
                assertArrayEquals(song, played);
            } finally {
                source.close();
            }
        } finally {
            worker.close();
        }
    }
    @Test
    public void cellularReadAheadRequiresItsOwnOptInAndRespectsForcedOfflineWhileDownloadsStayUnmetered()
            throws Exception {
        assertTrue(store.unmeteredOnly());
        assertFalse(store.readAheadOn(StreamProfiles.Path.CELLULAR));
        store.configure(store.options().put("readAheadWifi", 3));
        assertTrue(store.readAheadOn(StreamProfiles.Path.WIFI));
        assertFalse(store.readAheadOn(StreamProfiles.Path.CELLULAR));
        store.configure(store.options().put("readAheadCellular", 1));
        assertTrue(store.unmeteredOnly());
        assertTrue(store.readAheadOn(StreamProfiles.Path.CELLULAR));
        assertFalse(store.readAheadOn(StreamProfiles.Path.UNKNOWN));
        store.configure(store.options().put("offlineOnly", true));
        assertFalse(store.readAheadOn(StreamProfiles.Path.WIFI));
        assertFalse(store.readAheadOn(StreamProfiles.Path.CELLULAR));
        store.configure(store.options().put("offlineOnly", false).put("readAheadCellular", 0));
        assertFalse(store.readAheadOn(StreamProfiles.Path.CELLULAR));
        assertTrue(store.unmeteredOnly());
    }
    @Test
    public void downloadsShareCoverAndTheirOwnLyricsAndRemovalCannotRepopulate() throws Exception {
        store.configure(store.options().put("unmeteredOnly", false));
        byte[] image = android.util.Base64.decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXh8AAAAASUVORK5CYII=", 0);
        String path = "/api/v3/library/albums/album/artwork";
        AtomicInteger covers = new AtomicInteger();
        for (String id : List.of("one", "two")) {
            JSONObject track = track(id);
            save(track, true);
            OfflineCompanions.prepare(store, owner, track, req -> {
                assertEquals("fixture.invalid", req.url().host());
                assertEquals("Bearer private-session", req.header("Authorization"));
                boolean art = req.url().encodedPath().endsWith(path);
                if (art)
                    covers.incrementAndGet();
                else
                    assertTrue(req.url().encodedPath().endsWith("/" + id + "/lyrics"));
                String type = art ? "image/png" : "application/json";
                byte[] bytes =
                        art ? image : ("{\"is_synced\":false,\"lines\":[{\"text\":\"" + id + "\"}]}").getBytes();
                return new Response.Builder()
                        .request(req)
                        .protocol(Protocol.HTTP_1_1)
                        .code(200)
                        .message("OK")
                        .header("Content-Type", type)
                        .body(ResponseBody.create(MediaType.get(type), bytes))
                        .build();
            }, () -> true, false);
        }
        assertEquals(1, covers.get());
        assertTrue(store.companions().cover(path).startsWith("data:image/png;base64,"));
        assertTrue(store.companions().field(OfflineStore.digest("one"), "lyrics").contains("one"));
        long revision = store.itemRevision("one");
        store.remove(new JSONArray().put("one"));
        store.putCompanions("one", revision, path, null, "stale", null);
        assertNull(store.companions().field(OfflineStore.digest("one"), "lyrics"));
        assertNotNull(store.companions().cover(path));
        store.remove(new JSONArray().put("two"));
        assertNull(store.companions().cover(path));
    }
    @Test
    public void refreshFindsMovedTrackWithoutDownloadingAudioAndDiagnosticsAreAllowlisted() throws Exception {
        store.configure(store.options().put("unmeteredOnly", false).put("completeDownloads", false));
        save(track("private-id"), true);
        save(track("missing-id"), true);
        OkHttpClient api =
                new OkHttpClient.Builder()
                        .addInterceptor(chain -> {
                            var req = chain.request();
                            String json;
                            if (req.url().encodedPath().endsWith("/ratings/lookup"))
                                json = "{\"tracks\":{\"private-id\":5}}";
                            else if (req.url().encodedPath().endsWith("/library/tracks"))
                                json = req.url().queryParameter("album_id") != null
                                        ? "{\"items\":[],\"total\":0,\"next\":null}"
                                        : "{\"items\":[{\"id\":\"private-id\",\"title\":\"Updated\",\"album_title\":"
                                                + "\"New "
                                                + "album\",\"album_id\":\"new-album\"}],\"total\":1,\"next\":null}";
                            else
                                throw new AssertionError("Unexpected request");
                            return new Response.Builder()
                                    .request(req)
                                    .protocol(Protocol.HTTP_1_1)
                                    .code(200)
                                    .message("OK")
                                    .body(ResponseBody.create(MediaType.get("application/json"), json))
                                    .build();
                        })
                        .build();
        JSONObject result =
                new PinnedDownloads(context, store, owner, api, () -> owner, () -> false).refreshMetadata();
        assertEquals(1, result.getInt("updated"));
        assertEquals(1, result.getInt("unavailable"));
        JSONObject kept = store.savedTrack("private-id");
        assertEquals("Updated", kept.getString("title"));
        assertEquals(5, kept.getInt("rating"));
        assertTrue(store.hasAudio("missing-id"));
        JSONObject report = store.diagnostics(StreamProfiles.Path.WIFI, 1, 0, 2);
        Set<String> fields = new HashSet<>();
        report.keys().forEachRemaining(fields::add);
        assertEquals(Set.of("reportVersion", "platform", "appVersion", "versionCode", "androidApi", "connection",
                             "offlineOnly", "unmeteredOnly", "downloadedTracks", "automaticTracks", "cachedTracks",
                             "audioMiB", "playbackCacheLimitMiB", "pendingDownloads", "failedDownloads",
                             "pendingOfflineListens", "readAheadWifiTracks", "readAheadCellularTracks"),
                fields);
        assertEquals(2, report.getInt("downloadedTracks"));
        for (String secret : List.of("private", "fixture.invalid", "Updated", "New album", owner.userId))
            assertFalse(report.toString().contains(secret));
    }
    @After
    public void clearSyntheticAccount() {
        File dir = new File(new File(context.getNoBackupFilesDir(), "dn-offline"), store.account);
        File[] files = dir.listFiles();
        if (files != null)
            for (File file : files) file.delete();
        dir.delete();
        context.deleteSharedPreferences("dn.offline." + store.account);
    }
}
