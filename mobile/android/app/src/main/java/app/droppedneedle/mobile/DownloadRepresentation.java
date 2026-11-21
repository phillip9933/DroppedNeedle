package app.droppedneedle.mobile;

import androidx.annotation.Nullable;
import java.io.IOException;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;

/** Fetch one complete representation. Offline playback uses byte ranges on the completed local file. */
final class DownloadRepresentation {
    interface Fetch {
        Response execute(Request request) throws IOException;
    }

    static Response open(HttpUrl song, String token, String format, int rate, Fetch fetch) throws IOException {
        boolean raw = "original".equals(format);
        HttpUrl.Builder url = song.newBuilder().query(null).addQueryParameter("format", raw ? "raw" : format);
        if (!raw)
            url.addQueryParameter("max_bitrate", Integer.toString(rate));
        Request request = new Request.Builder()
                                  .url(url.build())
                                  .header("Authorization", "Bearer " + token)
                                  .header("Accept-Encoding", "identity")
                                  .build();
        Response response = fetch.execute(request);
        // DN refuses unavailable conversions with 409. Earlier builds can serve original bytes directly.
        if (raw || response.code() != 409)
            return response;
        response.close();
        return fetch.execute(request.newBuilder()
                        .url(song.newBuilder().query(null).addQueryParameter("format", "raw").build())
                        .build());
    }

    static String storedType(File file, String reported) throws IOException {
        String detected = CastRelay.audioType(file);
        if (!"application/octet-stream".equals(detected))
            return detected;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] header = new byte[128];
            int count = input.read(header);
            if (count > 0) {
                String start = new String(header, 0, count, StandardCharsets.US_ASCII).trim().toLowerCase(Locale.ROOT);
                if (start.startsWith("<!doctype html") || start.startsWith("<html") || start.startsWith("<?xml"))
                    throw new IOException("DN returned a sign-in or error page instead of an audio file.");
            }
        }
        return reported;
    }
    @Nullable
    static String mime(Response response) {
        if (response.code() != 200 || response.body() == null || response.header("Content-Range") != null)
            return null;
        String type = response.header("Content-Type");
        return OfflineStore.isAudio(type) ? type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT) : null;
    }
}
