package app.droppedneedle.mobile;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.crypto.SecretKey;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class SavedQueueTest {
    private final Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final File dir = new File(target.getCacheDir(), "queue-test-" + UUID.randomUUID());
    private final Context isolated = new ContextWrapper(target) {
        @Override public File getNoBackupFilesDir() { return dir; }
    };

    private JSONObject load(SecretKey key) throws Exception {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        new SavedQueue(isolated).load(key, result::complete);
        return result.get(5, TimeUnit.SECONDS);
    }

    @Test public void checkpointIsEncryptedAndRequiresTheSameServerAndSession() throws Exception {
        String server = "https://dn.example/tenant";
        String token = "fixture-session";
        SecretKey key = SavedQueue.key(server, token);
        SavedQueue saved = new SavedQueue(isolated);
        JSONObject queue = new JSONObject().put("revision", "latest").put("position", 1000)
                .put("tracks", new JSONArray().put("Private title").put("Another track"));
        try {
            saved.write(key, queue, true);
            saved.write(key, new JSONObject().put("revision", "previous").put("position", 777), false);
            assertEquals(1000, load(key).getInt("position"));
            saved.write(key, new JSONObject().put("revision", "latest").put("position", 4250)
                    .put("index", 1).put("repeat", 2), false);
            JSONObject reopened = load(key);
            assertEquals(4250, reopened.getInt("position"));
            assertEquals(1, reopened.getInt("index"));
            assertEquals(2, reopened.getInt("repeat"));
            assertEquals("Another track", reopened.getJSONArray("tracks").getString(1));
            for (String name : new String[]{"playback-queue.v1", "playback-cursor.v1"}) {
                String stored = new String(Files.readAllBytes(new File(dir, name).toPath()),
                        StandardCharsets.ISO_8859_1);
                assertFalse(stored.contains(token));
                assertFalse(stored.contains(server));
                assertFalse(stored.contains("Private title"));
                assertFalse(stored.contains("revision"));
            }
            assertNull(load(SavedQueue.key(server, "different-session")));
            assertNull(load(key));
            saved.write(key, queue, true);
            assertNull(load(SavedQueue.key("https://dn.example/another-tenant", token)));
            assertNull(load(key));
            saved.write(key, queue, true);
            saved.clear();
            assertNull(load(key));
        } finally {
            saved.clear();
            load(key);
            dir.delete();
        }
    }
}
