package app.droppedneedle.mobile;

import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import okhttp3.HttpUrl;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** A cursor belongs to one authenticated DN track listing, including DN's shuffle seed. */
final class LibraryWindow {
    static final String CHANGED = "The matching library changed. Start Play all again to use the updated list.";
    static final int PAGE = 100;
    static final int HISTORY = 50;
    static final int AHEAD = 25;
    static final int MAX_BYTES = 1024 * 1024;
    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("q", "sort", "order", "album_id", "artist_id",
            "genre", "formats", "format_mode", "rating", "rating_mode", "favorites"));
    private static final String[][] METADATA = {{"duration_seconds", "duration"}, {"album_id", "albumId"},
            {"artist_id", "artistId"}, {"album_artist_name", "albumArtist"}, {"album_artist_id", "albumArtistId"},
            {"artist_mbid", "artistMbid"}, {"recording_mbid", "recordingMbid"}, {"release_group_mbid", "releaseGroupMbid"},
            {"replaygain_track_gain", "replayGainTrackDb"}, {"replaygain_album_gain", "replayGainAlbumDb"},
            {"replaygain_track_peak", "replayGainTrackPeak"}, {"replaygain_album_peak", "replayGainAlbumPeak"},
            {"genre", "genre"}, {"year", "year"}, {"track_number", "trackNumber"}, {"disc_number", "discNumber"},
            {"date_added", "dateAdded"}, {"format", "format"}, {"favorite", "favorite"},
            {"sample_rate", "sourceSampleRate"}, {"bit_depth", "sourceBitDepth"}, {"bit_rate", "sourceBitrate"}};

    final JSONObject filters;
    final String after;
    final int loaded, total;

    private LibraryWindow(JSONObject filters, String after, int loaded, int total) {
        this.filters = filters;
        this.after = after;
        this.loaded = loaded;
        this.total = total;
    }

    private static JSONException changed() {
        return new JSONException(CHANGED);
    }

    private static int integer(JSONObject raw, String name) throws JSONException {
        Object value = raw.get(name);
        if (!(value instanceof Number))
            throw changed();
        Number number = (Number) value;
        if (number.doubleValue() != number.intValue() || number.intValue() < 0)
            throw changed();
        return number.intValue();
    }

    private static String cursor(JSONObject raw, String name) throws JSONException {
        if (raw.isNull(name))
            return null;
        Object value = raw.get(name);
        if (!(value instanceof String))
            throw changed();
        String text = (String) value;
        if (text.isEmpty() || text.length() > 8192)
            throw changed();
        return text;
    }

    static LibraryWindow parse(JSONObject data, int retained) throws JSONException {
        if (data == null)
            return null;
        JSONObject raw = data.getJSONObject("filters"), safe = new JSONObject();
        for (Iterator<String> keys = raw.keys(); keys.hasNext();) {
            String key = keys.next();
            Object value = raw.get(key);
            if (!KEYS.contains(key) || !(value instanceof String))
                throw changed();
            safe.put(key, value);
        }
        String after = cursor(data, "after");
        int loaded = integer(data, "loaded"), total = integer(data, "total");
        if (retained < 1 || retained > 300 || loaded < retained || loaded > total
                || (after == null) != (loaded == total))
            throw changed();
        return new LibraryWindow(safe, after, loaded, total);
    }

    JSONObject state() {
        JSObject result = new JSObject();
        result.put("filters", filters);
        result.put("after", after == null ? JSONObject.NULL : after);
        result.put("loaded", loaded);
        result.put("total", total);
        return result;
    }

    HttpUrl url(HttpUrl base, String prefix) {
        HttpUrl.Builder builder = base.newBuilder().encodedPath(prefix + "library/tracks").query(null).fragment(null);
        for (Iterator<String> keys = filters.keys(); keys.hasNext();) {
            String key = keys.next();
            builder.addQueryParameter(key, filters.optString(key));
        }
        builder.addQueryParameter("limit", Integer.toString(PAGE));
        if (after != null)
            builder.addQueryParameter("after", after);
        return builder.build();
    }

    static final class Batch {
        final LibraryWindow cursor;
        final JSONArray tracks;

        Batch(LibraryWindow cursor, JSONArray tracks) {
            this.cursor = cursor;
            this.tracks = tracks;
        }
    }

    Batch read(Response response, HttpUrl base, String prefix, Set<String> used) throws IOException, JSONException {
        ResponseBody body = response.body();
        if (!response.isSuccessful() || body == null)
            throw new IOException("Could not load more library tracks.");
        if (body.contentLength() > MAX_BYTES * 2 || body.source().request(MAX_BYTES * 2L + 1))
            throw changed();
        JSONObject page = new JSONObject(body.string());
        JSONArray rows = page.getJSONArray("items"), tracks = new JSONArray();
        if (integer(page, "total") != total || rows.length() > PAGE)
            throw changed();
        String next = cursor(page, "next");
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (!(row.get("id") instanceof String) || !(row.get("title") instanceof String))
                throw changed();
            String id = row.getString("id");
            if (id.isEmpty() || id.equals(".") || id.equals(".."))
                throw changed();
            if (used.add(id))
                tracks.put(track(base, prefix, row));
        }
        long count = (after == null ? 0L : loaded) + tracks.length();
        if (next == null ? count != total : next.equals(after) || tracks.length() == 0 || count >= total)
            throw changed();
        return new Batch(new LibraryWindow(filters, next, (int) count, total), tracks);
    }

    private static String text(JSONObject row, String key) {
        return row.isNull(key) ? "" : row.optString(key);
    }

    static JSONObject track(HttpUrl base, String prefix, JSONObject row) throws JSONException {
        String id = row.getString("id"), album = text(row, "album_id"), group = text(row, "release_group_mbid");
        JSONObject track = new JSONObject()
                                   .put("id", id)
                                   .put("title", row.getString("title"))
                                   .put("artist", text(row, "artist_name"))
                                   .put("album", text(row, "album_title"))
                                   .put("streamUrl",
                                           base.newBuilder()
                                                   .encodedPath(prefix + "stream/local/")
                                                   .addPathSegment(id)
                                                   .build()
                                                   .toString());
        if (!row.optBoolean("art_missing")
                && (!group.isEmpty() || row.optBoolean("cover_available") && !album.isEmpty())) {
            HttpUrl.Builder art =
                    base.newBuilder()
                            .encodedPath(prefix + (group.isEmpty() ? "library/albums/" : "covers/release-group/"))
                            .addPathSegment(group.isEmpty() ? album : group);
            if (group.isEmpty())
                art.addPathSegment("artwork");
            track.put("artworkUrl", art.addQueryParameter("size", "500").build().toString());
        }
        for (String[] name : METADATA)
            if (!row.isNull(name[0]))
                track.put(name[1], row.get(name[0]));
        if (!track.has("artistMbid") && !row.isNull("album_artist_mbid")) track.put("artistMbid", row.get("album_artist_mbid"));
        return track;
    }
}
