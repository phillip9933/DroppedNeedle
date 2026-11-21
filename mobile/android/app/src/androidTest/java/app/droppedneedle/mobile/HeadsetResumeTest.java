package app.droppedneedle.mobile;

import android.app.ActivityManager;
import android.app.Instrumentation;
import android.os.SystemClock;
import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.view.KeyEvent;
import androidx.media3.common.Player;
import androidx.media3.common.MediaItem;
import androidx.media3.session.MediaBrowser;
import androidx.media3.session.LibraryResult;
import com.google.common.util.concurrent.ListenableFuture;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.aparajita.capacitor.securestorage.SecureStorage;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.crypto.SecretKey;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

@RunWith(AndroidJUnit4.class)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class HeadsetResumeTest {
    private static final String SERVER = "https://127.0.0.1:1/headset", USER = "fixture-user", TOKEN = "fixture-token";
    private final Instrumentation instrument = InstrumentationRegistry.getInstrumentation();
    private final Context context = instrument.getTargetContext();
    private final SavedQueue archive = new SavedQueue(context);
    private final SecretKey key = SavedQueue.key(SERVER, TOKEN);
    private final SecureStorage signedIn = new SecureStorage() {
        @Override public Context getContext() { return context; }
    };
    private boolean fixture;
    private OfflineStore local;
    private JSONObject previous;
    private boolean previouslyRecording;

    private PluginCall call(JSObject values, CompletableFuture<JSObject> answer) {
        values.put("prefixedKey", HeadsetAccount.SESSION_KEY);
        return new PluginCall(null, "SecureStorage", "-1", "fixture", values) {
            @Override public void resolve(JSObject data) { answer.complete(data); }
            @Override public void resolve() { answer.complete(new JSObject()); }
            @Override public void reject(String message, String code, Exception cause, JSObject details) {
                answer.completeExceptionally(new IllegalStateException("Fixture secure storage failed."));
            }
        };
    }
    private void login(String address, String token, String user) throws Exception {
        JSONObject session = new JSONObject().put("serverUrl", address).put("token", token).put("displayName", "Fixture");
        if (user != null) session.put("userId", user);
        JSObject args = new JSObject();
        // SecureStorage.set(key, JSON.stringify(session)) uses JSON encoding for its string argument.
        args.put("data", JSONObject.quote(session.toString()));
        CompletableFuture<JSObject> answer = new CompletableFuture<>();
        signedIn.internalSetItem(call(args, answer));
        answer.get(5, TimeUnit.SECONDS);
    }
    private void logout() throws Exception {
        CompletableFuture<JSObject> answer = new CompletableFuture<>();
        signedIn.internalRemoveItem(call(new JSObject(), answer));
        answer.get(5, TimeUnit.SECONDS);
    }
    private JSONObject track(String id) throws Exception {
        return new JSONObject().put("id", id).put("title", "Tone " + id).put("artist", "Fixture")
                .put("album", "Silence").put("duration", 8).put("streamUrl", SERVER + "/api/v3/stream/local/" + id);
    }
    private void savedQueue(boolean stamped) throws Exception {
        JSONObject saved = new JSONObject().put("revision", "original").put("tracks", new JSONArray().put(track("one")).put(track("two")))
                .put("index", 0).put("position", 0).put("repeat", Player.REPEAT_MODE_ONE);
        if (stamped) saved.put("userId", USER);
        archive.write(key, saved, true);
        archive.write(key, new JSONObject().put("revision", "original").put("index", 1)
                .put("position", 1600).put("repeat", Player.REPEAT_MODE_ONE), false);
        written();
    }
    private void written() throws Exception {
        CompletableFuture<Boolean> done = new CompletableFuture<>();
        archive.afterWrite(() -> done.complete(true));
        assertTrue(done.get(5, TimeUnit.SECONDS));
    }
    private JSONObject requestStoredQueue() throws Exception {
        CompletableFuture<JSONObject> result = new CompletableFuture<>();
        archive.forHeadset(context, (owner, record) -> result.complete(record));
        return result.get(5, TimeUnit.SECONDS);
    }
    @Before public void isolate() throws Exception {
        // Never replace an installed listener's secure login or their playback checkpoint.
        assumeTrue(context.getPackageName().endsWith(".devicetest") || context.getPackageName().endsWith(".headsettest"));
        assumeTrue(HeadsetAccount.unlocked(context));
        CompletableFuture<JSObject> prior = new CompletableFuture<>();
        signedIn.internalGetItem(call(new JSObject(), prior));
        assumeTrue(prior.get(5, TimeUnit.SECONDS).isNull("data") && !SavedQueue.exists(context));
        fixture = true;
        local = OfflineStore.forUser(context, SERVER, USER);
        previous = local.options();
        previouslyRecording = local.recordsHistory();
        local.configure(new JSONObject(previous.toString()).put("offlineOnly", true));
        local.recordHistory(false);
    }
    @After public void cleanup() throws Exception {
        if (!fixture) return;
        logout();
        context.stopService(new Intent(context, PlaybackService.class));
        archive.clear();
        written();
        local.remove(new JSONArray().put("two"));
        local.recordHistory(previouslyRecording);
        local.configure(previous);
    }
    private void retainTone() throws Exception {
        int bytes = 8 * 8000 * 2;
        ByteBuffer audio = ByteBuffer.allocate(bytes + 44).order(ByteOrder.LITTLE_ENDIAN);
        audio.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(bytes + 36);
        audio.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1)
                .putShort((short) 1).putInt(8000).putInt(16000).putShort((short) 2).putShort((short) 16);
        audio.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes);
        try (OfflineStore.Capture file = local.begin(track("two"), true, audio.capacity())) {
            file.write(audio.array(), 0, audio.capacity());
            file.finish();
        }
    }
    @Test public void coldControllerPlayUsesTheSavedAccountSelectionAndLatestPositionWithoutAWebView() throws Exception {
        login(SERVER, TOKEN, USER);
        savedQueue(true);
        retainTone();
        ComponentName entry = new ComponentName(context, HeadsetPlayReceiver.class);
        ActivityInfo receiver = context.getPackageManager().getReceiverInfo(entry, 0);
        assertTrue(receiver.exported);
        assertFalse("Android must not expose headset resume before first unlock", receiver.directBootAware);
        Context afterFirstUnlock = new ContextWrapper(context) {
            @Override public Object getSystemService(String name) {
                if (Context.KEYGUARD_SERVICE.equals(name)) throw new AssertionError("A relocked screen must permit headset Play");
                return super.getSystemService(name);
            }
        };
        assertTrue(HeadsetAccount.unlocked(afterFirstUnlock));
        assertEquals("android.permission.MEDIA_CONTENT_CONTROL", receiver.permission);
        HeadsetPlayReceiver hardware = new HeadsetPlayReceiver();
        assertTrue(hardware.shouldStartForegroundService(context, button(KeyEvent.KEYCODE_MEDIA_PLAY)));
        assertFalse(hardware.shouldStartForegroundService(context, button(KeyEvent.KEYCODE_MEDIA_PAUSE)));
        assertFalse(hardware.shouldStartForegroundService(context, button(KeyEvent.KEYCODE_MEDIA_NEXT)));
        SessionToken service = new SessionToken(context, new ComponentName(context, PlaybackService.class));
        MediaController controller = new MediaController.Builder(context, service).buildAsync().get(8, TimeUnit.SECONDS);
        CompletableFuture<Long> audible = new CompletableFuture<>();
        try {
            instrument.runOnMainSync(() -> {
                assertNull(controller.getCurrentMediaItem());
                controller.addListener(new Player.Listener() {
                    @Override public void onEvents(Player player, Player.Events events) {
                        if (!player.isPlaying()) return;
                        if (player.getCurrentMediaItemIndex() == 1 && player.getCurrentMediaItem() != null
                                && "two".equals(player.getCurrentMediaItem().mediaId)
                                && player.getRepeatMode() == Player.REPEAT_MODE_ONE)
                            audible.complete(player.getCurrentPosition());
                    }
                });
                controller.play();
            });
            assertTrue("Resumes at the saved cursor", audible.get(10, TimeUnit.SECONDS) >= 1550);
            // A controller can report audible playback before Media3 posts its foreground notification.
            awaitForegroundPlayback();
        } finally { instrument.runOnMainSync(() -> { controller.pause(); controller.release(); }); }
    }
    @SuppressWarnings("deprecation") // Android still exposes a caller's own running services.
    private void awaitForegroundPlayback() {
        ActivityManager manager = context.getSystemService(ActivityManager.class);
        ComponentName expected = new ComponentName(context, PlaybackService.class);
        long deadline = SystemClock.elapsedRealtime() + 5000;
        do {
            for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
                if (expected.equals(service.service) && service.foreground) return;
            }
            SystemClock.sleep(25);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail("The resumed media service must reach the foreground before test teardown");
    }
    private Intent button(int code) {
        return new Intent(Intent.ACTION_MEDIA_BUTTON)
                .putExtra(Intent.EXTRA_KEY_EVENT, new KeyEvent(KeyEvent.ACTION_DOWN, code));
    }
    private <T> T browserCall(java.util.function.Supplier<ListenableFuture<T>> send) throws Exception {
        CompletableFuture<ListenableFuture<T>> pending = new CompletableFuture<>();
        instrument.runOnMainSync(() -> pending.complete(send.get()));
        return pending.get(3, TimeUnit.SECONDS).get(8, TimeUnit.SECONDS);
    }
    @Test public void carBrowserUsesOfflineSearchAndVoicePlaybackAndTheWidgetPausesIt() throws Exception {
        login(SERVER, TOKEN, USER);
        retainTone();
        SessionToken token = new SessionToken(context, new ComponentName(context, PlaybackService.class));
        MediaBrowser browser = browserCall(() -> new MediaBrowser.Builder(context, token).buildAsync());
        try {
            MediaItem root = browserCall(() -> browser.getLibraryRoot(null)).value;
            assertNotNull(root);
            assertEquals(CarLibrary.ROOT, root.mediaId);
            MediaItem device = browserCall(() -> browser.getChildren(root.mediaId, 0, 10, null)).value.get(0);
            assertEquals("On this device", device.mediaMetadata.title);
            assertEquals("Tone two", browserCall(() -> browser.getChildren(device.mediaId, 0, 10, null)).value.get(0).mediaMetadata.title);
            assertEquals(LibraryResult.RESULT_SUCCESS, browserCall(() -> browser.search("Tone", null)).resultCode);
            assertEquals("Tone two", browserCall(() -> browser.getSearchResult("Tone", 0, 20, null)).value.get(0).mediaMetadata.title);
            CompletableFuture<Boolean> started = new CompletableFuture<>(), stopped = new CompletableFuture<>();
            instrument.runOnMainSync(() -> {
                browser.addListener(new Player.Listener() {
                    @Override public void onIsPlayingChanged(boolean playing) {
                        if (playing) started.complete(true); else if (started.isDone()) stopped.complete(true);
                    }
                });
                browser.setMediaItem(new MediaItem.Builder().setRequestMetadata(
                        new MediaItem.RequestMetadata.Builder().setSearchQuery("Tone").build()).build());
                browser.prepare(); browser.play();
            });
            assertTrue(started.get(8, TimeUnit.SECONDS));
            awaitForegroundPlayback();
            context.sendBroadcast(new Intent(context, PlayerWidget.class).setAction("app.droppedneedle.mobile.WIDGET.TOGGLE"));
            assertTrue(stopped.get(4, TimeUnit.SECONDS));
            logout();
            assertEquals(androidx.media3.session.SessionError.ERROR_SESSION_SETUP_REQUIRED,
                    browserCall(() -> browser.getChildren(device.mediaId, 0, 11, null)).resultCode);
        } finally { instrument.runOnMainSync(() -> { browser.pause(); browser.release(); }); }
    }
    @Test public void wrongTenantRotatedTokenChangedUserMissingOwnerAndSignOutPreserveTheSavedQueue() throws Exception {
        savedQueue(true);
        assertNull(requestStoredQueue());
        for (String[] denied : new String[][]{{SERVER, TOKEN, "different"}, {SERVER, "rotated", USER},
                {SERVER + "/other", TOKEN, USER}, {SERVER, TOKEN, null}}) {
            login(denied[0], denied[1], denied[2]);
            assertNull(requestStoredQueue());
            assertEquals(1600, archive.inspect(key).getLong("position"));
        }
        login(SERVER, TOKEN, USER);
        assertEquals(1, requestStoredQueue().getInt("index"));
        savedQueue(false);
        assertNull(requestStoredQueue());
        assertEquals(1600, archive.inspect(key).getLong("position"));
        logout();
        assertNull(requestStoredQueue());
    }
}
