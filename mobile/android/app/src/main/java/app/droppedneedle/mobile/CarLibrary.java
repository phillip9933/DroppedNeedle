package app.droppedneedle.mobile;

import android.content.Context;
import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Account-scoped Media3 IDs describe a DN shelf, optional opaque cursor, and optional track on that shelf. */
final class CarLibrary {
    static final String ROOT = "dn-car-root";
    static final int PAGE = 60;
    private static final long MAX_BYTES = 4L * 1024 * 1024;
    private static final OkHttpClient HTTP = new OkHttpClient.Builder().followRedirects(false)
            .followSslRedirects(false).callTimeout(9, TimeUnit.SECONDS).build();
    interface Read { JSONObject get(HttpUrl url) throws IOException, JSONException; }
    final HeadsetAccount owner;
    private final String scope, prefix;
    private final OfflineStore store;
    private final boolean local;
    private final Read read;

    CarLibrary(Context app, HeadsetAccount account) {
        this(app, account, url -> {
            if (!account.matches(HeadsetAccount.read(app))) throw new IOException("DN account changed.");
            if (OfflineStore.forUser(app, account.server.toString(), account.userId).offlineOnly())
                throw new IOException("The DN library is offline.");
            Request request = new Request.Builder().url(url).header("Authorization", "Bearer " + account.token).build();
            try (Response response = HTTP.newCall(request).execute()) {
                if (!response.isSuccessful() || response.body() == null || response.body().source().request(MAX_BYTES + 1))
                    throw new IOException("Could not read the DN library.");
                return new JSONObject(response.body().string());
            }
        }, StreamProfiles.active(app) == StreamProfiles.Path.OFFLINE);
    }
    CarLibrary(Context app, HeadsetAccount account, Read read, boolean disconnected) {
        this.owner = account;
        scope = OfflineStore.digest(account.server + "\n" + account.userId);
        prefix = account.server.encodedPath().replaceAll("/+$", "") + "/api/v3/";
        store = OfflineStore.forUser(app, account.server.toString(), account.userId);
        local = store.offlineOnly() || disconnected;
        this.read = read;
    }
    static final class Entry {
        final String id, title, subtitle;
        final JSONObject track;
        Entry(String id, String title, String subtitle, JSONObject track) {
            this.id = id; this.title = title; this.subtitle = subtitle; this.track = track;
        }
        MediaItem media() {
            boolean folder = track == null;
            return new MediaItem.Builder().setMediaId(id).setMediaMetadata(new MediaMetadata.Builder()
                    .setTitle(title).setSubtitle(subtitle).setArtist(folder ? null : subtitle)
                    .setIsBrowsable(folder).setIsPlayable(!folder)
                    .setMediaType(folder ? MediaMetadata.MEDIA_TYPE_FOLDER_MIXED : MediaMetadata.MEDIA_TYPE_MUSIC).build()).build();
        }
    }
    static Entry root() { return new Entry(ROOT, "DroppedNeedle", "", null); }
    private Uri shelf(String kind, String value, String cursor) {
        Uri.Builder key = new Uri.Builder().scheme("dncar").authority(scope).appendPath(kind);
        if (value != null) key.appendQueryParameter("value", value);
        if (cursor != null) key.appendQueryParameter("after", cursor);
        return key.build();
    }
    private Entry folder(String kind, String value, String cursor, String name) {
        return new Entry(shelf(kind, value, cursor).toString(), name, "", null);
    }
    private Entry song(Uri shelf, JSONObject track) throws JSONException {
        String id = track.getString("id");
        if (!OfflineStore.validTrackId(id)) throw new JSONException("Invalid library track.");
        // Download metadata can retain a server-relative stream URL across app updates.
        track.put("streamUrl", store.original(id).toString());
        return new Entry(shelf.buildUpon().appendQueryParameter("track", id).build().toString(),
                track.getString("title"), track.optString("artist"), track);
    }
    private Uri parse(String raw) throws IOException {
        if (raw.length() > 8192) throw new IOException("Invalid media ID.");
        Uri key = Uri.parse(raw);
        if (!"dncar".equals(key.getScheme()) || !scope.equals(key.getAuthority()) || key.getPathSegments().size() != 1)
            throw new IOException("This item belongs to another library.");
        return key;
    }
    static <T> List<T> slice(List<T> rows, int page, int size) {
        if (page < 0 || size < 1) return Collections.emptyList();
        long from = (long)page * size;
        return from >= rows.size() ? Collections.emptyList() : rows.subList((int)from, (int)Math.min(rows.size(), from + size));
    }
    List<Entry> children(String raw) throws IOException, JSONException {
        if (ROOT.equals(raw)) {
            if (local) return Collections.singletonList(folder("device", null, null, "On this device"));
            return Arrays.asList(folder("library", null, null, "Library"), folder("playlists", null, null, "Playlists"),
                    folder("favorites", null, null, "Favorite songs"), folder("device", null, null, "On this device"));
        }
        Uri key = parse(raw);
        if (key.getQueryParameter("track") != null) return Collections.emptyList();
        String kind = key.getLastPathSegment(), value = key.getQueryParameter("value"), after = key.getQueryParameter("after");
        if ("library".equals(kind)) return Arrays.asList(folder("albums", null, null, "Albums"), folder("artists", null, null, "Artists"),
                folder("recent", null, null, "Recently added"));
        List<Entry> entries = new ArrayList<>();
        if ("device".equals(kind) || local && "search".equals(kind)) {
            JSONArray saved = store.snapshot().getJSONArray("items");
            String query = value == null ? "" : value.toLowerCase(Locale.ROOT);
            List<JSONObject> matches = new ArrayList<>();
            for (int i = 0; i < saved.length(); i++) {
                JSONObject t = saved.getJSONObject(i).getJSONObject("track");
                String text = t.optString("title") + " " + t.optString("artist") + " " + t.optString("album");
                if (text.toLowerCase(Locale.ROOT).contains(query)) matches.add(t);
            }
            int offset = offset(after, matches.size());
            for (int i = offset; i < Math.min(offset + PAGE, matches.size()); i++) entries.add(song(key, matches.get(i)));
            if (offset + PAGE < matches.size()) entries.add(folder(kind, value, String.valueOf(offset + PAGE), "More"));
            return entries;
        }
        if (local) return entries;
        HttpUrl.Builder base = owner.server.newBuilder().encodedPath(prefix);
        if ("playlists".equals(kind) || "playlist".equals(kind)) {
            HttpUrl.Builder request = base.addPathSegment("playlists");
            if ("playlist".equals(kind)) request.addPathSegment(valid(value));
            JSONObject data = read.get(request.build());
            if (data.optBoolean("is_redacted")) return entries;
            JSONArray rows = data.getJSONArray("playlists".equals(kind) ? "playlists" : "tracks");
            int i = offset(after, rows.length());
            for (; i < rows.length() && entries.size() < PAGE; i++) {
                JSONObject row = rows.getJSONObject(i);
                if ("playlists".equals(kind)) {
                    if (!row.optBoolean("is_redacted") && !row.isNull("name"))
                        entries.add(folder("playlist", row.getString("id"), null, row.getString("name")));
                } else {
                    String file = row.isNull("library_file_id") ? "" : row.getString("library_file_id");
                    if (file.isEmpty() && "local".equals(row.optString("source_type")) && !row.isNull("track_source_id"))
                        file = row.getString("track_source_id");
                    if (OfflineStore.validTrackId(file)) {
                        JSONObject track = new JSONObject().put("id", file).put("title", row.getString("track_name"))
                                .put("artist", row.optString("artist_name")).put("album", row.optString("album_name"))
                                .put("streamUrl", store.original(file).toString());
                        entries.add(song(key, track));
                    }
                }
            }
            if (i < rows.length()) entries.add(folder(kind, value, String.valueOf(i), "More"));
            return entries;
        }
        HttpUrl.Builder query = base.addPathSegment("library");
        switch (kind) {
            case "albums": case "artists": query.addPathSegment(kind).addQueryParameter("sort", "name"); break;
            case "album": case "artist": query.addPathSegment("tracks").addQueryParameter(kind + "_id", valid(value)).addQueryParameter("sort","album"); break;
            case "favorites": query.addPathSegment("tracks").addQueryParameter("favorites", "true"); break;
            case "recent": query.addPathSegment("tracks").addQueryParameter("sort", "date_added").addQueryParameter("order", "desc"); break;
            case "search": query.addPathSegment("tracks").addQueryParameter("q", valid(value)); break;
            default: throw new IOException("Unknown library shelf.");
        }
        query.addQueryParameter("limit", String.valueOf(PAGE));
        if (after != null) query.addQueryParameter("after", after);
        JSONObject page = read.get(query.build());
        JSONArray rows = page.getJSONArray("items");
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if ("artists".equals(kind)) entries.add(folder("artist", row.getString("id"), null, row.getString("name")));
            else if ("albums".equals(kind)) entries.add(folder("album", row.getString("id"), null, row.getString("title")));
            else entries.add(song(key, LibraryWindow.track(owner.server, prefix, row)));
        }
        if (!page.isNull("next") && !page.getString("next").equals(after))
            entries.add(folder(kind, value, page.getString("next"), "More"));
        return entries;
    }
    List<Entry> search(String query) throws IOException, JSONException {
        String q = query.trim();
        if (q.isEmpty()) return children(folder(local ? "device" : "recent", null, null, "").id);
        return children(shelf("search", valid(q), null).toString());
    }
    Entry item(String raw) throws IOException, JSONException {
        if (ROOT.equals(raw)) return root();
        Uri key = parse(raw);
        String track = key.getQueryParameter("track");
        if (track == null) {
            String kind = key.getLastPathSegment();
            if (!Arrays.asList("library","playlists","playlist","device","recent","album","artist","albums","artists","favorites","search").contains(kind))
                throw new IOException("Unknown shelf.");
            return new Entry(raw, kind, "", null);
        }
        Uri parent = shelf(key.getLastPathSegment(), key.getQueryParameter("value"), key.getQueryParameter("after"));
        for (Entry entry : children(parent.toString())) if (raw.equals(entry.id)) return entry;
        throw new IOException("This song is no longer in this shelf.");
    }
    private static String valid(String text) throws IOException {
        if (text == null || text.trim().isEmpty() || text.length() > 512) throw new IOException("Invalid library selection.");
        return text;
    }
    private static int offset(String cursor, int size) throws IOException {
        if (cursor == null) return 0;
        try { int n = Integer.parseInt(cursor); if (n >= 0 && n <= size) return n; }
        catch (NumberFormatException ignored) { }
        throw new IOException("Invalid library page.");
    }
    List<Entry> siblings(String raw) throws IOException, JSONException {
        Uri key = parse(raw);
        if (key.getQueryParameter("track") == null) throw new IOException("Choose a library track.");
        return children(shelf(key.getLastPathSegment(), key.getQueryParameter("value"), key.getQueryParameter("after")).toString());
    }
}
