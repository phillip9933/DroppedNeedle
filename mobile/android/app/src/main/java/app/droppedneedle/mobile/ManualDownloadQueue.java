package app.droppedneedle.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Each row remains pending until its complete original has been committed to OfflineStore. */
final class ManualDownloadQueue extends SQLiteOpenHelper {
    static final int PENDING = 0, SAVED = 1, FAILED = 2, LOCAL = 3;
    ManualDownloadQueue(Context context) { this(context, "dn-manual-downloads.db"); }
    ManualDownloadQueue(Context context, String name) { super(context, name, null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE songs(owner TEXT NOT NULL, session TEXT NOT NULL, id TEXT NOT NULL,"
                + " track TEXT NOT NULL, state INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,"
                + " error TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL DEFAULT 0, UNIQUE(owner,id))");
        db.execSQL("CREATE INDEX pending_songs ON songs(owner,state)");
        db.execSQL("CREATE INDEX recent_failures ON songs(owner,state,updated)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported manual download database version.");
    }

    record Item(String id, String session, JSONObject track, int tries) {}
    record Counts(int pending, int saved, int failed, String error) {}

    Set<String> admit(OfflineStore store, String session, JSONArray input) throws Exception {
        if (input == null || input.length() == 0) throw new IllegalArgumentException("Choose a song to save.");
        SQLiteDatabase db = getWritableDatabase();
        Set<String> added = new HashSet<>(), seen = new HashSet<>();
        db.delete("songs", "owner!=? OR session!=?", new String[]{store.account, session});
        Counts counts = counts(store.account);
        if (counts.pending == 0 && counts.failed == 0) clear(store.account);
        for (int i = 0; i < input.length(); i++) {
            JSONObject track = store.retained(input.getJSONObject(i));
            String id = track.getString("id");
            if (!seen.add(id)) continue;
            ContentValues row = new ContentValues();
            row.put("owner", store.account);
            row.put("session", session);
            row.put("id", id);
            row.put("track", track.toString());
            boolean inserted = db.insertWithOnConflict("songs", null, row, SQLiteDatabase.CONFLICT_IGNORE) != -1;
            if (inserted) added.add(id);
            if (store.hasAudio(id)) finish(store.account, id, LOCAL, "");
            else if (!inserted && state(store.account, id) == SAVED) {
                finish(store.account, id, PENDING, "");
                added.add(id);
            }
        }
        return added;
    }

    String session(String owner) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT session FROM songs WHERE owner=? LIMIT 1", new String[]{owner})) {
            return row.moveToFirst() ? row.getString(0) : null;
        }
    }
    Counts counts(String owner) {
        int[] totals = new int[4];
        String error = "";
        try (Cursor rows = getReadableDatabase().rawQuery(
                "SELECT state,COUNT(*) FROM songs WHERE owner=? GROUP BY state", new String[]{owner})) {
            while (rows.moveToNext()) {
                int state = rows.getInt(0);
                totals[state] = rows.getInt(1);
            }
        }
        if (totals[FAILED] > 0) {
            try (Cursor latest = getReadableDatabase().rawQuery(
                    "SELECT error FROM songs WHERE owner=? AND state=2 ORDER BY updated DESC,rowid DESC LIMIT 1", new String[]{owner})) {
                if (latest.moveToFirst()) error = latest.getString(0);
            }
        }
        return new Counts(totals[PENDING] + totals[LOCAL], totals[SAVED], totals[FAILED], error);
    }

    private static String preview(String text) {
        if (text.length() <= 256) return text;
        int end = Character.isHighSurrogate(text.charAt(254)) ? 254 : 255;
        return text.substring(0, end) + "…";
    }
    static JSONObject summary(JSONObject track) throws JSONException {
        return new JSONObject().put("id", track.getString("id")).put("title", preview(track.getString("title")))
                .put("artist", preview(track.optString("artist", "")));
    }
    JSONArray failures(String owner) throws JSONException {
        JSONArray list = new JSONArray();
        try (Cursor rows = getReadableDatabase().rawQuery(
                "SELECT track,error FROM songs WHERE owner=? AND state=2 ORDER BY updated DESC,rowid DESC LIMIT 5",
                new String[]{owner})) {
            while (rows.moveToNext()) list.put(summary(new JSONObject(rows.getString(0))).put("reason", rows.getString(1)));
        }
        return list;
    }

    Item next(String owner) throws JSONException { return next(owner, PENDING); }
    Item next(String owner, int state) throws JSONException {
        try (Cursor row = getReadableDatabase().rawQuery(
                "SELECT id,session,track,tries FROM songs WHERE owner=? AND state=? ORDER BY rowid LIMIT 1",
                new String[]{owner, String.valueOf(state)})) {
            return row.moveToFirst() ? new Item(row.getString(0), row.getString(1),
                    new JSONObject(row.getString(2)), row.getInt(3)) : null;
        }
    }
    JSONArray unrated(String owner) throws JSONException {
        JSONArray ids = new JSONArray();
        try (Cursor rows = getReadableDatabase().rawQuery(
                "SELECT id,track FROM songs WHERE owner=? AND state=0 ORDER BY rowid LIMIT 100", new String[]{owner})) {
            while (rows.moveToNext()) if (!new JSONObject(rows.getString(1)).has("rating")) ids.put(rows.getString(0));
        }
        return ids;
    }
    void ratings(String owner, JSONArray ids, JSONObject ratings) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                try (Cursor row = db.rawQuery("SELECT track FROM songs WHERE owner=? AND id=? AND state=0", new String[]{owner,id})) {
                    if (row.moveToFirst()) {
                        JSONObject track = new JSONObject(row.getString(0)).put("rating", ratings.optInt(id, 0));
                        db.execSQL("UPDATE songs SET track=? WHERE owner=? AND id=?", new Object[]{track.toString(),owner,id});
                    }
                }
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    int state(String owner, String id) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT state FROM songs WHERE owner=? AND id=?",
                new String[]{owner, id})) { return row.moveToFirst() ? row.getInt(0) : -1; }
    }
    void finish(String owner, String id, int state, String error) {
        ContentValues values = new ContentValues();
        values.put("state", state);
        values.put("error", error);
        values.put("updated", System.currentTimeMillis());
        getWritableDatabase().update("songs", values, "owner=? AND id=?", new String[]{owner, id});
    }
    void attempt(String owner, String id) {
        getWritableDatabase().execSQL("UPDATE songs SET tries=tries+1 WHERE owner=? AND id=?", new Object[]{owner,id});
    }
    void failPending(String owner, String reason) {
        getWritableDatabase().execSQL("UPDATE songs SET state=2,error=?,updated=? WHERE owner=? AND state=0",
                new Object[]{reason,System.currentTimeMillis(),owner});
    }
    void retry(String owner) {
        getWritableDatabase().execSQL("UPDATE songs SET state=0,tries=0,error='' WHERE owner=? AND state=2", new Object[]{owner});
    }
    void clear(String owner) { getWritableDatabase().delete("songs", "owner=?", new String[]{owner}); }
    void remove(String owner, JSONArray ids) throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < ids.length(); i++)
                db.delete("songs", "owner=? AND id=?", new String[]{owner, ids.getString(i)});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
}
