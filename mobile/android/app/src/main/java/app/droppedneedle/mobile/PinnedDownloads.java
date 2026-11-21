package app.droppedneedle.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import okhttp3.Call;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Foreground and scheduled updates share the same verified membership and atomic file publication. */
final class PinnedDownloads {
    private static final Set<String> ACTIVE = new HashSet<>();
    private final Context context;
    private final OfflineStore store;
    private final HeadsetAccount owner;
    private final Call.Factory http;
    private final Supplier<HeadsetAccount> login;
    private final BooleanSupplier stopped;
    private final long generation;
    private volatile Call current;

    PinnedDownloads(Context context, OfflineStore store, HeadsetAccount owner, Call.Factory http,
            Supplier<HeadsetAccount> login, BooleanSupplier stopped) {
        this.context = context;
        this.store = store;
        this.owner = owner;
        this.http = http;
        this.login = login;
        this.stopped = stopped;
        generation = store.autoGeneration();
    }
    void cancel() {
        Call call = current;
        if (call != null)
            call.cancel();
    }
    private void check() throws IOException {
        if (stopped.getAsBoolean() || store.autoGeneration() != generation || store.offlineOnly()
                || !store.permittedNetwork() || !owner.matches(login.get()))
            throw new IOException("Automatic downloads paused.");
    }
    private boolean permitted() {
        return !stopped.getAsBoolean() && generation == store.autoGeneration() && !store.offlineOnly()
                && store.permittedNetwork() && owner.matches(login.get());
    }
    private void companions(JSONObject track, boolean refresh) {
        OfflineCompanions.prepare(store, owner, track, this::request, this::permitted, refresh);
    }

    JSONObject refreshMetadata() throws IOException, JSONException {
        return refreshMetadata(java.util.Collections.emptySet());
    }
    JSONObject refreshMetadata(Set<String> observed) throws IOException, JSONException {
        check();
        JSONArray saved = store.snapshot().getJSONArray("items");
        java.util.Map<String,Long> revisions = new java.util.HashMap<>();
        java.util.Map<String,Set<String>> albums = new java.util.HashMap<>();
        for (int i=0;i<saved.length();i++) {
            JSONObject item = saved.getJSONObject(i), track = item.getJSONObject("track");
            String id = track.getString("id");
            revisions.put(id,store.itemRevision(id));
            String album = track.optString("albumId","");
            if (!album.isEmpty()) albums.computeIfAbsent(album,key -> new HashSet<>()).add(id);
        }
        int[] updated = {0};
        JSONObject confirmed = new JSONObject();
        Set<String> remaining = new HashSet<>(revisions.keySet());
        java.util.List<JSONObject> batch = new java.util.ArrayList<>();
        PinnedCatalog catalog = new PinnedCatalog(owner.server,this::read, track -> {
            batch.add(track);
            remaining.remove(track.getString("id"));
            if (batch.size() == 100) updated[0] += refreshBatch(batch,revisions,observed,confirmed);
        });
        // Small collections usually resolve in a handful of album pages. For larger libraries
        // one paginated pass avoids an individual request for every retained album.
        if (albums.size() <= 8) for (var album : albums.entrySet()) {
            catalog.refreshTracks(new JSONObject().put("album_id",album.getKey()),album.getValue());
        }
        if (!remaining.isEmpty()) catalog.refreshTracks(new JSONObject(),new HashSet<>(remaining));
        updated[0] += refreshBatch(batch,revisions,observed,confirmed);
        return new JSONObject().put("updated",updated[0]).put("unavailable",remaining.size()).put("confirmed",confirmed);
    }
    private int refreshBatch(java.util.List<JSONObject> batch, java.util.Map<String,Long> revisions, Set<String> observed, JSONObject confirmed) throws IOException, JSONException {
        if (batch.isEmpty()) return 0;
        JSONArray ids = new JSONArray();
        for (JSONObject track : batch) ids.put(track.getString("id"));
        JSONObject scores = ratings(ids);
        int updated = 0;
        for (JSONObject track : batch) {
            check();
            String id = track.getString("id");
            if (scores != null) track.put("rating",scores.optInt(id,0));
            if (store.updateMetadata(track,revisions.get(id))) {
                updated++;
                if (observed.contains(id)) {
                    JSONObject facts = new JSONObject();
                    if (scores != null) facts.put("rating",track.getInt("rating"));
                    if (track.opt("favorite") instanceof Boolean value) facts.put("favorite",value);
                    if (facts.length() > 0) confirmed.put(id,facts);
                }
                companions(track,true);
            }
        }
        batch.clear();
        return updated;
    }
    private Response request(Request request) throws IOException {
        check();
        current = http.newCall(request);
        if (stopped.getAsBoolean())
            current.cancel();
        return current.execute();
    }
    private JSONObject read(okhttp3.HttpUrl url, boolean post) throws IOException, JSONException {
        Request.Builder request = new Request.Builder().url(url).header("Authorization", "Bearer " + owner.token);
        if (post)
            request.post(RequestBody.create(null, new byte[0]));
        try (Response response = request(request.build())) {
            ResponseBody body = response.body();
            long max = 32L * 1024 * 1024;
            if (!response.isSuccessful() || body == null || body.contentLength() > max
                    || body.source().request(max + 1))
                throw new IOException("Could not read this collection from DN (HTTP " + response.code() + ").");
            return new JSONObject(body.string());
        }
    }

