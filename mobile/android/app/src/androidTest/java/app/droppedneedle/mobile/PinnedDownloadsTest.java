package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class PinnedDownloadsTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final HeadsetAccount owner =
            new HeadsetAccount(HttpUrl.get("https://offline.invalid/subpath"), "fake", UUID.randomUUID().toString());
    private final OfflineStore store = OfflineStore.forUser(context, owner.server.toString(), owner.userId);
    private JSONObject pin(String name) throws JSONException {
        return new JSONObject().put("id", name).put("kind", "playlist").put("name", name);
    }
    private String list(String id, String... tracks) throws JSONException {
        JSONArray rows = new JSONArray();
        for (String t : tracks)
            rows.put(new JSONObject()
                            .put("id", "row-" + t)
                            .put("source_type", "local")
                            .put("track_source_id", t)
                            .put("track_name", t)
                            .put("artist_name", "Artist")
                            .put("album_name", "Album"));
        return new JSONObject()
                .put("id", id)
                .put("name", id)
                .put("is_owner", true)
                .put("is_redacted", false)
                .put("track_count", rows.length())
                .put("tracks", rows)
                .toString();
    }
    @Test
    public void backgroundRunnerDeduplicatesAcrossPinsAndKeepsCopiesOnPartialMembership() throws Exception {
        store.configure(store.options()
                        .put("unmeteredOnly", false)
                        .put("offlinePins", new JSONArray().put(pin("A")).put(pin("B")))
                        .put("downloadQuality", new JSONObject().put("format", "opus").put("rate", 96)));
        Set<String> fetched = new HashSet<>();
        AtomicBoolean partial = new AtomicBoolean(), edited = new AtomicBoolean();
        OkHttpClient fixture =
                new OkHttpClient.Builder()
                        .addInterceptor(chain -> {
                            Request req = chain.request();
                            assertEquals("Bearer fake", req.header("Authorization"));
                            String path = req.url().encodedPath(), mime = "application/json", body = "";
                            int status = 200;
                            try {
                                if (path.endsWith("/playlists/A"))
                                    body = edited.get() ? list("A", "shared") : list("A", "shared", "old");
                                else if (path.endsWith("/playlists/B")) {
                                    if (partial.get())
                                        status = 403;
                                    else
                                        body = list("B", "shared", "new");
                                } else if (path.endsWith("/ratings/lookup"))
                                    body = "{\"tracks\":{\"shared\":5}}";
                                else if (path.contains("/stream/local/")) {
                                    assertEquals("opus", req.url().queryParameter("format"));
                                    assertEquals("96", req.url().queryParameter("max_bitrate"));
                                    String id = path.substring(path.lastIndexOf('/') + 1);
                                    assertTrue(fetched.add(id));
                                    mime = "audio/flac";
                                    body = "fLaCsample";
                                } else
                                    throw new AssertionError(path);
                            } catch (JSONException bad) {
                                throw new IOException(bad);
                            }
                            return new Response.Builder()
                                    .request(req)
                                    .protocol(Protocol.HTTP_1_1)
                                    .code(status)
                                    .message("fixture")
                                    .header("Content-Type", mime)
                                    .body(ResponseBody.create(MediaType.get(mime), body))
                                    .build();
                        })
                        .build();
        assertEquals(3,
                new PinnedDownloads(context, store, owner, fixture, () -> owner, () -> false).sync().getInt("saved"));
        assertEquals(2, store.snapshot().getJSONArray("pinnedPlaylists").length());
        JSONArray saved = store.snapshot().getJSONArray("items");
        for (int i = 0; i < saved.length(); i++) {
            assertEquals("audio/flac", saved.getJSONObject(i).getString("mime"));
            JSONObject track = saved.getJSONObject(i).getJSONObject("track");
            if ("shared".equals(track.getString("id")))
                assertEquals(5, track.getInt("rating"));
        }
        partial.set(true);
        edited.set(true);
        assertTrue(new PinnedDownloads(context, store, owner, fixture, () -> owner, () -> false).sync().has("message"));
        assertTrue(store.hasAudio("old"));
        partial.set(false);
        assertEquals(0,
                new PinnedDownloads(context, store, owner, fixture, () -> owner, () -> false).sync().getInt("saved"));
        assertFalse(store.hasAudio("old"));
        assertTrue(store.hasAudio("shared") && store.hasAudio("new"));
        assertThrows(IOException.class,
                () -> new PinnedDownloads(context, store, owner, fixture, () -> null, () -> false).sync());
    }
    @After
    public void clear() {
        File directory = new File(new File(context.getNoBackupFilesDir(), "dn-offline"), store.account);
        File[] files = directory.listFiles();
        if (files != null)
            for (File f : files) f.delete();
        directory.delete();
        context.deleteSharedPreferences("dn.offline." + store.account);
    }
}
