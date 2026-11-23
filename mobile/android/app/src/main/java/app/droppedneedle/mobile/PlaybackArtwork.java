package app.droppedneedle.mobile;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.util.BitmapLoader;
import androidx.media3.common.util.Util;
import androidx.media3.datasource.BitmapUtil;
import androidx.media3.datasource.DataSourceBitmapLoader;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.ListeningExecutorService;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.function.Supplier;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

/** Resolves artwork requested by Media3 for the current notification and platform session. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlaybackArtwork implements BitmapLoader {
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private final Supplier<PlaybackService.Access> current;
    private final Call.Factory http;
    // Media3's single bitmap worker serializes the two system consumers of the same cover.
    private final ListeningExecutorService worker = DataSourceBitmapLoader.DEFAULT_EXECUTOR_SERVICE.get();
    private record Source(Uri item, File file, byte[] inline, HttpUrl remote) {}
    private Source lastSource;
    private Bitmap lastCover;

    PlaybackArtwork(Supplier<PlaybackService.Access> current, Call.Factory http) {
        this.current = current;
        this.http = http;
    }

    @Override public boolean supportsMimeType(String type) { return Util.isBitmapFactorySupportedMimeType(type); }

    @Override public ListenableFuture<Bitmap> decodeBitmap(byte[] data) {
        PlaybackService.Access owner = current.get();
        return worker.submit(() -> {
            Bitmap cover = owner == null ? null : decode(data);
            return current.get() == owner ? cover : null;
        });
    }

    @Override public ListenableFuture<Bitmap> loadBitmap(Uri uri) { return load(uri, null); }

    @Nullable @Override public ListenableFuture<Bitmap> loadBitmapFromMetadata(MediaMetadata metadata) {
        byte[] inline = metadata.artworkData;
        return metadata.artworkUri == null ? null : load(metadata.artworkUri,
                inline != null && inline.length <= MAX_BYTES ? inline : null);
    }

    private ListenableFuture<Bitmap> load(Uri uri, @Nullable byte[] inline) {
        PlaybackService.Access owner = current.get();
        String id = uri.getLastPathSegment();
        if (owner == null || id == null || !"content".equals(uri.getScheme())
                || !owner.artworkAuthority.equals(uri.getAuthority()) || uri.getPathSegments().size() != 2
                || !owner.artworkScope.equals(uri.getPathSegments().get(0)))
            return Futures.immediateFuture(null);
        return worker.submit(() -> {
            JSONObject track = owner.metadata(id);
            if (current.get() != owner || track == null) return null;
            File file = owner.offline == null ? null : owner.offline.artworkSource(track.optString("streamUrl"));
            HttpUrl remote = HttpUrl.parse(track.optString("artworkUrl"));
            if (!owner.allowsOnlineMedia() || !owner.permits(remote, "")) remote = null;
            Source source = new Source(uri, file, inline, remote);
            if (lastCover != null && source.equals(lastSource)) return current.get() == owner ? lastCover : null;

            String path = CarArtworkProvider.relative(owner.base, track.optString("artworkUrl"));
            Bitmap cover = owner.offline == null || path == null ? null : decode(owner.offline.companions().coverBytes(path));
            if (cover == null && remote != null) {
                if (current.get() != owner || !owner.allowsOnlineMedia()) return null;
                cover = download(http, new Request.Builder().url(remote).tag(PlaybackService.Access.class, owner)
                        .header("Authorization", "Bearer " + owner.token).build());
                if (!owner.allowsOnlineMedia()) cover = null;
            }
            if (cover == null) cover = decode(inline);
            if (cover == null) cover = embedded(file);
            if (current.get() != owner) return null;
            lastSource = source;
            lastCover = cover;
            return cover;
        });
    }

    @Nullable static Bitmap embedded(@Nullable File file) {
        if (file == null) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            MediaMetadataRetriever reader = new MediaMetadataRetriever();
            try {
                reader.setDataSource(input.getFD(), 0, Math.min(file.length(), MAX_BYTES));
                return decode(reader.getEmbeddedPicture());
            } finally {
                reader.release();
            }
        } catch (IOException | RuntimeException unavailable) {
            return null;
        }
    }

    @Nullable static Bitmap download(Call.Factory http, Request request) {
        try (Response response = http.newCall(request).execute()) {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null || body.contentLength() > MAX_BYTES
                    || body.source().request(MAX_BYTES + 1L)) return null;
            return decode(body.source().readByteArray());
        } catch (IOException unavailable) {
            return null;
        }
    }

    @Nullable static Bitmap decode(@Nullable byte[] bytes) {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES) return null;
        try {
            return BitmapUtil.decode(bytes, bytes.length, null, 512);
        } catch (IOException | RuntimeException damaged) {
            return null;
        }
    }
}
