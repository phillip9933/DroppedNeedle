package app.droppedneedle.mobile;

import java.io.IOException;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Resolves a pinned collection against DN. Only a complete, consistent enumeration permits pruning. */
final class PinnedCatalog {
    interface Read {
        JSONObject json(HttpUrl url, boolean post) throws IOException, JSONException;
    }
    interface Sink {
        void row(JSONObject row) throws IOException, JSONException;
    }
    private final HttpUrl base;
    private final String prefix;
    private final Read api;
    private final Sink save;
    String playlistName;
    PinnedCatalog(HttpUrl base, Read api, Sink save) {
        this.base = base;
        this.prefix = base.encodedPath().replaceAll("/+$", "") + "/api/v3/";
        this.api = api;
        this.save = save;
    }
    private HttpUrl.Builder at(String path) {
        return base.newBuilder().encodedPath(prefix + path).query(null);
    }
    private static IOException incomplete() {
        return new IOException("DN returned an incomplete collection.");
    }
    private static String required(JSONObject row, String key) throws JSONException, IOException {
        Object value = row.get(key);
        if (!(value instanceof String))
            throw incomplete();
        return (String) value;
    }
    private static int count(JSONObject row, String key) throws JSONException, IOException {
        Object value = row.get(key);
        if (!(value instanceof Number n) || n.doubleValue() != n.intValue() || n.intValue() < 0)
            throw incomplete();
        return n.intValue();
    }
    private static String id(JSONObject row) throws JSONException, IOException {
        String id = required(row, "id");
        if (!OfflineStore.validTrackId(id))
            throw incomplete();
        return id;
    }
    private void track(JSONObject row) throws IOException, JSONException {
        id(row);
        required(row, "title");
        save.row(LibraryWindow.track(base, prefix, row));
    }
    void resolve(JSONObject pin) throws IOException, JSONException {
        String kind = pin.getString("kind");
        switch (kind) {
            case "recent":
            case "favorites":
                JSONObject latest = new JSONObject().put("sort", "date_added").put("order", "desc");
                if ("favorites".equals(kind))
                    latest.put("favorites", "true");
                pages("tracks", latest, 25, this::track);
                break;
            case "playlist":
                playlist(pin.getString("id"));
                break;
            case "artist":
                entity("artist_id", pin.getString("id"));
                break;
            case "filter":
                String group = pin.getString("group");
                if (group.equals("songs"))
                    pages("tracks", pin.getJSONObject("filters"), 0, this::track);
                else
                    pages(group, pin.getJSONObject("filters"), 0,
                            row -> entity(group.equals("artists") ? "artist_id" : "album_id", id(row)));
                break;
            default:
                throw incomplete();
        }
    }
    private void entity(String field, String id) throws IOException, JSONException {
        pages("tracks", new JSONObject().put(field, id).put("sort", "album").put("order", "asc"), 0, this::track);
    }
    private void pages(String group, JSONObject filters, int top, Sink sink) throws IOException, JSONException {
        HttpUrl.Builder address =
                at("library/" + group).addQueryParameter("limit", Integer.toString(top == 0 ? 100 : top));
        for (Iterator<String> keys = filters.keys(); keys.hasNext();) {
            String key = keys.next();
            address.addQueryParameter(key, filters.getString(key));
        }
        int total = -1, seen = 0;
        Set<String> ids = new HashSet<>(), cursors = new HashSet<>();
        String after = null;
        do {
            address.removeAllQueryParameters("after");
            if (after != null)
                address.addQueryParameter("after", after);
            JSONObject page = api.json(address.build(), false);
            int size = count(page, "total");
            if (total != -1 && total != size)
                throw incomplete();
            total = size;
            JSONArray items = page.getJSONArray("items");
            if (items.length() > (top == 0 ? 100 : top))
                throw incomplete();
            for (int i = 0; i < items.length(); i++) {
                JSONObject row = items.getJSONObject(i);
                if (!ids.add(id(row)))
                    throw incomplete();
                sink.row(row);
            }
            seen += items.length();
            if (seen > total)
                throw incomplete();
            after = page.isNull("next") ? null : required(page, "next");
            if (after != null && (after.isEmpty() || items.length() == 0 || seen >= total || !cursors.add(after)))
                throw incomplete();
            if (after == null && seen != total)
                throw incomplete();
            if (top > 0 && seen == top)
                return;
        } while (after != null);
    }
    private static boolean local(JSONArray choices) throws IOException, JSONException {
        boolean match = false;
        if (choices != null)
            for (int i = 0; i < choices.length(); i++) {
                if (!(choices.get(i) instanceof String))
                    throw incomplete();
                if ("local".equals(choices.getString(i)))
                    match = true;
            }
        return match;
    }
    private static JSONArray entries(JSONObject detail, String id) throws IOException, JSONException {
        if (!id.equals(required(detail, "id")) || !Boolean.FALSE.equals(detail.get("is_redacted"))
                || !(detail.get("is_owner") instanceof Boolean))
            throw incomplete();
        JSONArray rows = detail.getJSONArray("tracks");
        if (count(detail, "track_count") != rows.length())
            throw incomplete();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String rowId = required(row, "id");
            if (rowId.isEmpty() || !ids.add(rowId))
                throw incomplete();
            for (String key : new String[] {"source_type", "artist_name", "album_name", "track_name"})
                required(row, key);
            if (!row.isNull("available_sources"))
                local(row.getJSONArray("available_sources"));
        }
        return rows;
    }
    private static String value(JSONObject row, String key) throws JSONException, IOException {
        return row.isNull(key) ? "" : required(row, key);
    }
    private void playlist(String id) throws JSONException, IOException {
        HttpUrl url = at("playlists").addPathSegment(id).build();
        JSONObject detail = api.json(url, false);
        JSONArray rows = entries(detail, id);
        playlistName = value(detail, "name");
        Set<String> unresolved = new HashSet<>(), linked = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (value(row, "source_type").isEmpty() && value(row, "library_file_id").isEmpty()
                    && !value(row, "album_id").isEmpty())
                unresolved.add(row.getString("id"));
        }
        if (detail.getBoolean("is_owner") && !unresolved.isEmpty()) {
            JSONObject result =
                    api.json(url.newBuilder().addPathSegment("resolve-sources").build(), true).getJSONObject("sources");
            for (int i = 0; i < rows.length(); i++) {
                String rowId = rows.getJSONObject(i).getString("id");
                if (local(result.getJSONArray(rowId)) && unresolved.contains(rowId))
                    linked.add(rowId);
            }
            if (!linked.isEmpty()) {
                detail = api.json(url, false);
                rows = entries(detail, id);
                playlistName = value(detail, "name");
            }
        }
        boolean incomplete = false;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String source = required(row, "source_type"), file = value(row, "library_file_id");
            boolean claims = "local".equals(source) || local(row.optJSONArray("available_sources"));
            if ("local".equals(source) && file.isEmpty())
                file = value(row, "track_source_id");
            if (!claims || file.isEmpty()) {
                if (claims || (!detail.getBoolean("is_owner") && source.isEmpty()))
                    incomplete = true;
                continue;
            }
            if (!OfflineStore.validTrackId(file))
                throw incomplete();
            linked.remove(row.getString("id"));
            JSONObject track = new JSONObject()
                                       .put("id", file)
                                       .put("title", row.getString("track_name"))
                                       .put("artist", row.getString("artist_name"))
                                       .put("album", row.getString("album_name"))
                                       .put("streamUrl", at("stream/local/").addPathSegment(file).build().toString());
            for (String[] field : new String[][] {{"artist_id", "artistId"}, {"album_id", "albumId"},
                         {"format", "format"}, {"track_number", "trackNumber"}, {"disc_number", "discNumber"},
                         {"duration", "duration"}, {"cover_url", "artworkUrl"}})
                if (!row.isNull(field[0]))
                    track.put(field[1], row.get(field[0]));
            save.row(track);
        }
        if (incomplete || !linked.isEmpty())
            throw incomplete();
    }
}
