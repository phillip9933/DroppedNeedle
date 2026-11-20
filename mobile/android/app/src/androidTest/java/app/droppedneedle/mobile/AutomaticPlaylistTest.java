package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AutomaticPlaylistTest {
    private static final String BASE = "https://playlist.example/dn";
    private static final byte[] AUDIO = {'R', 'I', 'F', 'F'};
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final OfflineStore store = OfflineStore.forUser(context, BASE, UUID.randomUUID().toString());
    private final OfflineStore other = OfflineStore.forUser(context, BASE, UUID.randomUUID().toString());
    private final String first = source("週末 / side B"), second = source("Rainy day");

    private static String source(String playlist) {
        return "playlist:" + Base64.encodeToString(playlist.getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
    private JSONObject configure(OfflineStore owner, String source) throws Exception {
        return owner.configure(owner.options().put("autoDownload", source).put("autoCache", true)
                .put("downloadMiB", 128).put("unmeteredOnly", false));
    }
    private JSONObject track(String id) throws Exception {
        return new JSONObject().put("id", id).put("title", id).put("streamUrl", BASE + "/api/v3/stream/local/" + id);
    }
    private void save(OfflineStore owner, String id, String origin, String source) throws Exception {
        try (OfflineStore.Capture capture = owner.begin(track(id), origin, source, AUDIO.length)) {
            assertNotNull(capture);
            capture.write(AUDIO, 0, AUDIO.length);
            capture.finish();
        }
    }
    private List<String> plan(String source, JSONArray ids, boolean keepExisting) throws Exception {
        JSONArray result = store.planAutomatic(source, ids, keepExisting).getJSONArray("ids");
        List<String> list = new ArrayList<>();
        for (int i = 0; i < result.length(); i++) list.add(result.getString(i));
        return list;
    }
    @After public void clean() {
        for (OfflineStore owner : Arrays.asList(store, other)) {
            File folder = new File(new File(context.getNoBackupFilesDir(), "dn-offline"), owner.account);
            File[] files = folder.listFiles();
            if (files != null) for (File file : files) file.delete();
            folder.delete();
            context.deleteSharedPreferences("dn.offline." + owner.account);
        }
    }

    @Test public void fullMembershipIsOrderedAndAnAmbiguousOrInvalidSnapshotCannotPrune() throws Exception {
        configure(store, first);
        configure(other, first);
        save(other, "orphan", OfflineStore.AUTOMATIC, first);
        save(store, "pinned", OfflineStore.DOWNLOAD, null);
        save(store, "cached", OfflineStore.CACHE, null);
        save(store, "song-39", OfflineStore.AUTOMATIC, first);
        save(store, "orphan", OfflineStore.AUTOMATIC, first);
        store.remove(new JSONArray().put("song-7"));
        List<String> tracks = new ArrayList<>();
        for (int i = 0; i < 40; i++) tracks.add("song-" + i);
        JSONArray membership = new JSONArray().put("pinned").put("cached").put("cached");
        for (String id : tracks) membership.put(id);
        membership.put("song-30");
        List<String> expected = new ArrayList<>(tracks);
        expected.remove("song-7");
        expected.remove("song-39");
        expected.add(0, "cached");
        assertEquals(expected, plan(first, membership, true));
        assertTrue(store.hasAudio("orphan"));
        assertThrows(IllegalArgumentException.class, () -> plan(first, new JSONArray(membership.toString()).put(3), false));
        assertThrows(IllegalArgumentException.class, () -> plan(first, new JSONArray(membership.toString()).put("../broken"), false));
        assertThrows(IllegalArgumentException.class, () -> plan(first, null, false));
        assertTrue(store.hasAudio("orphan"));
        assertEquals(expected, plan(first, membership, false));
        assertFalse(store.hasAudio("orphan"));
        assertTrue(other.hasAudio("orphan"));
        assertTrue(store.hasAudio("pinned"));
        assertTrue(store.hasAudio("song-39"));
        File original = store.playable(store.original("cached").toString());
        assertTrue(store.keepExisting("cached", first, track("cached")));
        assertEquals(original, store.playable(store.original("cached").toString()));
        assertFalse(plan(first, membership, false).contains("cached"));
        for (String classic : Arrays.asList("recent", "favorites")) {
            configure(store, classic);
            List<String> first25 = new ArrayList<>(tracks.subList(0,25));
            first25.remove("song-7");
            assertEquals(first25, plan(classic, new JSONArray(tracks), false));
        }
    }

    @Test public void onlyTheExactSelectedPlaylistCanPublishOrClearAnAutomaticCopy() throws Exception {
        configure(store, first);
        String edge = new String(new char[256]).replace('\0', 'x');
        assertTrue(OfflineStore.enabledSource(source(edge)));
        for (String invalid : Arrays.asList("playlist:", "playlist:YQ==", "playlist:Yh", "playlist:_w",
                "playlist:AA", source(".."), source("."), source("a\u007f"), source("a\u0080"), source(edge + "x"))) {
            assertThrows(IllegalArgumentException.class, () -> configure(store, invalid));
            assertThrows(IllegalArgumentException.class, () -> plan(invalid, new JSONArray(), false));
            assertEquals(first, store.options().getString("autoDownload"));
        }
        save(store, "saved", OfflineStore.DOWNLOAD, null);
        save(store, "cache", OfflineStore.CACHE, null);
        save(store, "auto", OfflineStore.AUTOMATIC, first);
        store.remove(new JSONArray().put("excluded"));
        assertThrows(IOException.class, () -> store.begin(track("oversized"), OfflineStore.AUTOMATIC, first, 129L * 1024 * 1024));
        try (OfflineStore.Capture pending = store.begin(track("pending"), OfflineStore.AUTOMATIC, first, AUDIO.length)) {
            assertNotNull(pending);
            pending.write(AUDIO, 0, AUDIO.length);
            configure(store, second);
            assertTrue(plan(first, new JSONArray(), false).isEmpty());
            assertThrows(IllegalArgumentException.class, () -> store.clearAutomaticPlaylist(first));
            assertNull(store.begin(track("late"), OfflineStore.AUTOMATIC, first, AUDIO.length));
            assertTrue(store.hasAudio("auto"));
            configure(store, first);
            assertThrows(IOException.class, pending::finish);
        }
        configure(store, "off");
        assertTrue(store.hasAudio("auto"));
        assertFalse(store.hasAudio("pending"));
        configure(other, second);
        save(other, "auto", OfflineStore.AUTOMATIC, second);
        JSONObject next = configure(store, second).put("offlineOnly", true);
        store.configure(next);
        assertEquals("off", store.clearAutomaticPlaylist(second).getString("autoDownload"));
        assertFalse(store.hasAudio("auto"));
        assertTrue(store.hasAudio("saved") && store.hasAudio("cache") && other.hasAudio("auto"));
        store.configure(next.put("offlineOnly", false));
        assertTrue(plan(second, new JSONArray().put("excluded"), false).isEmpty());
    }
}
