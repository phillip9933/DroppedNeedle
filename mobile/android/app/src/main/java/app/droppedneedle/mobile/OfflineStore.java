package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.util.Base64;
import androidx.annotation.Nullable;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
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
    static final String CACHE = "cached", AUTOMATIC = "automatic", DOWNLOAD = "downloaded";
    static volatile Runnable mediaChanged;
    static void changed() {
        Runnable listener = mediaChanged;
        if (listener != null) listener.run();
    }
    private static String origin(JSONObject e) {
        return e.optString("origin", e.optBoolean("pinned") ? DOWNLOAD : CACHE);
    }
    private static final long MIB = 1024L * 1024;
    private final Context context;
    private final File dir;
    private final SharedPreferences index;
    private final HttpUrl base;
    private final String prefix;
    final String account;

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
        account = digest(base.toString().replaceAll("/+$", "") + "\n" + userId);
        dir = new File(new File(context.getNoBackupFilesDir(), "dn-offline"), account);
        index = context.getSharedPreferences("dn.offline." + account, Context.MODE_PRIVATE);
    }

    static String digest(String text) {
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

    static boolean validTrackId(String id) {
        return id != null && !id.isEmpty() && !id.equals(".") && !id.equals("..")
                && !id.contains("/") && !id.contains("\\") && id.chars().noneMatch(Character::isISOControl);
    }
    HttpUrl original(String id) {
        if (!validTrackId(id)) {
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
        if (!validTrackId(id))
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
        return list;
    }
    private ArrayList<JSONObject> newestFirst() {
        ArrayList<JSONObject> list = entries();
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
    // Even revisions record offline history. A withdrawal also disqualifies the current occurrence
    // if the listener enables recording again before the song ends.
    long historyRevision() { return index.getLong("historyRevision", 0); }
    boolean recordsHistory() { return (historyRevision() & 1) == 0; }
    void recordHistory(boolean enabled) throws IOException {
        synchronized (LOCK) {
            if (enabled != recordsHistory()) requireWrite(index.edit().putLong("historyRevision", historyRevision() + 1));
        }
    }
    Runnable watchOfflineMode(Runnable changed) {
        SharedPreferences.OnSharedPreferenceChangeListener watch = (prefs, key) -> {
            if ("offlineOnly".equals(key) || "historyRevision".equals(key)) changed.run();
        };
        index.registerOnSharedPreferenceChangeListener(watch);
        return () -> index.unregisterOnSharedPreferenceChangeListener(watch);
    }
    private long budget() {
        return index.getInt("cacheMiB", 512) * MIB;
    }
    private String source() { return index.getString("autoDownload", "off"); }
    private static boolean playlistSource(String value) {
        if (value == null || !value.startsWith("playlist:") || value.length() > "playlist:".length() + 342) return false;
        String encoded = value.substring("playlist:".length());
        int flags = Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING;
        try {
            byte[] bytes = Base64.decode(encoded, flags);
            if (bytes.length == 0 || bytes.length > 256 || !encoded.equals(Base64.encodeToString(bytes, flags))) return false;
            String id = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
            return !id.equals(".") && !id.equals("..") && id.chars().noneMatch(Character::isISOControl);
        } catch (IllegalArgumentException | CharacterCodingException invalid) { return false; }
    }
    static boolean enabledSource(String source) {
        return "recent".equals(source) || "favorites".equals(source) || playlistSource(source);
    }
    JSONArray extraPins() throws JSONException { return new JSONArray(index.getString("offlinePins", "[]")); }
    JSONArray effectivePins() throws JSONException { return OfflinePins.effective(source(), extraPins()); }
    private boolean hasExtraPins() { return !"[]".equals(index.getString("offlinePins", "[]")); }
    private long automaticBudget() { return index.getInt("downloadMiB", 512) * MIB; }
    static final class DownloadLimit extends IOException {
        DownloadLimit() { super("The automatic download limit has been reached."); }
    }
    private void requireRoom(long added) throws IOException {
        long used = 0;
        for (JSONObject item : entries()) if (AUTOMATIC.equals(origin(item))) used += item.optLong("bytes");
        if (used + added > automaticBudget()) throw new DownloadLimit();
    }
    private boolean automaticAllowed(String source, String key) {
        boolean allowed = OfflinePins.SOURCE.equals(source) ? hasExtraPins() || enabledSource(source()) : enabledSource(source) && source.equals(source());
        return allowed && !offlineOnly()
                && !index.getBoolean("exclude." + key, false);
    }
    boolean unmeteredOnly() { return index.getBoolean("unmeteredOnly", true); }
    boolean permittedNetwork() {
        if (!unmeteredOnly())
            return true;
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        return cm != null && cm.getActiveNetwork() != null && !cm.isActiveNetworkMetered();
    }
    StreamProfiles.Quality downloadQuality() throws JSONException {
        return new StreamProfiles.Quality(new JSONObject(index.getString("downloadQuality", "{\"format\":\"original\",\"rate\":192}")));
    }

    JSONObject options() throws JSONException {
        return new JSONObject()
                .put("offlinePins", extraPins()).put("downloadQuality", downloadQuality().json()).put("autoDownload", source()).put("downloadMiB", index.getInt("downloadMiB", 512))
                .put("autoCache", cacheEnabled())
                .put("offlineOnly", offlineOnly())
                .put("unmeteredOnly", index.getBoolean("unmeteredOnly", true))
                .put("cacheMiB", index.getInt("cacheMiB", 512));
    }
    JSONObject snapshot() throws JSONException {
        synchronized (LOCK) {
            JSONArray list = new JSONArray();
            for (JSONObject e : newestFirst()) {
                list.put(new JSONObject()
                                .put("track", e.getJSONObject("track"))
                                .put("mime", e.opt("mime")).put("origin", origin(e)).put("pinned", DOWNLOAD.equals(origin(e)))
                                .put("bytes", e.getLong("bytes"))
                                .put("used", e.getLong("used")));
            }
            JSONArray playlists = new JSONArray();
            for (String key : index.getAll().keySet()) {
                if (key.startsWith("playlistMembers.")) playlists.put(new JSONObject(index.getString(key,"{}")));
            }
            return new JSONObject().put("options", options()).put("items", list).put("pinnedPlaylists",playlists);
        }
    }
    JSONObject configure(JSONObject options) throws JSONException, IOException {
        return configure(options,false);
    }
    JSONObject configure(JSONObject options, boolean clearUnpinned) throws JSONException, IOException {
        int limit = options.getInt("cacheMiB");
        int downloads = options.optInt("downloadMiB", 512);
        String source = options.optString("autoDownload", "off");
        if (!source.equals("off") && !enabledSource(source)) throw new IllegalArgumentException("Choose a supported download source.");
        if (downloads < 128 || downloads > 4096 || (downloads & (downloads - 1)) != 0
                || limit < 128 || limit > 4096 || (limit & (limit - 1)) != 0)
            throw new IllegalArgumentException("Choose a supported cache size.");
        synchronized (LOCK) {
            SharedPreferences.Editor edit =
                    index.edit()
                            .putInt("cacheMiB", limit).putString("autoDownload", source).putInt("downloadMiB", downloads)
                            .putBoolean("autoCache", options.getBoolean("autoCache"))
                            .putBoolean("unmeteredOnly", options.getBoolean("unmeteredOnly"))
                            .putBoolean("offlineOnly", options.getBoolean("offlineOnly"));
            String beforePins = index.getString("offlinePins", "[]");
            String pins = options.has("offlinePins") ? OfflinePins.validate(options.getJSONArray("offlinePins")).toString() : beforePins;
            edit.putString("offlinePins", pins);
            Set<String> playlists = new HashSet<>();
            JSONArray activePins = OfflinePins.effective(source,new JSONArray(pins));
            for (int i=0;i<activePins.length();i++) {
                JSONObject pin=activePins.getJSONObject(i);
                if ("playlist".equals(pin.getString("kind"))) playlists.add("playlistMembers."+digest(pin.getString("id")));
            }
            for (String key : index.getAll().keySet()) if (key.startsWith("playlistMembers.") && !playlists.contains(key)) edit.remove(key);
            if (options.has("downloadQuality")) edit.putString("downloadQuality",
                    new StreamProfiles.Quality(options.getJSONObject("downloadQuality")).json().toString());
            if (!options.getBoolean("autoCache"))
                edit.putLong("cacheGeneration", index.getLong("cacheGeneration", 0) + 1);
            if (!pins.equals(beforePins) || !source.equals(source()) || options.getBoolean("unmeteredOnly") != unmeteredOnly() || options.getBoolean("offlineOnly") != offlineOnly())
                edit.putLong("automaticGeneration", index.getLong("automaticGeneration", 0) + 1);
            boolean removeLast = clearUnpinned && pins.equals("[]") && source.equals("off");
            if (removeLast) retainAutomatic(Collections.emptySet(), false, edit);
            else requireWrite(edit);
            evict(CACHE, budget());
            evict(AUTOMATIC, automaticBudget());
            changed();
            return options();
        }
    }

    private static void requireWrite(SharedPreferences.Editor edit) throws IOException {
        if (!edit.commit())
            throw new IOException("Device storage could not save this change.");
    }
    @Nullable
    File playable(String streamUrl) { return savedFile(streamUrl, true); }

    @Nullable
    File artworkSource(String streamUrl) { return savedFile(streamUrl, false); }

    @Nullable
    private File savedFile(String streamUrl, boolean playing) {
        String id = trackId(streamUrl);
        if (id == null)
            return null;
        synchronized (LOCK) {
            String key = row(id);
            JSONObject e = entry(key);
            File f = file(e);
            if (playing && f != null && !e.optBoolean("pinned")
                    && System.currentTimeMillis() - e.optLong("used") > 60000) {
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
    long itemRevision(String id) { return index.getLong("revision." + row(id), 0); }
    long autoGeneration() { return index.getLong("automaticGeneration", 0); }
    boolean hasAudio(String id) {
        synchronized (LOCK) { return file(entry(row(id))) != null; }
    }
    boolean needsAutomaticCopy(String id) {
        synchronized (LOCK) {
            String key = row(id);
            JSONObject saved = entry(key);
            return !index.getBoolean("exclude." + key, false) && (file(saved) == null || CACHE.equals(origin(saved)));
        }
    }
    boolean pinExisting(String id) throws IOException, JSONException {
        return keepExisting(id, null, null);
    }
    boolean keepExisting(String id, @Nullable String source, @Nullable JSONObject details) throws IOException, JSONException {
        synchronized (LOCK) {
            String key = row(id);
            if (source != null && !automaticAllowed(source, key)) return true;
            JSONObject e = entry(key);
            if (file(e) == null) return false;
            String target = source == null ? DOWNLOAD : AUTOMATIC;
            if (source != null && !CACHE.equals(origin(e))) return true;
            if (AUTOMATIC.equals(target)) requireRoom(e.getLong("bytes"));
            if (details != null) addDetails(e.getJSONObject("track"), details);
            e.put("origin", target).put("pinned", DOWNLOAD.equals(target)).put("used", System.currentTimeMillis());
            SharedPreferences.Editor editor = index.edit().putString(key, e.toString());
            if (source == null) editor.remove("exclude." + key);
            requireWrite(editor);
            changed();
            return true;
        }
    }
    void cancelAutomatic() throws IOException {
        synchronized (LOCK) { requireWrite(index.edit().putLong("automaticGeneration", autoGeneration() + 1)); }
    }
    JSONObject planAutomatic(String source, JSONArray ids) throws IOException, JSONException {
        return planAutomatic(source, ids, false);
    }
    JSONObject planAutomatic(String source, JSONArray ids, boolean keepExisting) throws IOException, JSONException {
        JSONArray result = new JSONArray();
        synchronized (LOCK) {
            if ("off".equals(source)) return new JSONObject().put("ids", result);
            if (!enabledSource(source) || ids == null) throw new IllegalArgumentException("Choose a valid automatic download source and track list.");
            if (!source.equals(source()) || offlineOnly() || !permittedNetwork())
                return new JSONObject().put("ids", result);
            Set<String> wanted = new LinkedHashSet<>();
            int count = source.startsWith("playlist:") ? ids.length() : Math.min(25, ids.length());
            for (int i = 0; i < count; i++) {
                Object item = ids.get(i);
                if (!(item instanceof String id) || !validTrackId(id))
                    throw new IllegalArgumentException("The download source contains an invalid library song.");
                wanted.add(id);
            }
            Set<String> present = retainAutomatic(wanted, keepExisting || hasExtraPins(), null);
            for (String id : wanted)
                if (!present.contains(id) && !index.getBoolean("exclude." + row(id), false)) result.put(id);
            return new JSONObject().put("ids", result);
        }
    }
    JSONObject clearAutomaticPlaylist(String source) throws IOException, JSONException {
        synchronized (LOCK) {
            if (!playlistSource(source) || !source.equals(source()))
                throw new IllegalArgumentException("The selected download playlist changed.");
            retainAutomatic(Collections.emptySet(), hasExtraPins(), index.edit().putString("autoDownload", "off")
                    .putLong("automaticGeneration", autoGeneration() + 1));
            return options();
        }
    }
    void playlistMembers(long generation, String id, String name, JSONArray ids) throws JSONException, IOException {
        synchronized (LOCK) {
            if (autoGeneration() != generation)
                throw new IOException("Offline settings changed.");
            String key = "playlistMembers." + digest(id);
            String record = new JSONObject().put("id", id).put("name", name).put("ids", ids).toString();
            if (!record.equals(index.getString(key, null))) {
                requireWrite(index.edit().putString(key, record));
                changed();
            }
        }
    }
    void prunePinned(long generation, java.util.function.Predicate<String> wanted) throws IOException, JSONException {
        synchronized (LOCK) {
            if (generation != autoGeneration() || offlineOnly() || !permittedNetwork())
                throw new IOException("Offline settings changed.");
            Set<String> keep = new HashSet<>();
            for (JSONObject entry : entries()) {
                String id = entry.getJSONObject("track").getString("id");
                if (AUTOMATIC.equals(origin(entry)) && wanted.test(id))
                    keep.add(id);
            }
            retainAutomatic(keep, false, null);
        }
    }

    private Set<String> retainAutomatic(Set<String> wanted, boolean keepExisting, @Nullable SharedPreferences.Editor changes)
            throws IOException, JSONException {
        Set<String> present = new HashSet<>();
        ArrayList<File> removals = new ArrayList<>();
        for (String key : index.getAll().keySet()) {
            if (!key.startsWith("track.")) continue;
            JSONObject entry = entry(key);
            if (entry == null) continue;
            String id = entry.getJSONObject("track").getString("id"), existingOrigin = origin(entry);
            if (!keepExisting && AUTOMATIC.equals(existingOrigin) && !wanted.contains(id)) {
                if (changes == null) changes = index.edit();
                removeRow(changes, key);
                File audio = file(entry);
                if (audio != null) removals.add(audio);
            } else if (wanted.contains(id) && !CACHE.equals(existingOrigin) && file(entry) != null) present.add(id);
        }
        if (changes != null) {
            requireWrite(changes);
            for (File file : removals) file.delete();
            changed();
        }
        return present;
    }
    private SharedPreferences.Editor removeRow(SharedPreferences.Editor edit, String key) {
        return edit.remove(key).putLong("revision." + key, index.getLong("revision." + key, 0) + 1);
    }
    private void discard(String key, JSONObject e) throws IOException {
        File f = file(e);
        requireWrite(removeRow(index.edit(), key));
        if (f != null)
            f.delete();
    }
    void remove(JSONArray ids) throws JSONException, IOException {
        synchronized (LOCK) {
            for (int i = 0; i < ids.length(); i++) {
                String key = row(ids.getString(i));
                requireWrite(index.edit().putBoolean("exclude." + key, true));
                discard(key, entry(key));
            }
            changed();
        }
    }
    private void evict(String origin, long budget) throws IOException, JSONException {
        long kept = 0;
        for (JSONObject e : newestFirst()) {
            if (!origin.equals(origin(e)))
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
            evict(CACHE, 0);
            changed();
        }
    }
    @Nullable
    Capture begin(JSONObject track, boolean pin, long expected) throws IOException, JSONException {
        return begin(track, pin ? DOWNLOAD : CACHE, null, expected);
    }
    private static void addDetails(JSONObject copy, JSONObject track) throws JSONException {
        for (String k : new String[]{"albumId","artistId","albumArtist","albumArtistId","genre","format","artistMbid","releaseGroupMbid","recordingMbid"})
            if (track.opt(k) instanceof String && !track.getString(k).isEmpty()) copy.put(k, track.getString(k));
        for (String k : new String[]{"year","trackNumber","discNumber","dateAdded","rating","replayGainTrackDb","replayGainAlbumDb","replayGainTrackPeak","replayGainAlbumPeak"})
            if (track.opt(k) instanceof Number) copy.put(k, track.get(k));
        if (track.opt("favorite") instanceof Boolean) copy.put("favorite", track.get("favorite"));
    }
    JSONObject retained(JSONObject track) throws JSONException {
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
        addDetails(copy, track);
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
        return copy;
    }

    @Nullable
    Capture begin(JSONObject track, String origin, @Nullable String source, long expected) throws IOException, JSONException {
        JSONObject copy = retained(track);
        String id = copy.getString("id");
        synchronized (LOCK) {
            if (CACHE.equals(origin)
                    && (!cacheEnabled() || !permittedNetwork() || expected > budget()
                            || file(entry(row(id))) != null))
                return null;
            if (AUTOMATIC.equals(origin)) {
                if (!automaticAllowed(source, row(id)) || !permittedNetwork()) return null;
                if (expected > 0) requireRoom(expected);
            }
            prepareDirectory();
            return new Capture(row(id), copy, origin, source, expected);
        }
    }
    final class Capture implements Closeable {
        private final String key;
        private final JSONObject track;
        private final String origin, source;
        private final long generation, revision, expected, limit;
        private final File temp;
        private final FileOutputStream output;
        private long bytes;
        private long nextNetworkCheck = 1_048_576;
        private boolean closed;
        Capture(String key, JSONObject track, String origin, @Nullable String source, long expected) throws IOException {
            this.key = key;
            this.track = track;
            this.origin = origin;
            this.source = source;
            this.expected = expected;
            generation = index.getLong(AUTOMATIC.equals(origin) ? "automaticGeneration" : "cacheGeneration", 0);
            revision = index.getLong("revision." + key, 0);
            limit = DOWNLOAD.equals(origin) ? Long.MAX_VALUE : AUTOMATIC.equals(origin) ? automaticBudget() : budget();
            temp = File.createTempFile("audio-", ".part", dir);
            try {
                output = new FileOutputStream(temp);
            } catch (IOException failure) {
                temp.delete();
                throw failure;
            }
        }
        void write(byte[] buffer, int offset, int count) throws IOException {
            if (AUTOMATIC.equals(origin) && bytes + count > limit) throw new DownloadLimit();
            if (bytes + count > limit || (expected >= 0 && bytes + count > expected))
                throw new IOException("Audio exceeds the available cache limit.");
            if (bytes + count >= nextNetworkCheck) {
                if (AUTOMATIC.equals(origin) && (autoGeneration() != generation || !automaticAllowed(source, key)))
                    throw new IOException("The automatic download settings changed.");
                if (!permittedNetwork())
                    throw new IOException("Connect to an unmetered network or change Offline settings.");
                nextNetworkCheck = bytes + count + MIB;
            }
            output.write(buffer, offset, count);
            bytes += count;
        }
        void finish() throws IOException, JSONException { finish(null); }
        void finish(@Nullable String mime) throws IOException, JSONException {
            if (bytes <= 0 || (expected >= 0 && bytes != expected))
                throw new IOException("The audio download was incomplete.");
            output.getFD().sync();
            output.close();
            if (mime != null) mime = DownloadRepresentation.storedType(temp,mime);
            synchronized (LOCK) {
                if (index.getLong("revision." + key, 0) != revision)
                    throw new IOException("The offline copy was removed.");
                if (CACHE.equals(origin)
                        && (!cacheEnabled() || index.getLong("cacheGeneration", 0) != generation
                                || bytes > budget()))
                    return;
                JSONObject old = entry(key);
                if (file(old) != null && (CACHE.equals(origin) || DOWNLOAD.equals(origin(old)) ||
                        (AUTOMATIC.equals(origin) && AUTOMATIC.equals(origin(old))))) return;
                if (AUTOMATIC.equals(origin)) {
                    if (!automaticAllowed(source, key) || index.getLong("automaticGeneration", 0) != generation)
                        throw new IOException("The automatic download settings changed.");
                    requireRoom(bytes);
                }
                File destination = new File(dir, UUID.randomUUID() + ".audio");
                if (!temp.renameTo(destination))
                    throw new IOException("Could not finish the audio download.");
                JSONObject e = new JSONObject()
                                       .put("track", track).put("mime", mime)
                                       .put("origin", origin).put("pinned", DOWNLOAD.equals(origin))
                                       .put("used", System.currentTimeMillis())
                                       .put("bytes", bytes)
                                       .put("file", destination.getName());
                try {
                    SharedPreferences.Editor write = index.edit().putString(key, e.toString());
                    if (DOWNLOAD.equals(origin)) write.remove("exclude." + key);
                    requireWrite(write);
                } catch (IOException failed) {
                    destination.delete();
                    throw failed;
                }
                File previous = file(old);
                if (previous != null)
                    previous.delete();
                if (CACHE.equals(origin)) evict(CACHE, budget());
                changed();
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
