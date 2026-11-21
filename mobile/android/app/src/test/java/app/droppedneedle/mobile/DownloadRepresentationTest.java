package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import java.io.IOException;
import okhttp3.*;
import org.junit.Test;

public final class DownloadRepresentationTest {
    private final HttpUrl song = HttpUrl.get("https://dn.example/prefix/api/v3/stream/local/song");
    private Response response(Request req, int status, String mime, byte[] audio) {
        return new Response.Builder()
                .request(req)
                .protocol(Protocol.HTTP_1_1)
                .code(status)
                .message("fixture")
                .header("Content-Type", mime)
                .body(ResponseBody.create(MediaType.get(mime), audio))
                .build();
    }
    @Test
    public void originalIsExplicitAndHasNoPlaybackProfileOrRange() throws Exception {
        try (Response r = DownloadRepresentation.open(song, "token", "original", 192, request -> {
            assertEquals("format=raw", request.url().encodedQuery());
            assertEquals("Bearer token", request.header("Authorization"));
            assertEquals("identity", request.header("Accept-Encoding"));
            assertNull(request.header("Range"));
            return response(request, 200, "audio/flac", new byte[] {1, 2, 3});
        })) {
            assertEquals("audio/flac", DownloadRepresentation.mime(r));
        }
    }
    @Test
    public void olderServersCanReturnTheOriginalOrRefuseConversion() throws Exception {
        List<String> formats = new ArrayList<>();
        try (Response r = DownloadRepresentation.open(song, "token", "opus", 96, request -> {
            String format = request.url().queryParameter("format");
            formats.add(format);
            if (format.equals("raw"))
                return response(request, 200, "audio/flac", new byte[] {3});
            assertEquals("96", request.url().queryParameter("max_bitrate"));
            return response(request, 409, "application/json", new byte[0]);
        })) {
            assertEquals(java.util.Arrays.asList("opus", "raw"), formats);
            assertEquals("audio/flac", DownloadRepresentation.mime(r));
        }
        try (Response r = DownloadRepresentation.open(
                     song, "token", "mp3", 128, q -> response(q, 200, "audio/flac; charset=binary", new byte[] {9}))) {
            assertEquals("audio/flac", DownloadRepresentation.mime(r));
        }
    }
    @Test
    public void forbiddenResponsesAreNeverRetriedAndPartialResponsesCannotBeSaved() throws Exception {
        List<Request> calls = new ArrayList<>();
        try (Response r = DownloadRepresentation.open(song, "token", "mp3", 128, q -> {
            calls.add(q);
            return response(q, 403, "text/html", new byte[] {5});
        })) {
            assertEquals(1, calls.size());
            assertNull(DownloadRepresentation.mime(r));
        }
        try (Response r = response(new Request.Builder().url(song).build(), 200, "audio/mpeg", new byte[] {5})
                        .newBuilder()
                        .header("Content-Range", "bytes 10-11/100")
                        .build()) {
            assertNull(DownloadRepresentation.mime(r));
        }
    }
    @Test
    public void recognizableBytesDetermineStoredTypeAndProxyPagesCannotBecomeAudio() throws Exception {
        java.nio.file.Path file = java.nio.file.Files.createTempFile("dn-download", ".audio");
        try {
            java.nio.file.Files.write(file, "fLaCexample".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            assertEquals("audio/flac", DownloadRepresentation.storedType(file.toFile(), "audio/mpeg"));
            java.nio.file.Files.write(file, " <!DOCTYPE html><html>Sign in".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            assertThrows(IOException.class,
                    () -> DownloadRepresentation.storedType(file.toFile(), "application/octet-stream"));
        } finally {
            java.nio.file.Files.delete(file);
        }
    }
}
