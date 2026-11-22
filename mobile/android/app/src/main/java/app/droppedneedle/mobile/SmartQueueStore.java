package app.droppedneedle.mobile;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Immutable, session-encrypted smart playlist pages. Only the active window crosses into Media3. */
final class SmartQueueStore {
    static final int MAX = 10_000;
    private static final int PAGE = LibraryWindow.PAGE;
    private static final int MAX_PAGE_BYTES = LibraryWindow.MAX_BYTES / 2;
    private final File root;

    SmartQueueStore(Context context) {
        root = new File(context.getNoBackupFilesDir(), "smart-queues");
    }

    static boolean validId(String id) {
        if (id == null || id.length() != 36) return false;
        try { return UUID.fromString(id).toString().equals(id); }
        catch (IllegalArgumentException invalid) { return false; }
    }

    private static SecretKey key(String address, String token, String userId) throws IOException {
        HttpUrl base = address == null ? null : HttpUrl.parse(address);
        if (base == null || !base.isHttps() || !base.username().isEmpty() || !base.password().isEmpty()
                || base.query() != null || base.fragment() != null || token == null || token.isEmpty()) throw new IOException("Missing playlist account.");
        return SavedQueue.key(base.toString() + "\nsmart-playlist\n" + (userId == null ? "" : userId), token);
    }

    private static void authenticate(Cipher cipher, String snapshot, int offset, int total) {
        cipher.updateAAD((snapshot + "/" + offset + "/" + total).getBytes(StandardCharsets.UTF_8));
    }

    void write(String server, String token, String userId, String snapshot, int offset, int total, JSONArray tracks)
            throws IOException, GeneralSecurityException {
        if (!validId(snapshot) || tracks == null || total < 1 || total > MAX || offset < 0 || offset >= total
                || offset % PAGE != 0 || tracks.length() != Math.min(PAGE, total - offset))
            throw new IOException("Invalid smart playlist page.");
        byte[] bytes = tracks.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_PAGE_BYTES) throw new IOException("This playlist page has too much track metadata.");
        SecretKey key = key(server, token, userId);
        File dir = new File(root, snapshot);
        if (offset == 0) {
            clean(null);
            if (!root.isDirectory() && !root.mkdirs() || !dir.mkdir()) throw new IOException("Could not start playlist.");
        }
        if (!dir.isDirectory() || offset != 0 && !new File(dir, String.valueOf(offset - PAGE)).isFile())
            throw new IOException("Previous smart playlist page is missing.");
        AtomicFile page = new AtomicFile(new File(dir, Integer.toString(offset)));
        if (page.getBaseFile().isFile()) throw new IOException("Playlist page already exists.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        authenticate(cipher, snapshot, offset, total);
        byte[] encrypted = cipher.doFinal(bytes);
        FileOutputStream out = page.startWrite();
        try {
            out.write(cipher.getIV());
            out.write(encrypted);
            page.finishWrite(out);
        } catch (IOException e) {
            page.failWrite(out);
            throw e;
        }
    }

    LibraryWindow.Batch read(String server, String token, String userId, LibraryWindow cursor)
            throws IOException, GeneralSecurityException, JSONException {
        int start = cursor.after == null ? 0 : cursor.loaded;
        int count = Math.min(PAGE, cursor.total - start);
        SmartQueueOrder order = cursor.smartOrder;
        if (start == 0 && order != null && !order.shuffled) order = null;
        String snapshot = cursor.smartSnapshot;
        if (!validId(snapshot)) throw new IOException("Invalid smart playlist.");
        SecretKey key = key(server, token, userId);
        // Group requested positions by file, so even a shuffled refill decrypts each source page only once.
        HashMap<Integer, ArrayList<Integer>> pages = new HashMap<>();
        int[] positions = new int[count];
        for (int i = 0; i < count; i++) {
            int n = order == null ? start + i : order.at(start + i);
            positions[i] = n;
            pages.computeIfAbsent(n / PAGE * PAGE, unused -> new ArrayList<>()).add(i);
        }
        JSONObject[] items = new JSONObject[count];
        for (int offset : pages.keySet()) {
            JSONArray rows = readPage(key, snapshot, offset, cursor.total);
            for (int i : pages.get(offset)) {
                items[i] = rows.getJSONObject(positions[i] % PAGE).put("smartIndex", positions[i]);
            }
        }
        return new LibraryWindow.Batch(LibraryWindow.smart(snapshot, start + count, cursor.total, order), new JSONArray(items));
    }

    JSONArray carPage(HeadsetAccount owner, String snapshot, int start, int total)
            throws IOException, GeneralSecurityException, JSONException {
        if (!validId(snapshot)) throw new IOException("Invalid car playlist.");
        return readPage(key(owner.server.toString(), owner.token, owner.userId), snapshot, start, total);
    }

    void retainCar(String snapshot) throws IOException {
        if (!validId(snapshot)) throw new IOException("Invalid car playlist.");
        File marker = new File(new File(root, snapshot), "car");
        if (!marker.isFile() && !marker.createNewFile()) throw new IOException("Could not retain car playlist.");
    }

    void releaseCar(String snapshot) {
        if (validId(snapshot)) new File(new File(root, snapshot), "car").delete();
    }

    private JSONArray readPage(SecretKey key, String snapshot, int start, int total)
            throws IOException, GeneralSecurityException, JSONException {
        AtomicFile page = new AtomicFile(new File(new File(root, snapshot), Integer.toString(start)));
        if (page.getBaseFile().length() > MAX_PAGE_BYTES + 64L) throw new IOException("Invalid playlist page.");
        byte[] bytes = page.readFully();
        if (bytes.length < 28) throw new IOException("Incomplete playlist page.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12));
        authenticate(cipher, snapshot, start, total);
        JSONArray rows = new JSONArray(new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8));
        if (rows.length() != Math.min(PAGE, total - start)) throw new IOException("Incomplete playlist page.");
        return rows;
    }

    private static void keep(Set<String> keep, JSONObject archived) {
        if (archived == null) return;
        JSONObject window = archived.optJSONObject("continuation");
        if (window != null && validId(window.optString("smartSnapshot"))) keep.add(window.optString("smartSnapshot"));
    }

    // Called after the archive is safely written. A staged replacement can overlap the playing queue.
    void retain(JSONObject archive) {
        Set<String> keep = new HashSet<>();
        keep(keep, archive);
        if (archive != null) keep(keep, archive.optJSONObject("previousQueue"));
        clean(keep);
    }

    private void clean(Set<String> keep) {
        File[] dirs = root.listFiles();
        if (dirs == null) return;
        for (File dir : dirs) {
            if (!validId(dir.getName())) continue;
            File active = new File(dir, "active");
            if (keep != null && keep.contains(dir.getName())) {
                try { active.createNewFile(); } catch (IOException ignored) { /* Keep the live pages. */ }
            } else if (!new File(dir, "car").isFile() && (active.exists() ? keep != null : System.currentTimeMillis() - dir.lastModified() > 86_400_000L)) {
                File[] pages = dir.listFiles();
                if (pages != null) for (File page : pages) page.delete();
                dir.delete();
            }
        }
    }
}
