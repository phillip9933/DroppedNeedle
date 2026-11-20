package app.droppedneedle.mobile;

import android.content.Context;
import android.util.Log;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import org.json.JSONException;
import org.json.JSONObject;

/** One playback service drains completed offline listens when its authenticated library reconnects. */
final class OfflinePlayHistory {
    static final class Session {
        final String scope, token;
        final HttpUrl submit;
        final BooleanSupplier online;
        final OfflineStore offline;
        Session(HttpUrl playback, String token, OfflineStore offline, BooleanSupplier connected) {
            submit = playback.newBuilder().removePathSegment(playback.pathSize() - 1)
                    .addPathSegment("scrobble").addPathSegment("submit").build();
            this.offline = offline;
            scope = offline == null ? null : offline.account;
            this.token = token;
            online = () -> connected.getAsBoolean() && (offline == null || !offline.offlineOnly());
        }
    }

    // Service instances may briefly overlap. Keep completed writes independent of the HTTP worker.
    private static final ExecutorService writes = Executors.newSingleThreadExecutor();
    private static OfflinePlayStore database;
    private static synchronized OfflinePlayStore store(Context context) {
        if (database == null)
            database = new OfflinePlayStore(context, new File(context.getNoBackupFilesDir(), "offline-history.sqlite"));
        return database;
    }
    private final OfflinePlayStore store;
    private final OkHttpClient http;
    private final LongSupplier clock;
    private final ExecutorService sender = Executors.newSingleThreadExecutor();
    private volatile Session session;
    private boolean sending, again, closed;

    OfflinePlayHistory(Context context) {
        this(store(context), new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false).callTimeout(5, TimeUnit.SECONDS).build(),
                () -> System.currentTimeMillis() / 1000);
    }
    OfflinePlayHistory(OfflinePlayStore store, OkHttpClient http, LongSupplier clock) {
        this.store = store;
        this.http = http;
        this.clock = clock;
        writes.execute(() -> {
            try { store.prune(clock.getAsLong()); }
            catch (RuntimeException failed) { logStorage(); }
        });
    }
    void authorize(Session next) {
        session = next;
        if (next != null) wake();
    }
    void record(Session owner, JSONObject body, long revision) {
        if (owner == null || owner.scope == null) return;
        String scope = owner.scope;
        writes.execute(() -> {
            try {
                long now = clock.getAsLong();
                store.prune(now);
                if ((revision & 1) != 0 || owner.offline.historyRevision() != revision) return;
                store.add(scope, body, now);
                countChanged();
                Session active = session;
                if (active != null && scope.equals(active.scope)) wake();
            } catch (RuntimeException failed) { logStorage(); }
        });
    }
    private static void logStorage() { Log.w("DNPlayback", "Offline listening history storage was unavailable."); }
    private boolean permitted(Session current) {
        return current != null && current.scope != null && current == session && current.online.getAsBoolean()
                && current.offline.recordsHistory();
    }

    // Wakes come from login, a real change of connection or offline mode, and finishing an offline
    // occurrence. No timer or playback heartbeat retries a DN that cannot accept a submission.
    synchronized void wake() {
        if (closed || !permitted(session)) return;
        again = true;
        if (sending) return;
        sending = true;
        sender.execute(() -> {
            while (true) {
                Session current;
                synchronized (this) {
                    if (closed || !again) { sending = false; return; }
                    again = false;
                    current = session;
                }
                try { drain(current); }
                catch (RuntimeException failed) { logStorage(); }
            }
        });
    }
    private void drain(Session current) {
        if (!permitted(current)) return;
        long through = store.last(current.scope);
        while (through > 0 && permitted(current)) {
            OfflinePlayStore.Play play = store.claim(current.scope, through, clock.getAsLong());
            if (play == null) return;
            countChanged();
            if (OfflineScrobble.retryRequired(http, current.submit, current.token, play.body,
                    () -> permitted(current) && !store.discarded(play))) {
                long now = clock.getAsLong();
                if (play.started >= now - OfflinePlayStore.MAX_AGE) store.retry(play);
                countChanged();
                return;
            }
        }
    }
    static volatile Runnable changed;
    private static void countChanged() {
        Runnable listener = changed;
        if (listener != null) listener.run();
    }
    static JSONObject settings(Context context, OfflineStore owner) throws JSONException {
        OfflinePlayStore db = store(context);
        db.prune(System.currentTimeMillis() / 1000);
        return new JSONObject().put("enabled", owner.recordsHistory()).put("pending", db.count(owner.account));
    }
    static void discard(Context context, OfflineStore owner) throws Exception {
        // Serialize with locally finished plays that were already waiting for a disk write.
        writes.submit(() -> { store(context).discard(owner.account); countChanged(); }).get();
    }
    synchronized void close() {
        closed = true;
        session = null;
        sender.shutdown();
    }
}
