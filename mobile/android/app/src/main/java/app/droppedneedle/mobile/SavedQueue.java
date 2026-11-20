package app.droppedneedle.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
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
    // Service instances can overlap during teardown. File mutations must stay ordered across them.
    private static final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicFile playlist;
    private final AtomicFile cursor;

    SavedQueue(Context context) {
        File dir = context.getNoBackupFilesDir();
        playlist = new AtomicFile(new File(dir, "playback-queue.v1"));
        cursor = new AtomicFile(new File(dir, "playback-cursor.v1"));
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

    void load(SecretKey key, Consumer<JSONObject> callback) {
        storage.execute(() -> {
            JSONObject queue = null;
            try {
                queue = read(playlist, key);
            } catch (IOException | GeneralSecurityException | JSONException e) {
                // A changed account, a replaced device token or an unreadable record starts empty.
                playlist.delete();
                cursor.delete();
            }
            if (queue != null) {
                try {
                    JSONObject latest = read(cursor, key);
                    if (latest.getString("revision").equals(queue.getString("revision"))) {
                        latest.put("tracks", queue.getJSONArray("tracks"));
                        queue = latest;
                    }
                } catch (IOException | GeneralSecurityException | JSONException e) {
                    cursor.delete();
                }
            }
            JSONObject result = queue;
            main.post(() -> callback.accept(result));
        });
    }

    void clear() {
        storage.execute(() -> { playlist.delete(); cursor.delete(); });
    }

    void afterWrite(Runnable callback) {
        storage.execute(() -> main.post(callback));
    }
}
