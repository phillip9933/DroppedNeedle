package app.droppedneedle.mobile;

import android.util.Base64;
import java.security.SecureRandom;
import org.json.JSONException;
import org.json.JSONObject;

/** A permutation of immutable file positions, including separate occurrences of the same song. */
final class SmartQueueOrder {
    final boolean shuffled;
    private final int[] indices;
    final String packed;
    private static final SecureRandom random = new SecureRandom();

    private SmartQueueOrder(boolean shuffled, int[] indices) {
        this.shuffled = shuffled;
        this.indices = indices;
        byte[] bytes = new byte[indices.length * 2];
        for (int i = 0; i < indices.length; i++) {
            bytes[2*i] = (byte)(indices[i] >> 8);
            bytes[2*i+1] = (byte)indices[i];
        }
        packed = Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    static SmartQueueOrder read(JSONObject data, int total) throws JSONException {
        if (!data.has("smartOrder")) return null;
        String packed = data.getString("smartOrder");
        if (packed.length() != 4 * ((2 * total + 2) / 3)) throw new JSONException("Invalid playlist order.");
        byte[] bytes;
        try { bytes = Base64.decode(packed, Base64.NO_WRAP); }
        catch (IllegalArgumentException bad) { throw new JSONException("Invalid playlist order."); }
        if (bytes.length != total * 2) throw new JSONException("Invalid playlist order.");
        int[] positions = new int[total];
        boolean[] seen = new boolean[total];
        for (int i = 0; i < total; i++) {
            int position = ((bytes[2*i] & 255) << 8) | (bytes[2*i+1] & 255);
            if (position >= total || seen[position]) throw new JSONException("Invalid playlist order.");
            positions[i] = position;
            seen[position] = true;
        }
        return new SmartQueueOrder(data.getBoolean("smartShuffled"), positions);
    }

    int at(int index) { return indices[index]; }

    static LibraryWindow toggle(LibraryWindow cursor, int[] displayed, boolean[] priority, int current) {
        int total = cursor.total, filled = 0;
        boolean[] visible = new boolean[total], keep = new boolean[total];
        int[] next = new int[total];
        for (int n : displayed) {
            if (n == -1) continue; // Manually inserted queue entry.
            if (n < 0 || n >= total || visible[n]) throw new IllegalArgumentException("Invalid smart queue position.");
            visible[n] = true;
        }
        // Retain pruned history first, then the actual played and priority occurrences in timeline order.
        for (int i = 0; i < cursor.loaded; i++) {
            int n = cursor.sourceIndex(i);
            if (!visible[n]) {
                next[filled++] = n;
                keep[n] = true;
            }
        }
        for (int i = 0; i < displayed.length; i++) {
            int n = displayed[i];
            if (n >= 0 && (i <= current || priority[i])) {
                next[filled++] = n;
                keep[n] = true;
            }
        }
        int loaded = filled;
        for (int n = 0; n < total; n++) if (!keep[n]) next[filled++] = n;
        boolean enabled = cursor.smartOrder == null || !cursor.smartOrder.shuffled;
        if (enabled) {
            for (int i = total - 1; i > loaded; i--) {
                int j = loaded + random.nextInt(i - loaded + 1);
                int tmp = next[j]; next[j] = next[i]; next[i] = tmp;
            }
        }
        return LibraryWindow.smart(cursor.smartSnapshot, loaded, total, new SmartQueueOrder(enabled, next));
    }
}
