package app.droppedneedle.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;
import org.json.JSONObject;

/** Completed occurrences waiting for their first unambiguous submission. Never contains a login. */
final class OfflinePlayStore extends SQLiteOpenHelper {
    static final long MAX_AGE = 14 * 24 * 60 * 60;
    private static final long FUTURE_SKEW = 60;

    OfflinePlayStore(Context context, File path) {
        super(context.getApplicationContext(), path.getAbsolutePath(), null, 1);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE plays (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, "
                + "started INTEGER NOT NULL, body TEXT NOT NULL)");
        db.execSQL("CREATE INDEX account_play ON plays(account, id)");
        db.execSQL("CREATE INDEX play_time ON plays(started)");
        db.execSQL("CREATE TABLE discard (account TEXT PRIMARY KEY, revision INTEGER NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unknown offline listening history version");
    }
    void prune(long now) {
        getWritableDatabase().delete("plays", "started < ? OR started > ?",
                new String[]{Long.toString(now - MAX_AGE), Long.toString(now + FUTURE_SKEW)});
    }
    static final class Play {
        final long id, started, revision;
        final String account, body;
        Play(long id, String account, long started, String body, long revision) {
            this.id = id;
            this.account = account;
            this.started = started;
            this.body = body;
            this.revision = revision;
        }
    }
    void add(String account, JSONObject body, long now) {
        long started = body.optLong("timestamp");
        if (started < now - MAX_AGE || started > now + FUTURE_SKEW) return;
        put(new Play(0, account, started, body.toString(), 0));
    }
    void put(Play play) {
        ContentValues values = new ContentValues();
        if (play.id > 0) values.put("id", play.id);
        values.put("account", play.account);
        values.put("started", play.started);
        values.put("body", play.body);
        getWritableDatabase().insertOrThrow("plays", null, values);
    }
    long last(String account) {
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT MAX(id) FROM plays WHERE account=?",
                new String[]{account})) {
            return rows.moveToFirst() ? rows.getLong(0) : 0;
        }
    }
    long count(String account) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM plays WHERE account=?", new String[]{account})) {
            row.moveToFirst();
            return row.getLong(0);
        }
    }
    private long revision(String account) {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT revision FROM discard WHERE account=?", new String[]{account})) {
            return row.moveToFirst() ? row.getLong(0) : 0;
        }
    }
    boolean discarded(Play play) { return revision(play.account) != play.revision; }
    void retry(Play play) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (!discarded(play)) put(play);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    void discard(String account) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("plays", "account=?", new String[]{account});
            db.execSQL("INSERT OR REPLACE INTO discard(account,revision) VALUES(?,?)",
                    new Object[]{account, revision(account) + 1});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    // Remove before sending. If the process dies in flight, nobody can tell whether DN recorded it.
    Play claim(String account, long through, long now) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            Play next = null;
            try (Cursor rows = db.rawQuery("SELECT id,started,body FROM plays WHERE account=? AND id<=? "
                    + "AND started BETWEEN ? AND ? ORDER BY id LIMIT 1", new String[]{account, Long.toString(through),
                            Long.toString(now - MAX_AGE), Long.toString(now + FUTURE_SKEW)})) {
                if (rows.moveToFirst()) next = new Play(rows.getLong(0), account, rows.getLong(1), rows.getString(2), revision(account));
            }
            if (next != null) db.delete("plays", "id=?", new String[]{Long.toString(next.id)});
            db.setTransactionSuccessful();
            return next;
        } finally { db.endTransaction(); }
    }
}
