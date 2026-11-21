package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class PinnedCatalogTest {
    private final HttpUrl base = HttpUrl.get("https://dn.example/subpath");
    private JSONObject page(String after, JSONObject... items) throws org.json.JSONException {
        return new JSONObject()
                .put("total", items.length)
                .put("next", after == null ? JSONObject.NULL : after)
                .put("items", new JSONArray(Arrays.asList(items)));
    }
    private JSONObject track(String id) throws org.json.JSONException {
        return new JSONObject().put("id", id).put("title", id);
    }
    private JSONObject pin(String kind, String id) throws org.json.JSONException {
        return new JSONObject().put("kind", kind).put("id", id).put("name", id);
    }

    @Test
    public void entityFiltersUseEntityRatingsAndThenQueryTracksInEveryMatchedEntity() throws Exception {
        List<String> ids = new ArrayList<>(), paths = new ArrayList<>();
        PinnedCatalog catalog = new PinnedCatalog(base, (url, post) -> {
            assertFalse(post);
            String path = url.encodedPath();
            paths.add(path);
            if (path.endsWith("albums")) {
                assertEquals("5", url.queryParameter("rating"));
                if (url.queryParameter("after") == null)
                    return page("part 2", track("a")).put("total", 2);
                assertEquals("part 2", url.queryParameter("after"));
                return page(null, track("b")).put("total", 2);
            }
            assertNull(url.queryParameter("rating"));
            String album = url.queryParameter("album_id");
            assertNotNull(album);
            return page(null, track(album + "-song"));
        }, row -> ids.add(row.getString("id")));
        catalog.resolve(pin("filter", "library-filter-1")
                        .put("group", "albums")
                        .put("filters", new JSONObject().put("rating", "5")));
        assertEquals(Arrays.asList("a-song", "b-song"), ids);
        for (String path : paths) assertTrue(path.startsWith("/subpath/api/v3/library/"));
    }
    @Test
    public void malformedPagesAndUnresolvedPlaylistsCannotPrunePriorFiles() throws Exception {
        PinnedCatalog broken = new PinnedCatalog(base, (u, p) -> page(null, track("x")).put("total", 2), r -> {});
        assertThrows(IOException.class, () -> broken.resolve(pin("artist", "a")));
        JSONObject row = new JSONObject()
                                 .put("id", "row")
                                 .put("source_type", "local")
                                 .put("track_name", "Song")
                                 .put("artist_name", "Artist")
                                 .put("album_name", "Album");
        JSONObject playlist = new JSONObject()
                                      .put("id", "weekend")
                                      .put("is_owner", false)
                                      .put("is_redacted", false)
                                      .put("track_count", 1)
                                      .put("tracks", new JSONArray().put(row));
        PinnedCatalog incomplete = new PinnedCatalog(base, (u, p) -> playlist, r -> fail());
        assertThrows(IOException.class, () -> incomplete.resolve(pin("playlist", "weekend")));
        playlist.put("is_redacted", true).put("tracks", new JSONArray()).put("track_count", 0);
        assertThrows(IOException.class, () -> incomplete.resolve(pin("playlist", "weekend")));
    }
    @Test
    public void duplicatePinsAreNormalizedAndLegacyRecentAndFavoritesRemainActive() throws Exception {
        JSONObject artist = pin("artist", "same");
        JSONArray extra = new JSONArray().put(artist).put(artist).put(pin("playlist", "same"));
        for (String old : new String[] {"recent", "favorites"}) {
            JSONArray effective = OfflinePins.effective(old, extra);
            assertEquals(3, effective.length());
            assertEquals(old, effective.getJSONObject(0).getString("kind"));
        }
    }
}
