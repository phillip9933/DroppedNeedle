package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Timeout;
import org.json.JSONObject;
import org.junit.Test;

public class PlaybackLoudnessTest {
    private final PlaybackLoudness levels = new PlaybackLoudness();
    private final ArrayDeque<Runnable> completions = new ArrayDeque<>();
    private final AtomicInteger updates = new AtomicInteger();
    private final HttpUrl server = HttpUrl.get("https://example.test/music/");
    private static final String TRACK = "{\"track_gain_db\":-6.0206,\"track_peak\":0.9}";

    private static class Delayed implements Call {
        final Request request;
        Callback callback;
        boolean canceled;
        Delayed(Request request) { this.request = request; }
        public void enqueue(Callback done) { callback = done; }
        public void cancel() { canceled = true; }
        public Request request() { return request; }
        public Timeout timeout() { return new Timeout(); }
        public boolean isCanceled() { return canceled; }
        public boolean isExecuted() { return callback != null; }
        public Response execute() { throw new AssertionError("Must not block audio"); }
        public Call clone() { throw new AssertionError(); }
        void finish(int code, String body) throws IOException {
            callback.onResponse(this, new Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                    .code(code).message("fixture").body(ResponseBody.create(null, body)).build());
        }
    }
    private Delayed select(String id) {
        Delayed call = new Delayed(PlaybackLoudness.request(server, id, "test-token"));
        levels.select(id, () -> call, completions::add, updates::incrementAndGet);
        return call;
    }

    @Test public void upstreamValuesWinFieldByFieldAndRespectOldPeakFallbacks() throws Exception {
        Delayed call = select("a #1");
        assertEquals("https://example.test/music/api/v3/library/tracks/a%20%231/loudness", call.request.url().toString());
        assertEquals("Bearer test-token", call.request.header("Authorization"));
        call.finish(200, "{\"track_gain_db\":0,\"album_gain_db\":6.0206,\"album_peak\":null,\"track_peak\":\"bad\"}");
        completions.remove().run();
        JSONObject fresh = levels.get("a #1");
        JSONObject legacy = new JSONObject().put("replayGainTrackDb", -6.0206).put("replayGainAlbumPeak", 0.8);
        assertEquals(1, PlaybackSound.factor("track", fresh, legacy, null), 0.0001);
        assertEquals(1.25, PlaybackSound.factor("album", fresh, legacy, null), 0.0001);
        assertFalse(select("a #1").isExecuted());
        select("another");
        assertFalse(select("a #1").isExecuted());
        assertEquals(1, updates.get());
    }

    @Test public void aLateReplyCannotChangeAnotherSongOrSession() throws Exception {
        Delayed first = select("one");
        first.finish(200, TRACK);
        Delayed second = select("two");
        completions.remove().run();
        assertTrue(first.isCanceled());
        assertNull(levels.get("one"));
        second.finish(200, TRACK);
        levels.reset();
        select("two");
        completions.remove().run();
        assertNull(levels.get("two"));
        assertEquals(0, updates.get());
    }

    @Test public void oldServersEmptyFieldsAndOfflineCancellationKeepFallbackUsable() throws Exception {
        for (String body : new String[]{"", "{\"track_gain_db\":null}", "<html/>", " ".repeat(4200) + TRACK}) {
            Delayed call = select("song");
            call.finish(body.isEmpty() ? 404 : 200, body);
            completions.remove().run();
            assertNull(levels.get("song"));
            assertFalse(select("song").isExecuted());
            levels.reset();
        }
        Delayed call = select("song");
        levels.select(null, () -> { throw new AssertionError(); }, completions::add, updates::incrementAndGet);
        call.finish(200, TRACK);
        completions.remove().run();
        assertTrue(call.isCanceled());
        assertNull(levels.get("song"));
        assertEquals(0, updates.get());
    }
}
