package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import android.util.Log;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Iterator;
import okhttp3.HttpUrl;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.function.BiConsumer;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONException;
import org.json.JSONObject;

/** The queue is readable only with the same DN server and device session that saved it. */
final class SavedQueue {
    private static final int IV_LENGTH = 12;
    private static final String PLAYLIST_FILE = "playback-queue.v1";
    // Service instances can overlap during teardown. File mutations must stay ordered across them.
    private static final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicFile playlist;
    private final AtomicFile cursor;
    static boolean exists(Context context) {
        File dir = context.getNoBackupFilesDir();
        return new File(dir, PLAYLIST_FILE).isFile() || new File(dir, PLAYLIST_FILE + ".bak").isFile();
    }

    SavedQueue(Context context) {
        File dir = context.getNoBackupFilesDir();
        playlist = new AtomicFile(new File(dir, PLAYLIST_FILE));
        cursor = new AtomicFile(new File(dir, "playback-cursor.v1"));
    }

    static final class ShuffleHistory implements FreshShuffle.History {
        static final int LIMIT = 128;
        private static final String RECENT = "_recent";
        private final SharedPreferences prefs;
        ShuffleHistory(SharedPreferences prefs) {
            this.prefs = prefs;
        }

        @Override
        public Object lock() {
            return prefs;
        }
        @Override
        public String previous(String group) {
            return prefs.getString(group, null);
        }

        @Override
        public void remember(String group, String order) {
            synchronized (prefs) {
                // Put known groups in least-recently shuffled order, including any group missing from the index.
                LinkedHashSet<String> recent = new LinkedHashSet<>(prefs.getAll().keySet());
                recent.remove(RECENT);
                String saved = prefs.getString(RECENT, "");
                for (String key : saved.split(" "))
                    if (recent.remove(key))
                        recent.add(key);
                recent.remove(group);
                recent.add(group);
                SharedPreferences.Editor editor = prefs.edit().putString(group, order);
                Iterator<String> oldest = recent.iterator();
                while (recent.size() > LIMIT) {
                    editor.remove(oldest.next());
                    oldest.remove();
                }
                editor.putString(RECENT, TextUtils.join(" ", recent)).apply();
            }
        }

        // SharedPreferences commits wait for outstanding asynchronous writes to this file.
        boolean flush() {
            return prefs.edit().commit();
        }
    }

    static ShuffleHistory shuffleHistory(Context context, String server, String token, String userId) {
        String identity = userId == null || userId.isEmpty() ? "session:" + token : "user:" + userId;
        String account = OfflineStore.digest(server.replaceAll("/+$", "") + "\n" + identity);
        return new ShuffleHistory(context.getSharedPreferences("dn.shuffle." + account, Context.MODE_PRIVATE));
    }

    static CompletableFuture<Boolean> flushShuffle(ShuffleHistory history) {
        CompletableFuture<Boolean> receipt = new CompletableFuture<>();
        storage.execute(() -> {
            boolean committed;
            try {
                committed = history.flush();
            } catch (RuntimeException unavailable) {
                committed = false;
            }
            if (!committed)
                Log.w("DNPlayback", "The last shuffle could not be saved.");
            receipt.complete(committed);
        });
        return receipt;
    }

    static void shuffleSelection(Context context, String server, String userId, JSArray ids, boolean serverOrder,
            BiConsumer<JSArray, Exception> complete) {
        storage.execute(() -> {
            JSArray result;
            try {
                HttpUrl base = server == null ? null : HttpUrl.parse(server);
                if (base == null || !base.isHttps() || !base.username().isEmpty() || !base.password().isEmpty()
                        || base.encodedQuery() != null || base.encodedFragment() != null || userId == null
                        || userId.trim().isEmpty())
                    throw new IllegalArgumentException("Connect to a DroppedNeedle account to shuffle.");
                if (ids == null || ids.length() > 2000)
                    throw new IllegalArgumentException("Choose up to 2,000 library tracks.");
                ArrayList<String> files = new ArrayList<>(ids.length());
                for (int i = 0; i < ids.length(); i++) {
                    Object id = ids.opt(i);
                    if (!(id instanceof String) || !OfflineStore.validTrackId((String) id))
                        throw new IllegalArgumentException("Choose local DroppedNeedle library tracks.");
                    files.add((String) id);
                }
                ShuffleHistory history = shuffleHistory(context, base.toString(), null, userId);
                result = new JSArray(FreshShuffle.selection(files, history, serverOrder));
                if (!history.flush())
                    throw new IOException("The shuffled order could not be saved.");
            } catch (Exception failure) {
                complete.accept(null, failure);
                return;
            }
            complete.accept(result, null);
        });
    }

