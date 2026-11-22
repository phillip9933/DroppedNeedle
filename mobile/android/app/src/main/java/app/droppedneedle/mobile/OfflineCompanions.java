package app.droppedneedle.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Base64;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Private per-account sidecars. Covers are shared across songs and leave with the last reference. */
final class OfflineCompanions extends SQLiteOpenHelper {
    private static final Map<String, OfflineCompanions> databases = new HashMap<>();
    static synchronized OfflineCompanions open(Context context, File directory) {
        File path = new File(directory, "companions.db");
        return databases.computeIfAbsent(path.toString(), key -> new OfflineCompanions(context, key));
    }
    private OfflineCompanions(Context context, String path) {
        super(context.getApplicationContext(), path, null, 1);
    }
    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE tracks (id TEXT PRIMARY KEY, cover TEXT, lyrics TEXT, peaks TEXT)");
        db.execSQL("CREATE INDEX by_cover ON tracks(cover)");
        db.execSQL("CREATE TABLE covers (path TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)");
        for (String event : new String[] {"DELETE", "UPDATE OF cover"}) {
            String trigger = event.startsWith("DELETE") ? "removed" : "moved";
            db.execSQL("CREATE TRIGGER " + trigger + " AFTER " + event
                    + (" ON tracks BEGIN DELETE FROM covers WHERE path=OLD.cover AND NOT EXISTS (SELECT 1 FROM "
                            + "tracks WHERE cover=OLD.cover); END"));
        }
    }
    @Override
    public void onUpgrade(SQLiteDatabase db, int before, int after) {
        throw new IllegalStateException();
    }
    void forget(String id) {
        getWritableDatabase().delete("tracks", "id=?", new String[] {id});
    }
    String field(String id, String key) {
        if (!"lyrics".equals(key) && !"peaks".equals(key))
            throw new IllegalArgumentException();
        try (Cursor row = getReadableDatabase().query(
                     "tracks", new String[] {key}, "id=?", new String[] {id}, null, null, null)) {
            return row.moveToFirst() && !row.isNull(0) ? row.getString(0) : null;
        }
    }
    boolean hasCover(String path) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT 1 FROM covers WHERE path=?", new String[] {path})) {
            return row.moveToFirst();
        }
    }
    byte[] coverBytes(String path) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT data FROM covers WHERE path=?", new String[] {path})) {
            return row.moveToFirst() ? row.getBlob(0) : null;
        }
    }

    String cover(String path) {
        if (path == null)
            return null;
        try (Cursor row = getReadableDatabase().rawQuery(
                     "SELECT mime,data FROM covers WHERE path=?", new String[] {path})) {
            return row.moveToFirst()
                    ? "data:" + row.getString(0) + ";base64," + Base64.encodeToString(row.getBlob(1), Base64.NO_WRAP)
                    : null;
        }
    }
    record Image(String mime, byte[] data) {}
    void put(String id, String path, Image image, String lyrics, String peaks) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.execSQL("INSERT OR IGNORE INTO tracks(id) VALUES (?)", new Object[] {id});
            if (image != null)
                db.execSQL("INSERT OR IGNORE INTO covers(path,mime,data) VALUES (?,?,?)",
                        new Object[] {path, image.mime(), image.data()});
            ContentValues values = new ContentValues();
            if (path != null && hasCover(path))
                values.put("cover", path);
            if (lyrics != null)
                values.put("lyrics", lyrics);
            if (peaks != null)
                values.put("peaks", peaks);
            if (values.size() > 0)
                db.update("tracks", values, "id=?", new String[] {id});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }
    // Never use a catalog-supplied URL as a general authenticated GET destination.
    static String coverPath(String raw) {
        if (raw == null || !raw.startsWith("/api/v3/"))
            return null;
        HttpUrl url = HttpUrl.parse("https://offline.invalid" + raw);
        if (url == null)
            return null;
        List<String> p = url.pathSegments();
        if (p.size() < 2 || !p.get(0).equals("api") || !p.get(1).equals("v3"))
            return null;
        if (p.size() == 5 && p.get(2).equals("covers") && p.get(3).equals("release-group")
                        && OfflineStore.validTrackId(p.get(4))
                || p.size() == 6 && p.get(2).equals("library") && p.get(3).equals("albums")
                        && OfflineStore.validTrackId(p.get(4)) && p.get(5).equals("artwork"))
            return url.encodedPath();
        return null;
    }
    private static byte[] limited(Response response, int limit) throws IOException {
        ResponseBody body = response.body();
        if (response.code() != 200 || body == null || body.contentLength() > limit
                || body.source().request(limit + 1L))
            return null;
        return body.bytes();
    }
    private static Request request(HttpUrl url, String token) {
        return new Request.Builder().url(url).header("Authorization", "Bearer " + token).build();
    }
    private static boolean temporary(int code) {
        return code == 408 || code == 429 || code >= 500;
    }
    static boolean prepare(OfflineStore store, HeadsetAccount owner, JSONObject track,
            DownloadRepresentation.Fetch http, BooleanSupplier current, boolean refreshLyrics) {
        if (!store.completeDownloads() || !current.getAsBoolean())
            return false;
        boolean retry = false;
        try {
            JSONObject copy = store.retained(track);
            String id = copy.getString("id"), key = OfflineStore.digest(id);
            long revision = store.itemRevision(id);
            if (!store.retainsCompanions(id))
                return true;
            OfflineCompanions db = store.companions();
            String path = coverPath(copy.optString("artworkUrl"));
            String lyrics = null, peaks = null;
            Image image = null;
            if (path != null && !db.hasCover(path)) {
                HttpUrl address = owner.server.newBuilder()
                                          .encodedPath(owner.server.encodedPath().replaceAll("/+$", "") + path)
                                          .addQueryParameter("size", "500")
                                          .build();
                try (Response response = http.execute(request(address, owner.token))) {
                    retry = temporary(response.code());
                    String mime = response.header("Content-Type", "")
                                          .split(";", 2)[0]
                                          .trim()
                                          .toLowerCase(java.util.Locale.ROOT);
                    if (mime.equals("image/jpeg") || mime.equals("image/png") || mime.equals("image/webp")
                            || mime.equals("image/avif")) {
                        byte[] bytes = limited(response, 768 * 1024);
                        if (bytes != null && bytes.length > 0) {
                            android.graphics.BitmapFactory.Options size = bounds();
                            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, size);
                            if (size.outHeight > 0 && size.outWidth > 0 && size.outHeight <= 4096
                                    && size.outWidth <= 4096)
                                image = new Image(mime, bytes);
                        }
                    }
                } catch (IOException unavailable) {
                    retry = true;
                }
            }
            if (!current.getAsBoolean())
                return false;
            if (refreshLyrics || db.field(key, "lyrics") == null) {
                HttpUrl address = owner.server.newBuilder()
                                          .addPathSegments("api/v3/library/tracks")
                                          .addPathSegment(id)
                                          .addPathSegment("lyrics")
                                          .build();
                try (Response response = http.execute(request(address, owner.token))) {
                    retry |= temporary(response.code());
                    if (response.code() == 404)
                        lyrics = "null";
                    else {
                        byte[] bytes = limited(response, 128 * 1024);
                        if (bytes != null) {
                            JSONObject value =
                                    new JSONObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
                            if (value.opt("lines") instanceof JSONArray && value.opt("is_synced") instanceof Boolean)
                                lyrics = value.toString();
                        }
                    }
                } catch (IOException unavailable) {
                    retry = true;
                } catch (JSONException malformed) {
                }
            }
            if (!current.getAsBoolean())
                return false;
            if (store.downloadWaveforms() && db.field(key, "peaks") == null) {
                File saved = store.artworkSource(store.original(id).toString());
                if (saved != null)
                    try {
                        JSONArray values = new JSONArray();
                        for (float value : TrackWaveform.decode(
                                     saved, copy.optDouble("duration", 0), new TrackWaveform.Job("download", 10_000)))
                            values.put((double) value);
                        if (values.length() == TrackWaveform.BINS)
                            peaks = values.toString();
                    } catch (IOException | RuntimeException ignored) {
                    }
            }
            if (!current.getAsBoolean())
                return false;
            store.putCompanions(id, revision, path, image, lyrics, peaks);
            return !retry;
        } catch (JSONException | RuntimeException ignored) {
            // Companion data is optional. An unavailable lyric or decoder cannot undo a saved song.
            return false;
        }
    }
    private static android.graphics.BitmapFactory.Options bounds() {
        android.graphics.BitmapFactory.Options result = new android.graphics.BitmapFactory.Options();
        result.inJustDecodeBounds = true;
        return result;
    }
}
