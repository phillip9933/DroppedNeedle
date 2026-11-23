package app.droppedneedle.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Binder;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.json.JSONObject;

/** Serves resized DN covers to Android Auto without putting credentials or server URLs in media metadata. */
public final class CarArtworkProvider extends ContentProvider {
    private static final OkHttpClient HTTP = new OkHttpClient.Builder().followRedirects(false)
            .followSslRedirects(false).callTimeout(7, TimeUnit.SECONDS).build();

    static String scope(HeadsetAccount account) {
        return OfflineStore.digest(account.server + "\n" + account.userId + "\n" + account.token);
    }

    static String relative(HttpUrl server, String raw) {
        if (raw == null || raw.isEmpty()) return null;
        if (raw.startsWith("/api/v3/")) return coverPath(raw);
        HttpUrl url = HttpUrl.parse(raw);
        if (url == null || !server.scheme().equals(url.scheme()) || !server.host().equals(url.host())
                || server.port() != url.port() || !url.username().isEmpty() || !url.password().isEmpty()) return null;
        String prefix = server.encodedPath().replaceAll("/+$", "");
        return url.encodedPath().startsWith(prefix + "/api/v3/")
                ? coverPath(url.encodedPath().substring(prefix.length())) : null;
    }
    private static String coverPath(String raw) {
        String album = OfflineCompanions.coverPath(raw);
        if (album != null) return album;
        if (raw == null || !raw.startsWith("/api/v3/playlists/")) return null;
        Uri uri = Uri.parse(raw);
        List<String> parts = uri.getPathSegments();
        return parts.size() == 5 && "cover".equals(parts.get(4)) && OfflineStore.validTrackId(parts.get(3))
                ? "/api/v3/playlists/" + Uri.encode(parts.get(3)) + "/cover" : null;
    }

    static Uri folderUri(String authority, String scope, HttpUrl base, String id, String raw) {
        String path = relative(base, raw);
        if (path == null || !OfflineStore.validTrackId(id)) return null;
        return new Uri.Builder().scheme("content").authority(authority).appendPath(scope)
                .appendPath("folder").appendPath(id).appendQueryParameter("cover", path).build();
    }

    static Uri uri(String authority, String scope, HttpUrl base, JSONObject track) {
        String id = track.optString("id");
        if (!OfflineStore.validTrackId(id)) return null;
        String path = relative(base, track.optString("artworkUrl"));
        Uri.Builder uri = new Uri.Builder().scheme("content").authority(authority).appendPath(scope).appendPath(id);
        if (path != null) uri.appendQueryParameter("cover", path);
        return uri.build();
    }
    @Override public boolean onCreate() { return true; }

    private void checkCaller(Context context) {
        int uid = Binder.getCallingUid();
        if (uid == Process.myUid() || context.checkCallingPermission(android.Manifest.permission.MEDIA_CONTENT_CONTROL)
                == PackageManager.PERMISSION_GRANTED) return;
        PackageManager pm = context.getPackageManager();
        String[] names = pm.getPackagesForUid(uid);
        if (names != null) for (String name : names) {
            boolean companion = name.equals("com.google.android.projection.gearhead");
            boolean automotive = name.equals("com.android.car.media") || name.equals("com.android.car.carlauncher");
            if (CarSession.verifiedCarHost(context, name, uid, companion, automotive)) return;
        }
        throw new SecurityException("A trusted media controller is required.");
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        Context app = getContext();
        checkCaller(app);
        HeadsetAccount owner = HeadsetAccount.read(app);
        List<String> parts = uri.getPathSegments();
        boolean folder = parts.size() == 3 && "folder".equals(parts.get(1));
        if (!"r".equals(mode) || owner == null || (!folder && parts.size() != 2) || !scope(owner).equals(parts.get(0))
                || !OfflineStore.validTrackId(uri.getLastPathSegment()) || uri.toString().length() > 4096)
            throw new FileNotFoundException("Artwork unavailable.");
        return openPipeHelper(uri, "image/jpeg", null, owner, (out, imageUri, mime, extras, account) -> {
            try (ParcelFileDescriptor.AutoCloseOutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(out)) {
                java.util.function.BooleanSupplier current = () -> account.matches(HeadsetAccount.read(app));
                Bitmap bitmap = cover(app, account, imageUri, folder, HTTP, current);
                if (bitmap != null && current.getAsBoolean()) bitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream);
            } catch (IOException | RuntimeException ignored) { /* Hosts can cancel the pipe while scrolling. */ }
        });
    }

    static Bitmap cover(Context app, HeadsetAccount account, Uri uri, boolean folder, okhttp3.Call.Factory http,
            java.util.function.BooleanSupplier current) {
        if (!current.getAsBoolean()) return null;
        String id = uri.getLastPathSegment(), path = coverPath(uri.getQueryParameter("cover"));
        OfflineStore files = OfflineStore.forUser(app, account.server.toString(), account.userId);
        Bitmap bitmap = path == null ? null : PlaybackArtwork.decode(files.companions().coverBytes(path));
        if (bitmap == null && path != null && !files.offlineOnly() && current.getAsBoolean()) {
            HttpUrl image = account.server.newBuilder().encodedPath(account.server.encodedPath().replaceAll("/+$", "") + path)
                    .addQueryParameter("size", "500").build();
            bitmap = PlaybackArtwork.download(http, new Request.Builder().url(image)
                    .header("Authorization", "Bearer " + account.token).build());
            if (files.offlineOnly()) bitmap = null;
        }
        if (bitmap == null && !folder && current.getAsBoolean())
            bitmap = PlaybackArtwork.embedded(files.artworkSource(files.original(id).toString()));
        return current.getAsBoolean() ? bitmap : null;
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String order) { return null; }
    @Override public Uri insert(Uri u, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
