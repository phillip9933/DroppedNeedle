package app.droppedneedle.mobile;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class LibraryWindowTest {
    private static final HttpUrl BASE = HttpUrl.get("https://listener.example/dn");
    private static final String API = "/dn/api/v3/", TOKEN = "fixture-session";
    private static final int TOTAL = 76_003;

    private static String after(int n) {
        return "catalog +/77&seed=" + n;
    }
    private static String id(int n) {
        return "track-" + ((long) n * 7919 % TOTAL);
    }
    private static JSONObject track(int n) throws JSONException {
        return new JSONObject()
                .put("id", id(n))
                .put("title", "Song " + n)
                .put("artist_name", "Performer")
                .put("album_title", "Record")
                .put("duration_seconds", 42)
                .put("cover_available", true)
                .put("album_id", "album id")
                .put("artworkUrl", "https://elsewhere.example");
    }

    private static JSONObject state(int loaded, int total) throws JSONException {
        return new JSONObject()
                .put("filters", new JSONObject().put("sort", "random").put("order", "asc").put("genre", "R&B"))
                .put("after", loaded == total ? JSONObject.NULL : after(loaded))
                .put("loaded", loaded)
                .put("total", total);
    }

    private static final class Fixture implements LibraryQueuePager.Host, LibraryQueuePager.Dispatch, AutoCloseable {
        final BlockingQueue<Runnable> ready = new LinkedBlockingQueue<>();
        final BlockingQueue<Request> requests = new LinkedBlockingQueue<>();
        final List<JSONObject> tracks = new ArrayList<>();
        int index;
        volatile boolean fail, change, deterministicError;
        boolean active, offline, resumed, restarted;
        Runnable retry;
        final OkHttpClient http =
                new OkHttpClient.Builder()
                        .addInterceptor(chain -> {
                            Request request = chain.request();
                            requests.add(request);
                            String cursor = request.url().queryParameter("after");
                            int start = cursor == null
                                    ? 0
                                    : Integer.parseInt(cursor.substring(cursor.lastIndexOf('=') + 1));
                            try {
                                JSONArray rows = new JSONArray();
                                int stop = Math.min(TOTAL, start + LibraryWindow.PAGE);
                                for (int i = start; i < stop; i++) rows.put(track(i));
                                JSONObject page = new JSONObject()
                                                          .put("total", change ? TOTAL + 1 : TOTAL)
                                                          .put("items", rows)
                                                          .put("next",
                                                                  deterministicError     ? cursor
                                                                          : stop < TOTAL ? after(stop)
                                                                                         : JSONObject.NULL);
                                return new Response.Builder()
                                        .request(request)
                                        .protocol(Protocol.HTTP_1_1)
                                        .code(fail ? 503 : 200)
                                        .message("fixture")
                                        .body(ResponseBody.create(MediaType.get("application/json"), page.toString()))
                                        .build();
                            } catch (JSONException error) {
                                throw new AssertionError(error);
                            }
                        })
                        .build();
        final LibraryQueuePager pager = new LibraryQueuePager(this, this, http);

        void attach(int absolute, int retained) throws Exception {
            tracks.clear();
            for (int i = absolute - retained; i < absolute; i++) tracks.add(track(i));
            index = retained - 1;
            pager.attach(LibraryWindow.parse(state(absolute, TOTAL), retained), BASE, API, TOKEN);
        }
        void flush() throws Exception {
            Runnable task = ready.poll(4, TimeUnit.SECONDS);
            assertNotNull("OkHttp response queued on the player thread", task);
            task.run();
        }
        Request request() throws Exception {
            Request request = requests.poll(4, TimeUnit.SECONDS);
            assertNotNull(request);
            assertEquals("Bearer " + TOKEN, request.header("Authorization"));
            assertFalse(request.url().toString().contains(TOKEN));
            assertEquals(API + "library/tracks", request.url().encodedPath());
            assertEquals(BASE.host(), request.url().host());
            assertEquals("100", request.url().queryParameter("limit"));
            assertEquals("random", request.url().queryParameter("sort"));
            assertEquals("asc", request.url().queryParameter("order"));
            assertEquals("R&B", request.url().queryParameter("genre"));
            return request;
        }
        public JSONArray tracks() {
            return new JSONArray(tracks);
        }
        public int index() {
            return index;
        }
        public int count() {
            return tracks.size();
        }
        public boolean offlineOnly() {
            return offline;
        }
        public boolean active() {
            return active;
        }
        public void apply(LibraryWindow.Batch batch, boolean restart, boolean resume) throws JSONException {
            int trim = restart ? count() : Math.max(0, index - LibraryWindow.HISTORY);
            tracks.subList(0, trim).clear();
            index = restart ? 0 : index - trim;
            if (resume)
                index = count();
            for (int i = 0; i < batch.tracks.length(); i++) tracks.add(batch.tracks.getJSONObject(i));
            restarted = restart;
            resumed = resume;
        }
        public void post(Runnable task) {
            ready.add(task);
        }
        public void later(Runnable task, long ms) {
            retry = task;
        }
        public void cancel(Runnable task) {
            if (retry == task)
                retry = null;
        }
        public void close() {
            pager.detach();
            http.dispatcher().executorService().shutdownNow();
            http.connectionPool().evictAll();
        }
    }

    @Test
    public void randomCursorSurvivesPausedRestorationAndRepeatStartsAtTheOrigin() throws Exception {
        try (Fixture f = new Fixture()) {
            f.attach(200, 200);
            f.index = 0;
            f.active = true;
            f.pager.load(false);
            assertTrue(f.requests.isEmpty());
            f.index = 174;
            f.pager.load(false);
            assertEquals(after(200), f.request().url().queryParameter("after"));
            f.flush();
            assertEquals(50, f.index);
            assertEquals(176, f.count());
            assertEquals(124, f.pager.status(f.count()).getInt("offset"));
            JSONObject last = f.tracks.get(f.count() - 1);
            assertEquals(id(299), last.getString("id"));
            assertEquals(42, last.getInt("duration"));
            assertEquals(BASE + "/api/v3/stream/local/" + id(299), last.getString("streamUrl"));
            assertEquals(BASE + "/api/v3/library/albums/album%20id/artwork?size=500", last.getString("artworkUrl"));
            LibraryWindow restored = LibraryWindow.parse(new JSONObject(f.pager.saved().toString()), f.count());
            f.pager.attach(restored, BASE, API, TOKEN);
            f.active = false;
            f.index = f.count() - 1;
            f.pager.load(false);
            assertTrue(f.requests.isEmpty());
            f.active = true;
            f.pager.load(false);
            assertEquals(after(300), f.request().url().queryParameter("after"));
            f.flush();
            assertEquals(151, f.count());
            f.attach(TOTAL - 3, 100);
            f.pager.end(false);
            assertEquals(after(TOTAL - 3), f.request().url().queryParameter("after"));
            f.flush();
            assertFalse(f.pager.hasNext());
            assertTrue(f.resumed);
            assertEquals(id(TOTAL - 3), f.tracks.get(f.index).getString("id"));
            f.index = f.count() - 1;
            f.pager.end(false);
            assertNull(f.request().url().queryParameter("after"));
            f.flush();
            assertTrue(f.restarted);
            assertEquals(id(0), f.tracks.get(f.index).getString("id"));
            assertEquals(0, f.pager.status(f.count()).getInt("offset"));
        }
    }

    @Test
    public void failuresRetryAtMostOnceAndLateResponsesCannotReplaceManualPlayback() throws Exception {
        try (Fixture f = new Fixture()) {
            f.attach(200, 200);
            f.active = true;
            f.fail = true;
            f.pager.end(false);
            f.request();
            f.flush();
            assertEquals(200, f.count());
            assertNotNull(f.retry);
            f.retry.run();
            f.request();
            f.flush();
            assertNull(f.retry);
            assertTrue(f.pager.status(f.count()).has("problem"));
            f.fail = false;
            f.pager.load(true);
            f.request();
            f.pager.cancelAdvance();
            f.flush();
            assertFalse(f.resumed);
            assertFalse(f.pager.status(f.count()).has("problem"));
            f.index = f.count() - 1;
            f.pager.load(false);
            f.request();
            f.pager.detach();
            f.tracks.add(f.tracks.get(0)); // The listener enqueued the same song twice.
            int edited = f.count();
            f.flush();
            assertEquals(edited, f.count());
            assertSame(f.tracks.get(0), f.tracks.get(edited - 1));
            assertNull(f.pager.status(f.count()));
        }
    }

    @Test
    public void offlineAndChangedCatalogKeepTheCurrentWindowAndRejectForeignQueries() throws Exception {
        try (Fixture f = new Fixture()) {
            f.attach(40_000, 90);
            f.offline = true;
            f.pager.end(false);
            assertTrue(f.requests.isEmpty());
            assertTrue(f.pager.status(f.count()).has("problem"));
            f.offline = false;
            f.change = true;
            f.pager.load(true);
            assertEquals(after(40_000), f.request().url().queryParameter("after"));
            f.flush();
            assertEquals(90, f.count());
            assertEquals(LibraryWindow.CHANGED, f.pager.status(f.count()).getString("problem"));
            assertNull(f.retry);
            f.change = false;
            f.deterministicError = true;
            f.pager.load(true);
            f.request();
            f.flush();
            assertEquals(90, f.count());
            JSONObject foreign = state(200, TOTAL);
            foreign.getJSONObject("filters").put("url", "https://elsewhere.example");
            assertThrows(JSONException.class, () -> LibraryWindow.parse(foreign, 200));
            assertThrows(JSONException.class,
                    () -> LibraryWindow.parse(state(200, TOTAL).put("after", JSONObject.NULL), 200));
        }
    }
}
