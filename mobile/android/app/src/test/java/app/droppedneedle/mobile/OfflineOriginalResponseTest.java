package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import java.io.IOException;
import okhttp3.MediaType;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;

public final class OfflineOriginalResponseTest {
    private Response original(int status, String mime) {
        return new Response.Builder().request(new Request.Builder()
                .url("https://fixture.invalid/api/v3/stream/local/song?format=raw").build())
                .protocol(Protocol.HTTP_1_1).code(status).message("fixture")
                .header("Content-Type", mime).body(ResponseBody.create(MediaType.get(mime), "test")).build();
    }

    @Test public void onlyMissingAutomaticOriginalsHaveTheTrackSpecificBridgeCode() throws Exception {
        assertEquals("DN_AUDIO_NOT_FOUND", DNOfflinePlugin.MissingOriginal.CODE);
        for (int status : new int[] {404, 410}) {
            try (Response response = original(status, "application/json")) {
                assertThrows(DNOfflinePlugin.MissingOriginal.class, () -> DNOfflinePlugin.originalAudio(response, "playlist:cA"));
                for (String source : new String[] {null, "recent", "favorites"}) {
                    IOException failure = assertThrows(IOException.class, () -> DNOfflinePlugin.originalAudio(response, source));
                    assertFalse(failure instanceof DNOfflinePlugin.MissingOriginal);
                }
            }
        }
        for (int status : new int[] {200, 302, 401, 403, 429, 503}) {
            try (Response response = original(status, "text/html")) {
                IOException failure = assertThrows(IOException.class, () -> DNOfflinePlugin.originalAudio(response, "playlist:cA"));
                assertFalse(failure instanceof DNOfflinePlugin.MissingOriginal);
            }
        }
        try (Response response = original(200, "audio/flac")) {
            assertSame(response.body(), DNOfflinePlugin.originalAudio(response, "playlist:cA"));
        }
    }
}
