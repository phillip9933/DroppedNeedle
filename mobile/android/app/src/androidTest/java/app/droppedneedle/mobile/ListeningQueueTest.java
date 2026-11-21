package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class ListeningQueueTest {
    private final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
    @Test
    public void explicitShuffleHistorySurvivesReopeningAndIsScopedToTheListener() throws Exception {
        String prefix = "shuffle-test-" + UUID.randomUUID() + ".";
        Set<String> files = new HashSet<>();
        Context isolated = new ContextWrapper(app) {
            @Override
            public SharedPreferences getSharedPreferences(String name, int mode) {
                String file = prefix + name;
                files.add(file);
                return app.getSharedPreferences(file, mode);
            }
        };
        String base = "https://shuffle-fixture.invalid/dn";
        List<String> normal = Arrays.asList("private-A", "private-B");
        List<String> reverse = Arrays.asList("private-B", "private-A");
        try {
            SavedQueue.ShuffleHistory first =
                    SavedQueue.shuffleHistory(isolated, base, "first-token", "listener-A");
            ArrayList<String> opening = new ArrayList<>(normal);
            FreshShuffle.draw(opening, id -> id, first);
            assertEquals(reverse, opening);
            SavedQueue.flushShuffle(first);
            CompletableFuture<Void> done = new CompletableFuture<>();
            new SavedQueue(isolated).afterWrite(() -> done.complete(null));
            done.get(5, TimeUnit.SECONDS);
            String file = files.iterator().next();
            File xml = new File(new File(app.getDataDir(), "shared_prefs"), file + ".xml");
            String written = new String(Files.readAllBytes(xml.toPath()), StandardCharsets.UTF_8);
            SharedPreferences prefs = app.getSharedPreferences(file, Context.MODE_PRIVATE);
            assertEquals(2, prefs.getAll().size());
            for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
                if (entry.getKey().equals("_recent")) {
                    assertTrue(entry.getValue().toString().matches("[a-f0-9]{64}"));
                    continue;
                }
                assertTrue(entry.getKey().matches("[a-f0-9]{64}"));
                assertTrue(entry.getValue().toString().matches("[a-f0-9]{64}"));
                assertTrue(written.contains(entry.getKey()));
                assertTrue(written.contains(entry.getValue().toString()));
            }
            for (String privateValue : new String[] {base, "first-token", "listener-A", "private-A", "private-B"})
                assertFalse(written.contains(privateValue));
            FreshShuffle.History reopened =
                    SavedQueue.shuffleHistory(isolated, base + "/", "rotated-token", "listener-A");
            ArrayList<String> again = new ArrayList<>(normal);
            FreshShuffle.draw(again, id -> id, reopened);
            assertEquals(normal, again);
            for (FreshShuffle.History other : new FreshShuffle.History[] {
                         SavedQueue.shuffleHistory(isolated, base, "other-token", "listener-B"),
                         SavedQueue.shuffleHistory(isolated, base + "/different", "first-token", "listener-A"),
                         SavedQueue.shuffleHistory(isolated, base, "legacy-token", null)}) {
                ArrayList<String> separate = new ArrayList<>(normal);
                FreshShuffle.draw(separate, id -> id, other);
                assertEquals(reverse, separate);
            }
        } finally {
            CompletableFuture<Void> done = new CompletableFuture<>();
            new SavedQueue(isolated).afterWrite(() -> done.complete(null));
            done.get(5, TimeUnit.SECONDS);
            for (String file : files) {
                assertTrue(app.getSharedPreferences(file, Context.MODE_PRIVATE).edit().commit());
                app.deleteSharedPreferences(file);
            }
        }
    }

    private static CompletableFuture<JSArray> requestShuffle(
            Context context, String server, String user, List<String> ids, boolean serverOrder) {
        CompletableFuture<JSArray> selected = new CompletableFuture<>();
        SavedQueue.shuffleSelection(context, server, user, new JSArray(ids), serverOrder, (indices, error) -> {
            if (error == null)
                selected.complete(indices);
            else
                selected.completeExceptionally(error);
        });
        return selected;
    }

    @Test
    public void catalogueShuffleAcknowledgesDurableOccurrencesWithoutAnActivePlayer() throws Exception {
        String path = "shuffle-selection-" + UUID.randomUUID();
        SharedPreferences preferences = app.getSharedPreferences(path, Context.MODE_PRIVATE);
        Context isolated = new ContextWrapper(app) {
            @Override
            public SharedPreferences getSharedPreferences(String name, int mode) {
                return preferences;
            }
        };
        String server = "https://catalogue-shuffle.invalid/library";
        List<String> pair = Arrays.asList("private-first", "private-second");
        try {
            JSArray original = requestShuffle(isolated, server, "listener", pair, true).get(5, TimeUnit.SECONDS);
            assertEquals("[0,1]", original.toString());
            File xml = new File(new File(app.getDataDir(), "shared_prefs"), path + ".xml");
            String first = new String(Files.readAllBytes(xml.toPath()), StandardCharsets.UTF_8);
            assertFalse(first.contains("private-first"));
            List<CompletableFuture<JSArray>> requests = new ArrayList<>();
            for (int i = 0; i < 6; i++)
                requests.add(requestShuffle(isolated, server, "listener", pair, i % 2 == 0));
            for (int i = 0; i < requests.size(); i++)
                assertEquals(i % 2 == 0 ? "[1,0]" : "[0,1]", requests.get(i).get(5, TimeUnit.SECONDS).toString());
            JSArray duplicates = requestShuffle(isolated, server, "listener", Arrays.asList("a", "b", "a"), false)
                                         .get(5, TimeUnit.SECONDS);
            Set<Integer> occurrences = new HashSet<>();
            for (int i = 0; i < duplicates.length(); i++) occurrences.add(duplicates.getInt(i));
            assertEquals(new HashSet<>(Arrays.asList(0, 1, 2)), occurrences);
            for (CompletableFuture<JSArray> invalid :
                    Arrays.asList(requestShuffle(isolated, "https://listener:secret@catalogue-shuffle.invalid",
                                          "listener", pair, false),
                            requestShuffle(isolated, server, "", pair, false),
                            requestShuffle(isolated, server, "listener", Arrays.asList("a", "../b"), false))) {
                try {
                    invalid.get(5, TimeUnit.SECONDS);
                    fail("Invalid shuffle input");
                } catch (java.util.concurrent.ExecutionException expected) {
                    assertTrue(expected.getCause() instanceof IllegalArgumentException);
                }
            }
        } finally {
            app.deleteSharedPreferences(path);
        }
    }

    @Test
    public void aFailedDurableCommitRejectsTheCatalogueSelection() throws Exception {
        String file = "shuffle-write-error-" + UUID.randomUUID();
        SharedPreferences underlying = app.getSharedPreferences(file, Context.MODE_PRIVATE);
        SharedPreferences failed = (SharedPreferences) java.lang.reflect.Proxy.newProxyInstance(
                SharedPreferences.class.getClassLoader(), new Class<?>[] {SharedPreferences.class},
                (proxy, method, args) -> {
                    if (!method.getName().equals("edit"))
                        return method.invoke(underlying, args);
                    SharedPreferences.Editor real = underlying.edit();
                    return java.lang.reflect.Proxy.newProxyInstance(
                            SharedPreferences.Editor.class.getClassLoader(),
                            new Class<?>[] {SharedPreferences.Editor.class}, (editor, write, params) -> {
                                if (write.getName().equals("commit"))
                                    return false;
                                Object result = write.invoke(real, params);
                                return result == real ? editor : result;
                            });
                });
        Context unavailable = new ContextWrapper(app) {
            @Override
            public SharedPreferences getSharedPreferences(String name, int mode) {
                return failed;
            }
        };
        try {
            try {
                requestShuffle(unavailable, "https://fixture.invalid", "listener", Arrays.asList("a", "b"), false)
                        .get(5, TimeUnit.SECONDS);
                fail("A failed write must not return a shuffled selection.");
            } catch (java.util.concurrent.ExecutionException expected) {
                assertTrue(expected.getCause() instanceof java.io.IOException);
            }
            assertFalse(SavedQueue
                            .flushShuffle(SavedQueue.shuffleHistory(
                                    unavailable, "https://fixture.invalid", "unused", "listener"))
                            .get(5, TimeUnit.SECONDS));
        } finally {
            assertTrue(underlying.edit().commit());
            app.deleteSharedPreferences(file);
        }
    }

    @Test
    public void recentShuffleMembershipsAreBoundedAndConcurrentWritersKeepTheirUpdates() throws Exception {
        String file = "shuffle-limit-" + UUID.randomUUID();
        SharedPreferences preferences = app.getSharedPreferences(file, Context.MODE_PRIVATE);
        Context isolated = new ContextWrapper(app) {
            @Override
            public SharedPreferences getSharedPreferences(String ignored, int mode) {
                return preferences;
            }
        };
        java.util.concurrent.ExecutorService writers = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            FreshShuffle.History history =
                    SavedQueue.shuffleHistory(isolated, "https://fixture.invalid", "token", "listener");
            List<String> groups = new ArrayList<>();
            for (int i = 0; i < 153; i++) groups.add(OfflineStore.digest("group" + i));
            String order = OfflineStore.digest("order");
            for (int i = 0; i < 128; i++) history.remember(groups.get(i), order);
            history.remember(groups.get(0), order); // Refresh the oldest membership.
            history.remember(groups.get(128), order);
            assertNull(history.previous(groups.get(1)));
            assertEquals(order, history.previous(groups.get(0)));
            java.util.concurrent.CountDownLatch ready = new java.util.concurrent.CountDownLatch(1);
            List<java.util.concurrent.Future<?>> writes = new ArrayList<>();
            for (int start : new int[] {129, 141}) {
                writes.add(writers.submit(() -> {
                    FreshShuffle.History concurrent =
                            SavedQueue.shuffleHistory(isolated, "https://fixture.invalid", "token", "listener");
                    ready.await();
                    for (int i = start; i < start + 12; i++) concurrent.remember(groups.get(i), order);
                    return null;
                }));
            }
            ready.countDown();
            for (java.util.concurrent.Future<?> write : writes) write.get(10, TimeUnit.SECONDS);
            FreshShuffle.History reopened =
                    SavedQueue.shuffleHistory(isolated, "https://fixture.invalid", "token", "listener");
            int kept = 0;
            for (String group : groups)
                if (reopened.previous(group) != null)
                    kept++;
            assertEquals(128, kept);
            assertEquals(129, preferences.getAll().size());
            assertEquals(order, reopened.previous(groups.get(0)));
            for (int i = 128; i < 153; i++) assertEquals(order, reopened.previous(groups.get(i)));
        } finally {
            writers.shutdownNow();
            assertTrue(preferences.edit().commit());
            CompletableFuture<Void> done = new CompletableFuture<>();
            new SavedQueue(isolated).afterWrite(() -> done.complete(null));
            done.get(15, TimeUnit.SECONDS);
            app.deleteSharedPreferences(file);
        }
    }

    @Test
    public void originalOrderKeepsThePlayingDuplicateAndPositionAfterARehydratedShuffle() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            ExoPlayer deck = new ExoPlayer.Builder(app).build();
            try {
                ArrayList<MediaItem> tracks = new ArrayList<>();
                for (String id : new String[] {"a", "b", "a", "c", "d"})
                    tracks.add(new MediaItem.Builder()
                                    .setMediaId(id)
                                    .setUri("https://example.test/" + id)
                                    .setTag(new JSONObject())
                                    .build());
                deck.setMediaItems(tracks, 0, 0);
                QueueOrder order = new QueueOrder();
                order.toggle(deck, null);
                int second = -1;
                ArrayList<MediaItem> shown = new ArrayList<>();
                for (int i = 0; i < tracks.size(); i++) {
                    MediaItem item = deck.getMediaItemAt(i);
                    shown.add(item);
                    if (item.localConfiguration.tag == tracks.get(2).localConfiguration.tag)
                        second = i;
                }
                assertTrue(second > 0);
                deck.seekTo(second, 3210);
                QueueOrder reopened = new QueueOrder();
                reopened.restore(shown, order.save(deck));
                reopened.toggle(deck, null);
                assertFalse(reopened.shuffled());
                assertEquals(2, deck.getCurrentMediaItemIndex());
                assertEquals(3210, deck.getCurrentPosition());
                assertSame(
                        tracks.get(2).localConfiguration.tag, deck.getCurrentMediaItem().localConfiguration.tag);
            } finally {
                deck.release();
            }
        });
    }

    @Test
    public void localMusicPlanSkipsPreviouslyHeardRecordingsExternalMediaAndDuplicateFiles() throws Exception {
        String mbid = "11111111-1111-1111-1111-111111111111", recording = "22222222-2222-2222-2222-222222222222";
        JSONObject former = new JSONObject()
                                    .put("id", "old")
                                    .put("title", "Jazz")
                                    .put("artist", "Artist")
                                    .put("artistMbid", mbid)
                                    .put("recordingMbid", recording);
        JSONObject row = new JSONObject()
                                 .put("track_name", "New")
                                 .put("artist_name", "Artist")
                                 .put("artist_mbid", mbid)
                                 .put("in_library", true)
                                 .put("local_file_id", "new");
        JSONArray tracks = new JSONArray()
                                   .put(new JSONObject(row.toString()).put("local_file_id", "old"))
                                   .put(new JSONObject(row.toString())
                                                   .put("local_file_id", "other")
                                                   .put("recording_mbid", recording))
                                   .put(new JSONObject(row.toString()).put("in_library", false))
                                   .put(row)
                                   .put(row);
        String data = new JSONObject().put("tracks", tracks).toString();
        AtomicReference<String> request = new AtomicReference<>();
        OkHttpClient http = new OkHttpClient.Builder()
                                    .addInterceptor(chain -> {
                                        assertEquals("/prefix/api/v3/discover/radio/plan",
                                                chain.request().url().encodedPath());
                                        Buffer body = new Buffer();
                                        chain.request().body().writeTo(body);
                                        request.set(body.readUtf8());
                                        return new Response.Builder()
                                                .request(chain.request())
                                                .protocol(Protocol.HTTP_1_1)
                                                .code(200)
                                                .message("OK")
                                                .body(ResponseBody.create(data, MediaType.get("application/json")))
                                                .build();
                                    })
                                    .build();
        PlaybackService.Access owner =
                new PlaybackService.Access(app, "https://queue-test.invalid/prefix", "fixture", "radio-user");
        JSArray result = new SimilarMusic(http, owner).plan((JSArray) new JSArray().put(former), new JSONArray());
        assertEquals(1, result.length());
        assertEquals("new", result.getJSONObject(0).getString("id"));
        assertEquals("https://queue-test.invalid/prefix/api/v3/stream/local/new",
                result.getJSONObject(0).getString("streamUrl"));
        assertEquals(
                recording, new JSONObject(request.get()).getJSONArray("exclude_recording_mbids").getString(0));
    }

    @Test
    public void pcmProcessorAppliesBothBoostAndAttenuationAndPreservesUnity() {
        PlaybackSound.GainProcessor processor = new PlaybackSound.GainProcessor();
        processor.queueInput(androidx.media3.common.audio.AudioProcessor.EMPTY_BUFFER);
        assertFalse(processor.getOutput().hasRemaining());
        for (float factor : new float[] {0.5f, 1, 2}) {
            ByteBuffer pcm = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder());
            pcm.putShort((short) 10000).putShort((short) -20000).flip();
            processor.factor = factor;
            processor.queueInput(pcm);
            ByteBuffer out = processor.getOutput();
            assertEquals(Math.round(10000 * factor), out.getShort());
            assertEquals(Math.max(-32768, Math.round(-20000 * factor)), out.getShort());
        }
    }
}