    private JSONObject ratings(JSONArray ids) throws IOException {
        try {
            okhttp3.HttpUrl url =
                    owner.server.newBuilder()
                            .encodedPath(owner.server.encodedPath().replaceAll("/+$", "") + "/api/v3/ratings/lookup")
                            .build();
            RequestBody data = RequestBody.create(
                    okhttp3.MediaType.get("application/json"), new JSONObject().put("track_ids", ids).toString());
            Request query =
                    new Request.Builder().url(url).header("Authorization", "Bearer " + owner.token).post(data).build();
            try (Response response = request(query)) {
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null || body.source().request(128 * 1024 + 1))
                    return null;
                return new JSONObject(body.string()).optJSONObject("tracks");
            }
        } catch (IOException | JSONException optional) {
            check();
            return null;
        }
    }

    JSONObject sync() throws IOException, JSONException {
        JSONObject report = new JSONObject().put("saved", 0);
        synchronized (ACTIVE) {
            if (!ACTIVE.add(store.account))
                return report.put("message", "An offline collection update is already running.");
        }
        // Persistent files live in OfflineStore. This temporary index bounds metadata memory while collecting large
        // libraries.
        File index = new File(context.getCacheDir(), "dn-offline-members-" + store.account + ".sqlite");
        try {
            check();
            JSONArray pins = store.effectivePins();
            if (pins.length() == 0)
                return report;
            try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(index, null)) {
                db.execSQL("CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, track TEXT NOT NULL)");
                db.delete("tracks", null, null);
                int unavailable = 0;
                for (int i = 0; i < pins.length(); i++) {
                    check();
                    JSONObject pin = pins.getJSONObject(i);
                    JSONArray membership = "playlist".equals(pin.getString("kind")) ? new JSONArray() : null;
                    PinnedCatalog catalog = new PinnedCatalog(owner.server, this::read, row -> {
                        String id = row.getString("id");
                        ContentValues values = new ContentValues();
                        values.put("id", id);
                        values.put("track", row.toString());
                        db.insertWithOnConflict("tracks", null, values, SQLiteDatabase.CONFLICT_IGNORE);
                        if (membership != null)
                            membership.put(id);
                    });
                    db.beginTransaction();
                    try {
                        try {
                            catalog.resolve(pin);
                            check();
                            if (membership != null)
                                store.playlistMembers(generation, pin.getString("id"),
                                        catalog.playlistName.isEmpty() ? pin.getString("name") : catalog.playlistName,
                                        membership);
                        } catch (JSONException | IOException partial) {
                            check();
                            unavailable++;
                        }
                        db.setTransactionSuccessful();
                    } finally {
                        db.endTransaction();
                    }
                }
                check();
                if (unavailable == 0)
                    store.prunePinned(generation, id -> {
                        try (Cursor cursor = db.rawQuery("SELECT 1 FROM tracks WHERE id=?", new String[] {id})) {
                            return cursor.moveToFirst();
                        }
                    });
                int saved = 0, missing = 0;
                boolean full = false;
                JSONObject ratings = new JSONObject();
                int ratedThrough = -1;
                StreamProfiles.Quality quality = store.downloadQuality();
                try (Cursor rows = db.rawQuery("SELECT track FROM tracks ORDER BY rowid", null)) {
                    while (rows.moveToNext()) {
                        check();
                        JSONObject track = new JSONObject(rows.getString(0));
                        String id = track.getString("id");
                        long revision = store.itemRevision(id);
                        if (rows.getPosition() > ratedThrough) {
                            int position = rows.getPosition();
                            JSONArray ids = new JSONArray();
                            do {
                                ids.put(new JSONObject(rows.getString(0)).getString("id"));
                                ratedThrough = rows.getPosition();
                            } while (ids.length() < 100 && rows.moveToNext());
                            rows.moveToPosition(position);
                            ratings = ratings(ids);
                        }
                        if (ratings != null)
                            track.put("rating", ratings.optInt(id, 0));
                        if (!store.needsAutomaticCopy(id) || store.keepExisting(id, OfflinePins.SOURCE, track)) {
                            store.updateMetadata(track, revision);
                            continue;
                        }
                        try (Response audio = DownloadRepresentation.open(
                                     store.original(id), owner.token, quality.format, quality.rate, this::request)) {
                            String mime = DownloadRepresentation.mime(audio);
                            if (audio.code() == 404 || audio.code() == 410) {
                                missing++;
                                continue;
                            }
                            if (mime == null)
                                throw new IOException(
                                        "DN could not serve this audio file (HTTP " + audio.code() + ").");
                            ResponseBody body = audio.body();
                            try (OfflineStore.Capture output = store.begin(
                                         track, OfflineStore.AUTOMATIC, OfflinePins.SOURCE, body.contentLength());
                                    InputStream input = body.byteStream()) {
                                if (output == null || revision != store.itemRevision(id))
                                    continue;
                                byte[] block = new byte[65536];
                                for (int count; (count = input.read(block)) != -1;) {
                                    if (stopped.getAsBoolean())
                                        throw new IOException("Automatic downloads paused.");
                                    output.write(block, 0, count);
                                }
                                check();
                                output.finish(mime);
                                saved++;
                            }
                        }
                    }
                } catch (OfflineStore.DownloadLimit limit) {
                    full = true;
                }
                if (unavailable > 0 || missing > 0 || full) {
                    String issue = unavailable > 0 ? "DN could not confirm " + unavailable
                                    + " collection(s). Existing automatic copies were kept."
                                                   : "";
                    if (missing > 0)
                        issue += (issue.isEmpty() ? "" : " ") + missing + " song(s) are unavailable on DN.";
                    if (full)
                        issue += (issue.isEmpty() ? "" : " ") + "The automatic download limit has been reached.";
                    report.put("message", issue);
                }
                return report.put("saved", saved);
            }
        } finally {
            try {
                SQLiteDatabase.deleteDatabase(index);
            } finally {
                current = null;
                synchronized (ACTIVE) {
                    ACTIVE.remove(store.account);
                }
            }
        }
    }
}
