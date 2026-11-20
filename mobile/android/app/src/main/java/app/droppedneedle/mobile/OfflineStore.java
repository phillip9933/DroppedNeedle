package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import androidx.annotation.Nullable;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Complete audio and its catalogue live together under one server and DN user identity. */
final class OfflineStore {
    private static final Object LOCK = new Object();
    private static final Set<String> OPENED = new HashSet<>();
    private static final long MIB = 1024L * 1024;
    private final Context context;
    private final File dir;
    private final SharedPreferences index;
    private final HttpUrl base;
    private final String prefix;

    @Nullable
    static OfflineStore forUser(Context context, String server, @Nullable String userId) {
        if (userId == null || userId.isEmpty())
            return null;
        HttpUrl url = HttpUrl.parse(server);
        if (url == null || !url.isHttps() || !url.username().isEmpty() || !url.password().isEmpty()
                || url.query() != null || url.fragment() != null)
            throw new IllegalArgumentException("Invalid DN server.");
        return new OfflineStore(context, url, userId);
    }

    private OfflineStore(Context context, HttpUrl base, String userId) {
        this.context = context;
        this.base = base;
        prefix = base.encodedPath().replaceAll("/+$", "") + "/api/v3/stream/local/";
        String account = digest(base.toString().replaceAll("/+$", "") + "\n" + userId);
        dir = new File(new File(context.getNoBackupFilesDir(), "dn-offline"), account);
        index = context.getSharedPreferences("dn.offline." + account, Context.MODE_PRIVATE);
    }

    private static String digest(String text) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(64);
            for (byte b : bytes)
                out.append(Character.forDigit((b & 0xff) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
            return out.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    HttpUrl original(String id) {
        if (id == null || id.isEmpty() || id.equals(".") || id.equals("..") || id.contains("/")
                || id.contains("\\")) {
            throw new IllegalArgumentException("Choose a local library song.");
        }
        return base.newBuilder().encodedPath(prefix).addPathSegment(id).build();
    }

    @Nullable
    String trackId(String raw) {
        HttpUrl url = HttpUrl.parse(raw);
        if (url == null || !url.isHttps() || !url.host().equals(base.host()) || url.port() != base.port()
                || !url.username().isEmpty() || !url.password().isEmpty() || !url.encodedPath().startsWith(prefix))
            return null;
        String id = url.pathSegments().get(url.pathSize() - 1);
        if (id.isEmpty() || id.contains("/") || id.contains("\\"))
            return null;
        return original(id).encodedPath().equals(url.encodedPath()) ? id : null;
    }

    private static String row(String id) {
        return "track." + digest(id);
    }
    @Nullable
    private JSONObject entry(String key) {
        String raw = index.getString(key, null);
        if (raw == null)
            return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException damaged) {
            return null;
        }
    }
    @Nullable
    private File file(JSONObject entry) {
        if (entry == null)
            return null;
        String name = entry.optString("file", "");
        if (!name.matches("[a-f0-9-]{36}\\.audio"))
            return null;
        File f = new File(dir, name);
        return f.isFile() && f.length() == entry.optLong("bytes", -1) && f.length() > 0 ? f : null;
    }
    private ArrayList<JSONObject> entries() {
        ArrayList<JSONObject> list = new ArrayList<>();
        for (String key : index.getAll().keySet()) {
            if (!key.startsWith("track."))
                continue;
            JSONObject e = entry(key);
            if (file(e) != null)
                list.add(e);
        }
        list.sort(Comparator.comparingLong(e -> - e.optLong("used")));
        return list;
    }

    /** Metadata switches to the completed generation before an older file is unlinked. */
    private void prepareDirectory() throws IOException {
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory())
            throw new IOException("Device storage is unavailable.");
        if (!OPENED.add(dir.getAbsolutePath()))
            return;
        HashSet<String> retained = new HashSet<>();
        for (JSONObject e : entries())
            retained.add(e.optString("file"));
        File[] files = dir.listFiles();
        if (files != null)
            for (File f : files) {
                if ((f.getName().endsWith(".part") || f.getName().endsWith(".audio"))
                        && !retained.contains(f.getName()))
                    f.delete();
            }
    }
    boolean cacheEnabled() {
        return index.getBoolean("autoCache", false);
    }
    boolean offlineOnly() {
        return index.getBoolean("offlineOnly", false);
    }
    private long budget() {
        return index.getInt("cacheMiB", 512) * MIB;
    }
    boolean permittedNetwork() {
        if (!index.getBoolean("unmeteredOnly", true))
            return true;
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        return cm != null && cm.getActiveNetwork() != null && !cm.isActiveNetworkMetered();
    }
    JSONObject options() throws JSONException {
        return new JSONObject()
                .put("autoCache", cacheEnabled())
                .put("offlineOnly", offlineOnly())
                .put("unmeteredOnly", index.getBoolean("unmeteredOnly", true))
                .put("cacheMiB", index.getInt("cacheMiB", 512));
    }
    JSONObject snapshot() throws JSONException {
        synchronized (LOCK) {
            JSONArray list = new JSONArray();
            for (JSONObject e : entries()) {
                list.put(new JSONObject()
                                .put("track", e.getJSONObject("track"))
                                .put("pinned", e.getBoolean("pinned"))
                                .put("bytes", e.getLong("bytes"))
                                .put("used", e.getLong("used")));
            }
            return new JSONObject().put("options", options()).put("items", list);
        }
    }
    JSONObject configure(JSONObject options) throws JSONException, IOException {
        int limit = options.getInt("cacheMiB");
        if (limit < 128 || limit > 4096 || (limit & (limit - 1)) != 0)
            throw new IllegalArgumentException("Choose a supported cache size.");
        synchronized (LOCK) {
            SharedPreferences.Editor edit =
                    index.edit()
                            .putInt("cacheMiB", limit)
                            .putBoolean("autoCache", options.getBoolean("autoCache"))
                            .putBoolean("unmeteredOnly", options.getBoolean("unmeteredOnly"))
                            .putBoolean("offlineOnly", options.getBoolean("offlineOnly"));
            if (!options.getBoolean("autoCache"))
                edit.putLong("cacheGeneration", index.getLong("cacheGeneration", 0) + 1);
            requireWrite(edit);
            evict(budget());
            return options();
        }
    }

