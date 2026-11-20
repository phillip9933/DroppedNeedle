package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class ManualDownloadsTest {
    private static final String BASE = "https://manual.example/dn";
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final String unique = UUID.randomUUID().toString();
    private final String database = "manual-test-" + unique;
    private final HeadsetAccount first = new HeadsetAccount(HttpUrl.get(BASE), unique, unique);
    private final AtomicReference<HeadsetAccount> login = new AtomicReference<>(first);
    private final AtomicInteger requests = new AtomicInteger();
    private final OfflineStore store = OfflineStore.forUser(context, BASE, first.userId);
    private final FakeScheduler jobs = new FakeScheduler();
    private ManualDownloadQueue queue;
    private ManualDownloads downloads;

    private static final class FakeScheduler implements ManualDownloads.Scheduler {
        boolean pending, refuse;
        @Override public void start(OfflineStore store, boolean replace) throws Exception {
            if (refuse) throw new IOException("Scheduling unavailable");
            pending = true;
        }
        @Override public void cancel(String owner) { pending = false; }
        @Override public boolean pending(String owner) { return pending; }
    }
    @Test public void onlyAndroidFourteenAndLaterExposeTheUserInitiatedTransferService() throws Exception {
        ComponentName service = new ComponentName(context.getPackageName(), "app.droppedneedle.mobile.ManualDownloadJob");
        ServiceInfo info = context.getPackageManager().getServiceInfo(service, PackageManager.MATCH_DISABLED_COMPONENTS);
        assertEquals(Build.VERSION.SDK_INT >= 34, info.enabled);
        assertEquals("android.permission.BIND_JOB_SERVICE", info.permission);
    }
    @Before public void open() throws Exception {
        store.configure(store.options().put("unmeteredOnly", false));
        reopen();
    }
    private void reopen() {
        if (queue != null) queue.close();
        queue = new ManualDownloadQueue(context, database);
        downloads = new ManualDownloads(context, queue, login::get, jobs, () -> true);
    }
    @After public void cleanup() throws Exception {
        JSONArray rows = store.snapshot().getJSONArray("items"), ids = new JSONArray();
        for (int i = 0; i < rows.length(); i++) ids.put(rows.getJSONObject(i).getJSONObject("track").getString("id"));
        store.remove(ids);
        queue.close();
        context.deleteDatabase(database);
        context.deleteSharedPreferences("dn.offline." + store.account);
    }
    private static JSONObject track(String id) throws Exception {
        return new JSONObject().put("id", id).put("title", id).put("rating", 3);
    }
    private void publish(String id, boolean manual) throws Exception {
        byte[] audio = OfflinePlaybackTest.wav();
        try (OfflineStore.Capture sink = store.begin(track(id), manual, audio.length)) {
            assertNotNull(sink);
            sink.write(audio, 0, audio.length);
            sink.finish();
        }
    }
    private static Response wavResponse(Request request, int code, String declaredType) {
        byte[] audio = OfflinePlaybackTest.wav();
        Response.Builder response = new Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(code).message("Fixture response").header("Content-Length", Integer.toString(audio.length))
                .body(ResponseBody.create(MediaType.get("audio/wav"), audio));
        if (declaredType != null) response.header("Content-Type", declaredType);
        return response.build();
    }
    private Call.Factory http(int code) { return http(code, "audio/wav"); }
    private Call.Factory http(int code, String declaredType) {
        return new OkHttpClient.Builder().addInterceptor(chain -> {
            requests.incrementAndGet();
            assertEquals("Bearer " + first.token, chain.request().header("Authorization"));
            assertEquals("identity", chain.request().header("Accept-Encoding"));
            assertEquals("raw", chain.request().url().queryParameter("format"));
            assertTrue(chain.request().url().toString().startsWith(BASE + "/api/v3/stream/local/"));
            return wavResponse(chain.request(), code, declaredType);
        }).build();
    }
    private boolean run(Call.Factory http) {
        return downloads.drain(new ManualDownloads.Run(store.account), http, (done,total) -> {});
    }
    private JSONObject enqueue(String... ids) throws Exception {
        JSONArray rows = new JSONArray();
        for (String id : ids) rows.put(track(id));
        return downloads.enqueue(store, rows);
    }

    @Test public void restoresWholeSelectionPromotesCachedAndReusesFilePublishedBeforeCheckpoint() throws Exception {
        store.configure(store.options().put("autoCache", true));
        publish("cached", false);
        store.configure(store.options().put("offlineOnly", true));
        JSONObject receipt = enqueue("cached", "one", "two", "one");
        assertEquals(1, receipt.getInt("saved"));
        assertEquals(2, receipt.getInt("queued"));
        assertEquals("waitingOffline", receipt.getJSONObject("status").getString("state"));
        assertEquals(1, enqueue("one").getInt("alreadyQueued"));
        assertFalse(run(http(200)));
        assertEquals(0, requests.get());
        store.configure(store.options().put("offlineOnly", false));
        downloads.policyChanged(store);
        publish("one", true); // The process died between the audio commit and its queue checkpoint.
        reopen();
        assertFalse(run(http(200)));
        JSONObject result = downloads.status(store);
        assertEquals("complete", result.getString("state"));
        assertEquals(3, result.getInt("saved"));
        assertEquals(1, requests.get());
        assertEquals(3, store.snapshot().getJSONArray("items").length());
    }

    @Test public void rejectsInvalidOrUnscheduledSelectionWithoutPartialAdmission() throws Exception {
        try { enqueue("okay", "../bad"); fail(); } catch (IllegalArgumentException expected) {}
        assertEquals("idle", downloads.status(store).getString("state"));
        store.configure(store.options().put("autoCache", true));
        publish("cached", false);
        jobs.refuse = true;
        try { enqueue("cached", "one", "two"); fail(); } catch (IOException expected) {}
        assertEquals("cached", store.snapshot().getJSONArray("items").getJSONObject(0).getString("origin"));
        assertNull(queue.next(store.account));
        assertEquals(0, requests.get());

        jobs.refuse = false;
        enqueue("missing-content-type");
        assertFalse(run(http(200, null)));
        JSONObject result = downloads.status(store);
        assertEquals("failed", result.getString("state"));
        assertTrue(result.getString("lastError").contains("without playable audio"));
        assertEquals(1, store.snapshot().getJSONArray("items").length());
    }

    @Test public void cancellationStopsActiveCallAndKeepsEarlierFiles() throws Exception {
        publish("kept", true);
        enqueue("kept", "running", "later");
        CountDownLatch requested = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<Call> request = new AtomicReference<>();
        OkHttpClient waiting = new OkHttpClient.Builder().addInterceptor(chain -> {
            request.set(chain.call());
            requested.countDown();
            try { if (!release.await(8, TimeUnit.SECONDS)) throw new IOException("Timed out"); }
            catch (InterruptedException stopped) { throw new IOException(stopped); }
            return wavResponse(chain.request(), 200, "audio/wav");
        }).build();
        CompletableFuture<Boolean> transfer = CompletableFuture.supplyAsync(() -> run(waiting));
        try {
            assertTrue(requested.await(5, TimeUnit.SECONDS));
            assertEquals("running", downloads.status(store).getJSONObject("current").getString("id"));
            assertEquals("idle", downloads.cancel(store).getString("state"));
            assertTrue(request.get().isCanceled());
        } finally { release.countDown(); }
        assertFalse(transfer.get(5, TimeUnit.SECONDS));
        assertEquals(1, store.snapshot().getJSONArray("items").length());
    }

    @Test public void replacementCredentialCannotResumePreviousLoginEvenForSameUser() throws Exception {
        enqueue("private");
        login.set(new HeadsetAccount(first.server, "replacement-device-session", first.userId));
        reopen();
        assertFalse(run(http(200)));
        assertEquals(0, requests.get());
        assertEquals("idle", downloads.status(store).getString("state"));
        login.set(null);
        try { enqueue("wrong-account"); fail(); } catch (IllegalArgumentException expected) {}
    }

    @Test public void retriesTemporaryFailureAndReportsPermanentFailuresAndSystemStop() throws Exception {
        enqueue("one");
        assertTrue(run(http(503)));
        assertTrue(run(http(503)));
        assertFalse(run(http(503)));
        assertTrue(downloads.status(store).getString("lastError").contains("503"));
        downloads.retry(store);
        assertFalse(run(http(200)));
        assertEquals("complete", downloads.status(store).getString("state"));
        enqueue("private", "later", "a", "b", "c", "d");
        assertFalse(run(http(401)));
        JSONObject denied = downloads.status(store);
        assertEquals(6, denied.getInt("failed"));
        assertEquals(5, denied.getJSONArray("failures").length());
        assertEquals("d", denied.getJSONArray("failures").getJSONObject(0).getString("title"));
        downloads.retry(store);
        jobs.pending = false;
        assertTrue(downloads.status(store).getString("lastError").contains("Android stopped"));
        assertEquals(5, requests.get());
    }
}
