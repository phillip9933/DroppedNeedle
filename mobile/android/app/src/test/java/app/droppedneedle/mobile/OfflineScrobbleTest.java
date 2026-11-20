package app.droppedneedle.mobile;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineScrobbleTest {
    private final HttpUrl endpoint = HttpUrl.get("https://fixture.invalid/dn/api/v3/scrobble/submit");

    @Test public void actualListeningAndFinalPositionBothQualifyAtTheNativeStopThreshold() throws Exception {
        assertFalse(OfflineScrobble.qualifies(200_000, 180_000, 199_999));
        assertFalse(OfflineScrobble.qualifies(200_000, 195_000, 179_000));
        assertTrue(OfflineScrobble.qualifies(200_000, 180_001, 180_001));
        assertFalse(OfflineScrobble.qualifies(800, 1, 800));
        assertTrue(OfflineScrobble.qualifies(800, 600, 790));
        assertFalse(OfflineScrobble.qualifies(0, 90_000, 90_000));
        JSONObject play = OfflineScrobble.play("id/1", "The song", "The artist", "Album", 42_000, 900);
        assertEquals(7, play.length());
        assertEquals("local", play.getString("source"));
        assertEquals("id/1", play.getString("track_id"));
        assertEquals(900, play.getLong("timestamp"));
        assertEquals(42_000, play.getLong("duration_ms"));
    }

    @Test public void onlyProvenRejectionsCanBeRetriedAfterTheFirstRequestByte() throws Exception {
        JSONObject play = OfflineScrobble.play("id/1", "Song", "Artist", "", 42_000, 900);
        AtomicBoolean allowed = new AtomicBoolean(true);
        AtomicInteger calls = new AtomicInteger();
        String[] mode = {"offline"};
        OkHttpClient http = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls.incrementAndGet();
            assertEquals(endpoint, chain.request().url());
            assertEquals("Bearer fresh-session", chain.request().header("Authorization"));
            assertTrue(chain.request().body().isOneShot());
            if (mode[0].equals("offline")) throw new IOException("No connection made");
            if (mode[0].equals("switch")) allowed.set(false);
            Buffer wire = new Buffer();
            chain.request().body().writeTo(wire);
            assertEquals(play.toString(), wire.readUtf8());
            if (mode[0].equals("lost")) throw new IOException("Lost response after writing");
            boolean denied = mode[0].equals("expired");
            String body = denied ? "{\"error\":{\"code\":\"UNAUTHORIZED\"}}"
                    : mode[0].equals("unsupported") ? "<html>Not DN</html>"
                    : "{\"services\":{},\"accepted\":" + mode[0].equals("ok") + "}";
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(denied ? 401 : 200).message("fixture").body(ResponseBody.create(
                            MediaType.get(mode[0].equals("unsupported") ? "text/html" : "application/json"), body)).build();
        }).build();
        for (String outcome : new String[]{"offline", "retry", "expired", "lost", "unsupported", "ok", "switch"}) {
            mode[0] = outcome;
            assertEquals(outcome, java.util.Arrays.asList("offline", "retry", "expired", "switch").contains(outcome),
                    OfflineScrobble.retryRequired(http, endpoint, "fresh-session", play.toString(), allowed::get));
        }
        assertEquals(7, calls.get());
    }
}
