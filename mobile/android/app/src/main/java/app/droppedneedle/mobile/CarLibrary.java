package app.droppedneedle.mobile;

import android.content.Context;
import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.MediaType;
import okhttp3.RequestBody;
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
    interface Read {
        JSONObject get(HttpUrl url) throws IOException, JSONException;
        default JSONObject plan(HttpUrl url, JSONObject seed) throws IOException, JSONException { throw new IOException("DN radio is unavailable."); }
    }
    final HeadsetAccount owner;
    private final String scope, prefix, artworkScope, artworkAuthority;
    private final OfflineStore store;
    private final CarHomePins pins;
    private final CarSmartPlaylists smart;
    private final Context context;
    private final boolean local;
    private final Read read;

    CarLibrary(Context app, HeadsetAccount account) {
        this(app, account, new Read() {
            private JSONObject fetch(Request.Builder request) throws IOException, JSONException {
                if (!account.matches(HeadsetAccount.read(app))) throw new IOException("DN account changed.");
                if (OfflineStore.forUser(app, account.server.toString(), account.userId).offlineOnly())
                    throw new IOException("The DN library is offline.");
                try (Response response = HTTP.newCall(request.header("Authorization", "Bearer " + account.token).build()).execute()) {
                    if (!response.isSuccessful() || response.body() == null || response.body().source().request(MAX_BYTES + 1))
                        throw new IOException("Could not read the DN library.");
                    return new JSONObject(response.body().string());
                }
            }
            public JSONObject get(HttpUrl url) throws IOException, JSONException { return fetch(new Request.Builder().url(url)); }
            public JSONObject plan(HttpUrl url, JSONObject seed) throws IOException, JSONException {
                return fetch(new Request.Builder().url(url).post(RequestBody.create(seed.toString(), MediaType.get("application/json"))));
            }
        }, StreamProfiles.active(app) == StreamProfiles.Path.OFFLINE);
    }
    CarLibrary(Context app, HeadsetAccount account, Read read, boolean disconnected) {
        this.owner = account;
        this.context = app;
        artworkScope = CarArtworkProvider.scope(account);
        artworkAuthority = app.getPackageName() + ".car-art";
        scope = OfflineStore.digest(account.server + "\n" + account.userId);
        prefix = account.server.encodedPath().replaceAll("/+$", "") + "/api/v3/";
        store = OfflineStore.forUser(app, account.server.toString(), account.userId);
        pins = new CarHomePins(app, account);
        smart = new CarSmartPlaylists(app, account);
        local = store.offlineOnly() || disconnected;
        this.read = read;
    }
    static final class Entry {
        final String id, title, subtitle;
        final JSONObject track;
        final Uri art;
        Entry(String id, String title, String subtitle, JSONObject track) {
            this(id, title, subtitle, track, null);
        }
        Entry(String id, String title, String subtitle, JSONObject track, Uri art) {
            this.art = art;
            this.id = id; this.title = title; this.subtitle = subtitle; this.track = track;
        }
        MediaItem media() {
            boolean folder = track == null;
            return new MediaItem.Builder().setMediaId(id).setMediaMetadata(new MediaMetadata.Builder()
                    .setTitle(title).setArtworkUri(art).setSubtitle(subtitle).setArtist(folder ? null : subtitle)
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
    private Entry folderWithArt(String kind, String value, String name, String art) {
        return new Entry(shelf(kind, value, null).toString(), name, "", null,
                CarArtworkProvider.folderUri(artworkAuthority, artworkScope, owner.server, value, art));
    }
    private Entry song(Uri shelf, JSONObject track) throws JSONException {
        String id = track.getString("id");
        if (!OfflineStore.validTrackId(id)) throw new JSONException("Invalid library track.");
        // Download metadata can retain a server-relative stream URL across app updates.
        track.put("streamUrl", store.original(id).toString());
        return new Entry(shelf.buildUpon().appendQueryParameter("track", id).build().toString(),
                track.getString("title"), track.optString("artist"), track,
                CarArtworkProvider.uri(artworkAuthority, artworkScope, owner.server, track));
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
            List<Entry> root = new ArrayList<>();
            if (!local) root.addAll(Arrays.asList(folder("library", null, null, context.getString(R.string.car_library)), folder("playlists", null, null, context.getString(R.string.car_playlists)),
                    folder("favorites", null, null, context.getString(R.string.car_favorites))));
            if (local && smart.lists().length() > 0) root.add(folder("playlists", null, null, context.getString(R.string.car_playlists)));
            root.add(folder("device", null, null, context.getString(R.string.car_device)));
            if (pins.list().length() > 0) root.add(folder("pins", null, null, context.getString(R.string.car_home_pins)));
            return root;
        }
        Uri key = parse(raw);
        if (key.getQueryParameter("track") != null) return Collections.emptyList();
        String kind = key.getLastPathSegment(), value = key.getQueryParameter("value"), after = key.getQueryParameter("after");
        if ("pins".equals(kind) || "pin".equals(kind)) return pinnedChildren(kind, value, after, key);
        if ("library".equals(kind)) {
            List<Entry> shelves = new ArrayList<>(Arrays.asList(folder("albums", null, null, context.getString(R.string.car_albums)),
                    folder("artists", null, null, context.getString(R.string.car_artists)), folder("recent", null, null, context.getString(R.string.car_recent))));
            if (pins.list().length() > 0) shelves.add(folder("pins", null, null, context.getString(R.string.car_home_pins)));
            return shelves;
        }
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
            if (offset + PAGE < matches.size()) entries.add(folder(kind, value, String.valueOf(offset + PAGE), context.getString(R.string.car_more)));
            return entries;
        }
        if ("smartLists".equals(kind)) {
            JSONArray lists = smart.lists();
            int start = offset(after, lists.length());
            for (int i = start; i < Math.min(start + PAGE, lists.length()); i++) {
                JSONObject list = lists.getJSONObject(i);
                entries.add(folder("smart", list.getString("id"), null, list.getString("name")));
            }
            if (start + PAGE < lists.length()) entries.add(folder(kind, null, String.valueOf(start + PAGE), context.getString(R.string.car_more)));
            return entries;
        }
        if ("smart".equals(kind)) return smartTracks(key);
        if ("playlists".equals(kind) && after == null && smart.lists().length() != 0)
            entries.add(folder("smartLists", null, null, context.getString(R.string.car_smart_playlists)));
        if (local) return entries;
        HttpUrl.Builder base = owner.server.newBuilder().encodedPath(prefix);
        if ("playlists".equals(kind) || "playlist".equals(kind)) {
            HttpUrl.Builder request = base.addPathSegment("playlists");
            if ("playlist".equals(kind)) request.addPathSegment(valid(value));
            JSONObject data;
            try { data = read.get(request.build()); }
            catch (IOException unavailable) {
                if (!entries.isEmpty()) return entries; // Device playlists are available during a server outage.
                throw unavailable;
            }
            if (data.optBoolean("is_redacted")) return entries;
            JSONArray rows = data.getJSONArray("playlists".equals(kind) ? "playlists" : "tracks");
            int i = offset(after, rows.length());
            for (; i < rows.length() && entries.size() < PAGE; i++) {
                JSONObject row = rows.getJSONObject(i);
                if ("playlists".equals(kind)) {
                    if (!row.optBoolean("is_redacted") && !row.isNull("name")) {
                        JSONArray covers = row.optJSONArray("cover_urls");
                        String art = !row.isNull("custom_cover_url") ? row.getString("custom_cover_url")
                                : covers == null ? null : covers.optString(0);
                        entries.add(folderWithArt("playlist", row.getString("id"), row.getString("name"), art));
                    }
                } else {
                    String file = row.isNull("library_file_id") ? "" : row.getString("library_file_id");
                    if (file.isEmpty() && "local".equals(row.optString("source_type")) && !row.isNull("track_source_id"))
                        file = row.getString("track_source_id");
                    if (OfflineStore.validTrackId(file)) {
                        JSONObject track = new JSONObject().put("id", file).put("title", row.getString("track_name"))
                                .put("artist", row.optString("artist_name")).put("album", row.optString("album_name"))
                                .put("streamUrl", store.original(file).toString());
                        String art = CarArtworkProvider.relative(owner.server, row.optString("cover_url"));
                        if (art == null && !row.isNull("album_id") && OfflineStore.validTrackId(row.getString("album_id")))
                            art = "/api/v3/library/albums/" + Uri.encode(row.getString("album_id")) + "/artwork";
                        if (art != null) track.put("artworkUrl", owner.server.newBuilder()
                                .encodedPath(owner.server.encodedPath().replaceAll("/+$", "") + art).addQueryParameter("size","500").build().toString());
                        entries.add(song(key, track));
                    }
                }
            }
            if (i < rows.length()) entries.add(folder(kind, value, String.valueOf(i), context.getString(R.string.car_more)));
            return entries;
        }
        HttpUrl.Builder query = base.addPathSegment("library");
        switch (kind) {
            case "albums": case "artists": query.addPathSegment(kind).addQueryParameter("sort", "name"); break;
            case "album": case "artist": query.addPathSegment("tracks").addQueryParameter(kind + "_id", valid(value)).addQueryParameter("sort","album"); break;
            case "genre": query.addPathSegment("tracks").addQueryParameter("genre", valid(value)).addQueryParameter("sort","album"); break;
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
            else if ("albums".equals(kind)) {
                String id = row.getString("id");
                String art = row.optBoolean("art_missing") ? null : !row.isNull("release_group_mbid")
                        ? "/api/v3/covers/release-group/" + Uri.encode(row.getString("release_group_mbid"))
                        : "/api/v3/library/albums/" + Uri.encode(id) + "/artwork";
                entries.add(folderWithArt("album", id, row.getString("title"), art));
            }
            else entries.add(song(key, LibraryWindow.track(owner.server, prefix, row)));
        }
        if (!page.isNull("next") && !page.getString("next").equals(after))
            entries.add(folder(kind, value, page.getString("next"), context.getString(R.string.car_more)));
        return entries;
    }
    private List<Entry> smartTracks(Uri key) throws IOException, JSONException {
        String id = key.getQueryParameter("value");
        JSONObject list = smart.get(id);
        int total = list.optInt("total"), start = offset(key.getQueryParameter("after"), total);
        List<Entry> result = new ArrayList<>();
        java.util.Map<String, JSONObject> saved = local ? CarHomePins.saved(store.snapshot().getJSONArray("items")) : Collections.emptyMap();
        int end = start;
        while (end < total && result.size() < LibraryWindow.PAGE) {
            int pageStart = end / LibraryWindow.PAGE * LibraryWindow.PAGE;
            JSONArray page = smart.page(list, pageStart);
            for (int i = end - pageStart; i < page.length() && result.size() < LibraryWindow.PAGE; i++) {
                JSONObject track = page.getJSONObject(i);
                if (!local || saved.containsKey(track.getString("id"))) result.add(song(key, track));
                end++;
            }
        }
        if (end < total) result.add(folder("smart", id, String.valueOf(end), context.getString(R.string.car_more)));
        return result;
    }

    record SmartSelection(JSONArray tracks, int index, LibraryWindow window) {}

    SmartSelection smartSelection(String raw) throws IOException, JSONException, java.security.GeneralSecurityException {
        Uri key = parse(raw);
        if (!"smart".equals(key.getLastPathSegment())) return null;
        String picked = key.getQueryParameter("track");
        if (!OfflineStore.validTrackId(picked)) throw new IOException("Choose a playlist track.");
        JSONObject list = smart.get(key.getQueryParameter("value"));
        int total = list.getInt("total"), start = offset(key.getQueryParameter("after"), total);
        String snapshot = list.getString("snapshot");
        JSONArray page;
        if (!local) {
            page = smart.page(list, start);
        } else {
            java.util.Map<String, JSONObject> saved = CarHomePins.saved(store.snapshot().getJSONArray("items"));
            List<JSONObject> playable = new ArrayList<>();
            int selected = -1;
            for (int pos = 0; pos < total; pos += LibraryWindow.PAGE) {
                JSONArray rows = smart.page(list, pos);
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject track = rows.getJSONObject(i);
                    String id = track.getString("id");
                    if (!saved.containsKey(id)) continue;
                    if (picked.equals(id)) selected = playable.size();
                    playable.add(track);
                }
            }
            if (selected < 0) throw new IOException("Track is unavailable offline.");
            if (playable.size() != total && playable.size() > LibraryWindow.PAGE) {
                snapshot = java.util.UUID.randomUUID().toString();
                SmartQueueStore queues = new SmartQueueStore(context);
                for (int pos = 0; pos < playable.size(); pos += LibraryWindow.PAGE) {
                    JSONArray part = new JSONArray(playable.subList(pos, Math.min(pos + LibraryWindow.PAGE, playable.size())));
                    queues.write(owner.server.toString(), owner.token, owner.userId, snapshot, pos, playable.size(), part);
                }
            }
            total = playable.size();
            start = selected / LibraryWindow.PAGE * LibraryWindow.PAGE;
            page = new JSONArray(playable.subList(start, Math.min(total, start + LibraryWindow.PAGE)));
        }
        for (int i = 0; i < page.length(); i++) {
            if (picked.equals(page.getJSONObject(i).getString("id"))) {
                LibraryWindow window = total <= LibraryWindow.PAGE ? null : LibraryWindow.smart(snapshot, start + page.length(), total);
                return new SmartSelection(page, i, window);
            }
        }
        throw new IOException("This track has moved. Reopen the playlist.");
    }

    private List<Entry> pinnedChildren(String kind, String value, String after, Uri key) throws IOException, JSONException {
        List<Entry> entries = new ArrayList<>();
        java.util.Map<String, JSONObject> saved = local ? CarHomePins.saved(store.snapshot().getJSONArray("items")) : Collections.emptyMap();
        if ("pins".equals(kind)) {
            JSONArray rows = pins.list();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject pin = rows.getJSONObject(i);
                if (local && !"smart".equals(pin.optString("kind")) && pins.offline(pin, saved).isEmpty()) continue;
                if ("track".equals(pin.optString("kind"))) {
                    if (OfflineStore.validTrackId(pin.optString("id"))) entries.add(song(key, local ? saved.get(pin.getString("id")) :
                        new JSONObject().put("id", pin.getString("id")).put("title", pin.getString("title"))
                            .put("artist", pin.optString("artist")).put("album", pin.optString("album"))));
                } else entries.add(folder("pin", CarHomePins.handle(pin), null, pin.getString("title")));
            }
            return entries;
        }
        JSONObject pin = pins.find(value);
        List<JSONObject> tracks = new ArrayList<>();
        if ("smart".equals(pin.optString("kind"))) return children(shelf("smart", pin.getString("id"), after).toString());
        if (local) tracks = pins.offline(pin, saved);
        else {
            String type = pin.getString("kind"), id = pin.getString("id"), localId = pin.optString("localId");
            if ("playlist".equals(type) || "genre".equals(type))
                return children(shelf(type, id, after).toString());
            if (("artist".equals(type) || "album".equals(type)) && !localId.isEmpty())
                return children(shelf(type, localId, after).toString());
            HttpUrl.Builder api = owner.server.newBuilder().encodedPath(prefix);
            if ("album".equals(type)) {
                int start = after == null ? 0 : offset(after, Integer.MAX_VALUE);
                JSONObject page = read.get(api.addPathSegments("library/albums/match").addPathSegment(valid(id))
                    .addQueryParameter("limit", String.valueOf(PAGE)).addQueryParameter("offset", String.valueOf(start)).build());
                JSONArray rows = page.getJSONArray("items");
                for (int i=0; i<rows.length(); i++) entries.add(song(key, LibraryWindow.track(owner.server, prefix, rows.getJSONObject(i))));
                if (rows.length() > 0 && (long)start + rows.length() < page.optLong("total")) entries.add(folder("pin", value, String.valueOf(start + rows.length()), context.getString(R.string.car_more)));
                return entries;
            }
            if ("artist".equals(type)) {
                String cursor = null;
                HashSet<String> visited = new HashSet<>();
                long start = System.nanoTime();
                do {
                    if (Thread.currentThread().isInterrupted() || visited.size() >= 24 ||
                        System.nanoTime() - start >= TimeUnit.SECONDS.toNanos(15))
                        throw new IOException("The pinned artist lookup did not finish.");
                    HttpUrl.Builder find = owner.server.newBuilder().encodedPath(prefix).addPathSegments("library/artists")
                        .addQueryParameter("q", pin.getString("title")).addQueryParameter("limit", String.valueOf(PAGE));
                    if (cursor != null) find.addQueryParameter("after", cursor);
                    JSONObject page = read.get(find.build());
                    JSONArray rows = page.getJSONArray("items");
                    for (int i = 0; i < rows.length(); i++) {
                        JSONObject artist = rows.getJSONObject(i);
                        if (id.equalsIgnoreCase(artist.optString("artist_mbid"))) return children(shelf("artist", artist.getString("id"), after).toString());
                    }
                    String next = page.isNull("next") ? null : page.getString("next");
                    if (next == null) break;
                    if (!visited.add(valid(next))) throw new IOException("DN repeated an artist lookup page.");
                    cursor = next;
                } while (true);
                return entries;
            }
            JSONObject seed = pin.optJSONObject("plan");
            if (seed == null) return entries;
            JSONArray songs = pins.lastPlan(pin);
            if (songs.length() == 0) {
                JSONObject plan = new JSONObject(seed.toString()).put("mode", "library").put("count", 25);
                songs = pins.savePlan(pin, read.plan(api.addPathSegments("discover/radio/plan").build(), plan).getJSONArray("tracks"));
            }
            for (int i = 0; i < songs.length(); i++) tracks.add(songs.getJSONObject(i));
        }
        int start = offset(after, tracks.size());
        for (int i=start; i<Math.min(start+PAGE, tracks.size()); i++) entries.add(song(key, tracks.get(i)));
        if (start+PAGE < tracks.size()) entries.add(folder("pin", value, String.valueOf(start+PAGE), context.getString(R.string.car_more)));
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
            if (!Arrays.asList("library","playlists","playlist","device","recent","album","artist","albums","artists","favorites","search","pins","pin","genre","smartLists","smart").contains(kind))
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