    private static void requireWrite(SharedPreferences.Editor edit) throws IOException {
        if (!edit.commit())
            throw new IOException("Device storage could not save this change.");
    }
    @Nullable
    File playable(String streamUrl) {
        String id = trackId(streamUrl);
        if (id == null)
            return null;
        synchronized (LOCK) {
            String key = row(id);
            JSONObject e = entry(key);
            File f = file(e);
            if (f != null && !e.optBoolean("pinned") && System.currentTimeMillis() - e.optLong("used") > 60000) {
                try {
                    e.put("used", System.currentTimeMillis());
                    index.edit().putString(key, e.toString()).apply();
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            return f;
        }
    }
    boolean pinExisting(String id) throws IOException, JSONException {
        synchronized (LOCK) {
            String key = row(id);
            JSONObject e = entry(key);
            if (file(e) == null)
                return false;
            if (!e.optBoolean("pinned")) {
                e.put("pinned", true).put("used", System.currentTimeMillis());
                requireWrite(index.edit().putString(key, e.toString()));
            }
            return true;
        }
    }
    private void discard(String key, JSONObject e) throws IOException {
        File f = file(e);
        requireWrite(index.edit().remove(key).putLong("revision." + key, index.getLong("revision." + key, 0) + 1));
        if (f != null)
            f.delete();
    }
    void remove(JSONArray ids) throws JSONException, IOException {
        synchronized (LOCK) {
            for (int i = 0; i < ids.length(); i++) {
                String key = row(ids.getString(i));
                discard(key, entry(key));
            }
        }
    }
    private void evict(long budget) throws IOException, JSONException {
        long kept = 0;
        for (JSONObject e : entries()) {
            if (e.getBoolean("pinned"))
                continue;
            long size = e.getLong("bytes");
            if (kept + size <= budget)
                kept += size;
            else
                discard(row(e.getJSONObject("track").getString("id")), e);
        }
    }
    void clearCache() throws IOException, JSONException {
        synchronized (LOCK) {
            requireWrite(index.edit().putLong("cacheGeneration", index.getLong("cacheGeneration", 0) + 1));
            evict(0);
        }
    }
    @Nullable
    Capture begin(JSONObject track, boolean pin, long expected) throws IOException, JSONException {
        String id = track.getString("id");
        HttpUrl stream = original(id);
        JSONObject copy =
                new JSONObject()
                        .put("id", id)
                        .put("title", track.getString("title"))
                        .put("artist", track.optString("artist", ""))
                        .put("album", track.optString("album", ""))
                        .put("streamUrl",
                                "/api/v3/stream/local/" + stream.encodedPath().substring(prefix.length()));
        if (track.optDouble("duration", 0) > 0)
            copy.put("duration", track.getDouble("duration"));
        // Library artwork is optional offline; keep only its verified same-server path.
        String art = track.optString("artworkUrl", "");
        String api = base.encodedPath().replaceAll("/+$", "") + "/api/v3/";
        HttpUrl image = art.startsWith("/api/v3/")
                ? base.newBuilder()
                          .encodedPath(base.encodedPath().replaceAll("/+$", "") + art.split("\\?", 2)[0])
                          .query(null)
                          .build()
                : HttpUrl.parse(art);
        if (image != null && image.scheme().equals(base.scheme()) && image.host().equals(base.host())
                && image.port() == base.port() && image.username().isEmpty() && image.password().isEmpty()
                && image.encodedPath().startsWith(api))
            copy.put("artworkUrl", "/api/v3/" + image.encodedPath().substring(api.length()) + "?size=500");
        synchronized (LOCK) {
            if (!pin
                    && (!cacheEnabled() || !permittedNetwork() || expected > budget()
                            || file(entry(row(id))) != null))
                return null;
            prepareDirectory();
            return new Capture(row(id), copy, pin, expected);
        }
    }
    final class Capture implements Closeable {
        private final String key;
        private final JSONObject track;
        private final boolean pin;
        private final long generation, revision, expected, limit;
        private final File temp;
        private final FileOutputStream output;
        private long bytes;
        private long nextNetworkCheck = 1_048_576;
        private boolean closed;
        Capture(String key, JSONObject track, boolean pin, long expected) throws IOException {
            this.key = key;
            this.track = track;
            this.pin = pin;
            this.expected = expected;
            generation = index.getLong("cacheGeneration", 0);
            revision = index.getLong("revision." + key, 0);
            limit = pin ? Long.MAX_VALUE : budget();
            temp = File.createTempFile("audio-", ".part", dir);
            try {
                output = new FileOutputStream(temp);
            } catch (IOException failure) {
                temp.delete();
                throw failure;
            }
        }
        void write(byte[] buffer, int offset, int count) throws IOException {
            if (bytes + count > limit || (expected >= 0 && bytes + count > expected))
                throw new IOException("Audio exceeds the available cache limit.");
            if (bytes + count >= nextNetworkCheck) {
                if (!permittedNetwork())
                    throw new IOException("Connect to an unmetered network or change Offline settings.");
                nextNetworkCheck = bytes + count + MIB;
            }
            output.write(buffer, offset, count);
            bytes += count;
        }
        void finish() throws IOException, JSONException {
            if (bytes <= 0 || (expected >= 0 && bytes != expected))
                throw new IOException("The audio download was incomplete.");
            output.getFD().sync();
            output.close();
            synchronized (LOCK) {
                if (index.getLong("revision." + key, 0) != revision)
                    throw new IOException("The offline copy was removed.");
                if (!pin
                        && (!cacheEnabled() || index.getLong("cacheGeneration", 0) != generation
                                || bytes > budget()))
                    return;
                JSONObject old = entry(key);
                if (file(old) != null && (old.optBoolean("pinned") || !pin))
                    return;
                File destination = new File(dir, UUID.randomUUID() + ".audio");
                if (!temp.renameTo(destination))
                    throw new IOException("Could not finish the audio download.");
                JSONObject e = new JSONObject()
                                       .put("track", track)
                                       .put("pinned", pin)
                                       .put("used", System.currentTimeMillis())
                                       .put("bytes", bytes)
                                       .put("file", destination.getName());
                try {
                    requireWrite(index.edit().putString(key, e.toString()));
                } catch (IOException failed) {
                    destination.delete();
                    throw failed;
                }
                File previous = file(old);
                if (previous != null)
                    previous.delete();
                if (!pin)
                    evict(budget());
            }
        }
        @Override
        public void close() throws IOException {
            if (!closed) {
                closed = true;
                try {
                    output.close();
                } finally {
                    temp.delete();
                }
            }
        }
    }
    static boolean isAudio(@Nullable String type) {
        String mime = type == null ? "" : type.split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
        return mime.startsWith("audio/") || mime.equals("application/octet-stream")
                || mime.equals("application/ogg") || mime.equals("application/flac");
    }
}