    static SecretKey key(String server, String token) {
        // DN issues random device tokens. Only secure storage keeps the token; playback derives a separate key.
        try {
            Mac prf = Mac.getInstance("HmacSHA256");
            prf.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return new SecretKeySpec(prf.doFinal(("DroppedNeedle Android playback v1\0" + server)
                    .getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Queue encryption is unavailable.", e);
        }
    }

    void write(SecretKey key, JSONObject state, boolean includesTracks) {
        AtomicFile target = includesTracks ? playlist : cursor;
        storage.execute(() -> {
            FileOutputStream output = null;
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key);
                cipher.updateAAD(target.getBaseFile().getName().getBytes(StandardCharsets.UTF_8));
                byte[] encrypted = cipher.doFinal(state.toString().getBytes(StandardCharsets.UTF_8));
                output = target.startWrite();
                output.write(cipher.getIV());
                output.write(encrypted);
                target.finishWrite(output);
            } catch (IOException | GeneralSecurityException e) {
                if (output != null) target.failWrite(output);
                Log.w("DNPlayback", "The playback queue could not be saved.");
            }
        });
    }

    private static JSONObject read(AtomicFile source, SecretKey key)
            throws IOException, GeneralSecurityException, JSONException {
        byte[] bytes = source.readFully();
        if (bytes.length < IV_LENGTH + 16) throw new IOException("Incomplete saved queue");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, IV_LENGTH));
        cipher.updateAAD(source.getBaseFile().getName().getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(bytes, IV_LENGTH, bytes.length - IV_LENGTH),
                StandardCharsets.UTF_8));
    }

    private JSONObject readQueue(SecretKey key, boolean clearInvalid) {
        JSONObject queue = null;
        try {
            queue = read(playlist, key);
        } catch (IOException | GeneralSecurityException | JSONException e) {
            // A changed account, a replaced device token or an unreadable record starts empty.
            if (clearInvalid) { playlist.delete(); cursor.delete(); }
        }
        if (queue != null) {
            try {
                JSONObject latest = read(cursor, key);
                if (latest.getString("revision").equals(queue.getString("revision"))) {
                    latest.put("tracks", queue.getJSONArray("tracks"));
                    for (String field : new String[]{"previousQueue", "shuffleOrder", "heard"})
                        if (queue.has(field)) latest.put(field, queue.get(field));
                    if (queue.has("userId")) latest.put("userId", queue.get("userId"));
                    else latest.remove("userId");
                    queue = latest;
                }
            } catch (IOException | GeneralSecurityException | JSONException e) {
                if (clearInvalid) cursor.delete();
            }
        }
        return queue;
    }
    void load(SecretKey key, Consumer<JSONObject> callback) {
        storage.execute(() -> {
            JSONObject result = readQueue(key, true);
            main.post(() -> callback.accept(result));
        });
    }
    JSONObject inspect(SecretKey key) { return readQueue(key, false); }
    void forHeadset(Context context, BiConsumer<HeadsetAccount, JSONObject> callback) {
        storage.execute(() -> {
            try {
                HeadsetAccount owner = HeadsetAccount.read(context);
                JSONObject queue = owner == null ? null : inspect(key(owner.server.toString(), owner.token));
                if (queue != null && owner.userId.equals(queue.opt("userId")) && owner.matches(HeadsetAccount.read(context))) {
                    main.post(() -> callback.accept(owner, queue));
                    return;
                }
            } catch (RuntimeException unavailable) {
                // Credential-protected storage can become unavailable while the request is in flight.
            }
            main.post(() -> callback.accept(null, null));
        });
    }

    void clear() {
        storage.execute(() -> { playlist.delete(); cursor.delete(); });
    }

    void afterWrite(Runnable callback) {
        storage.execute(() -> main.post(callback));
    }
}
