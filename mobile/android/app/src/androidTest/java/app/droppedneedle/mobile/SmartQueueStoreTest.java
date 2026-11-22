package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class SmartQueueStoreTest {
    @Test public void encryptedTenThousandTrackWindowRestoresNearEndOfflineAndRetainsItsPreviousQueue() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File dir = Files.createTempDirectory(app.getCacheDir().toPath(), "smart-queue").toFile();
        Context isolated = new ContextWrapper(app) { @Override public File getNoBackupFilesDir() { return dir; } };
        String id = UUID.randomUUID().toString(), server = "https://smart.invalid/dn",
                token = "fixture-session", user = "fixture-listener";
        try {
            SmartQueueStore store = new SmartQueueStore(isolated);
            for (int offset = 0; offset < 10000; offset += 100) {
                JSONArray tracks = new JSONArray();
                for (int i = offset; i < offset + 100; i++) tracks.put(new JSONObject()
                        .put("id", "track-" + (i % 5000)).put("title", "Occurrence " + i));
                store.write(server, token, user, id, offset, 10000, tracks);
            }
            String page = new String(Files.readAllBytes(new File(dir, "smart-queues/" + id + "/9600").toPath()),
                    java.nio.charset.StandardCharsets.ISO_8859_1);
            assertFalse(page.contains("Occurrence"));

            SavedQueue saved = new SavedQueue(isolated);
            JSONObject archive = new JSONObject().put("revision", "fixture").put("tracks", new JSONArray())
                    .put("continuation", LibraryWindow.smart(id, 9600, 10000).state());
            javax.crypto.SecretKey key = SavedQueue.key(server, token);
            saved.write(key, archive, true);
            CompletableFuture<Void> written = new CompletableFuture<>();
            saved.afterWrite(() -> written.complete(null));
            written.get(10, TimeUnit.SECONDS);

            SmartQueueStore reopened = new SmartQueueStore(isolated);
            LibraryWindow cursor = LibraryWindow.parse(new SavedQueue(isolated).inspect(key).getJSONObject("continuation"), 100);
            try {
                reopened.read(server, token, "second-listener", cursor);
                fail("a different account read the playlist");
            } catch (javax.crypto.AEADBadTagException expected) { }
            // Track 9,592 is playing. The listener promoted track 9,599 and inserted an unrelated pick.
            int[] visible = new int[102];
            for (int i = 0; i <= 92; i++) visible[i] = 9500 + i;
            visible[93] = 9599;
            visible[94] = -1;
            visible[95] = -1;
            for (int i = 96; i < visible.length; i++) visible[i] = 9593 + i - 96;
            boolean[] priority = new boolean[102];
            priority[93] = priority[94] = priority[95] = true;
            LibraryWindow mixed = SmartQueueOrder.toggle(cursor, visible, priority, 92);
            assertEquals(9594, mixed.loaded);
            assertEquals(9599, mixed.sourceIndex(9593));
            archive.put("continuation", mixed.state());
            saved.write(key, archive, true);
            saved.write(key, new JSONObject().put("revision", "fixture").put("continuation", mixed.state(false)), false);
            CompletableFuture<Void> checkpointed = new CompletableFuture<>();
            saved.afterWrite(() -> checkpointed.complete(null));
            checkpointed.get(10, TimeUnit.SECONDS);
            LibraryWindow persisted = LibraryWindow.parse(new SavedQueue(isolated).inspect(key).getJSONObject("continuation"), 94);
            assertEquals(mixed.smartOrder.packed, persisted.smartOrder.packed);
            java.util.Set<Integer> remaining = new java.util.HashSet<>();
            LibraryWindow.Batch firstBatch = reopened.read(server, token, user, mixed);
            for (int i = 0; i < firstBatch.tracks.length(); i++) {
                int position = firstBatch.tracks.getJSONObject(i).getInt("smartIndex");
                assertEquals(mixed.sourceIndex(9594+i), position);
                assertEquals("Occurrence " + position, firstBatch.tracks.getJSONObject(i).getString("title"));
            }
            for (int i = 9594; i < 10000; i++) {
                int position = persisted.sourceIndex(i);
                assertTrue(position > 9592 && position != 9599);
                assertTrue(remaining.add(position));
            }
            assertEquals(406, remaining.size());
            assertTrue("Shuffle draws from beyond the next source page",
                    java.util.stream.IntStream.range(9594,9694).anyMatch(i -> persisted.sourceIndex(i) >= 9700));
            for (int offset = 9600; offset < 10000; offset += 100) {
                LibraryWindow.Batch batch = reopened.read(server, token, user, cursor);
                assertEquals("Occurrence " + offset, batch.tracks.getJSONObject(0).getString("title"));
                assertEquals(100, batch.tracks.length());
                cursor = batch.cursor;
            }
            assertNull(cursor.after);
            assertEquals("Occurrence 0", reopened.read(server, token, user, cursor).tracks.getJSONObject(0).getString("title"));
            reopened.retain(new JSONObject().put("previousQueue", archive));
            assertTrue(new File(dir, "smart-queues/" + id).isDirectory());
            reopened.retain(null);
            assertFalse(new File(dir, "smart-queues/" + id).exists());
        } finally {
            try (java.util.stream.Stream<java.nio.file.Path> files = Files.walk(dir.toPath())) {
                files.sorted(java.util.Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
            }
        }
    }
}
