package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import androidx.media3.common.MediaMetadata;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.common.io.ByteStreams;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class PlaybackArtworkTest {
    private static final String BASE = "https://art.example/dn";
    private static final String COVER = BASE + "/api/v3/library/albums/test/artwork";
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private PlaybackService.Access account() {
        String id = UUID.randomUUID().toString();
        return new PlaybackService.Access(context, BASE, id, id);
    }

    private static MediaMetadata track(PlaybackService.Access owner, String id, String cover) throws Exception {
        JSONObject track = new JSONObject().put("id", id).put("title", id)
                .put("streamUrl", BASE + "/api/v3/stream/local/" + id).put("artworkUrl", cover);
        owner.metadata.put(id, track);
        return new MediaMetadata.Builder().setArtworkUri(CarArtworkProvider.uri(owner.artworkAuthority, owner.artworkScope, owner.base, track)).build();
    }

    private static byte[] picture(int color) {
        Bitmap bitmap = Bitmap.createBitmap(1024, 1024, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(color);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, png));
        bitmap.recycle();
        return png.toByteArray();
    }

    private static byte[] taggedMp3(byte[] png) throws Exception {
        byte[] mp3;
        try (InputStream asset = InstrumentationRegistry.getInstrumentation().getContext()
                .getAssets().open("offline/silence.mp3")) {
            mp3 = ByteStreams.toByteArray(asset);
        }
        int audio = 10 + ((mp3[6] & 127) << 21) + ((mp3[7] & 127) << 14)
                + ((mp3[8] & 127) << 7) + (mp3[9] & 127);
        ByteArrayOutputStream tag = new ByteArrayOutputStream();
        DataOutputStream frame = new DataOutputStream(tag);
        frame.writeBytes("APIC");
        frame.writeInt(png.length + 13);
        frame.writeShort(0);
        frame.writeByte(0);
        frame.writeBytes("image/png");
        frame.writeByte(0);
        frame.writeByte(3); // ID3v2 front cover.
        frame.writeByte(0);
        frame.write(png);

        ByteArrayOutputStream file = new ByteArrayOutputStream();
        file.write(new byte[] {'I', 'D', '3', 3, 0, 0});
        for (int shift = 21; shift >= 0; shift -= 7) file.write((tag.size() >> shift) & 127);
        tag.writeTo(file);
        file.write(mp3, audio, mp3.length - audio);
        return file.toByteArray();
    }

    private static void save(PlaybackService.Access owner, String id, byte[] audio) throws Exception {
        try (OfflineStore.Capture writer = owner.offline.begin(owner.metadata(id), false, audio.length)) {
            assertNotNull(writer);
            writer.write(audio, 0, audio.length);
            writer.finish();
        }
    }

    private static Bitmap load(PlaybackArtwork loader, MediaMetadata metadata) throws Exception {
        return loader.loadBitmapFromMetadata(metadata).get(10, TimeUnit.SECONDS);
    }

    @Test public void savedCoverWorksWithoutRemoteUrlAndDoesNotTouchEvictionOrder() throws Exception {
        PlaybackService.Access owner = account();
        MediaMetadata tagged = track(owner, "tagged", "");
        MediaMetadata plain = track(owner, "plain", COVER);
        PlaybackArtwork loader = new PlaybackArtwork(() -> owner, request -> {
            throw new AssertionError("Unexpected artwork request");
        });
        try {
            owner.offline.configure(owner.offline.options().put("autoCache", true).put("unmeteredOnly", false));
            save(owner, "tagged", taggedMp3(picture(Color.RED)));
            save(owner, "plain", OfflinePlaybackTest.wav());
            SharedPreferences prefs = context.getSharedPreferences("dn.offline." + owner.offline.account, 0);
            for (String key : prefs.getAll().keySet()) {
                if (key.startsWith("track.")) {
                    JSONObject row = new JSONObject(prefs.getString(key, "")).put("used", 1234);
                    assertTrue(prefs.edit().putString(key, row.toString()).commit());
                }
            }
            owner.offline.configure(owner.offline.options().put("offlineOnly", true));
            Bitmap cover = load(loader, tagged);
            assertNotNull(cover);
            assertTrue(cover.getWidth() <= 512);
            assertEquals(Color.RED, cover.getPixel(0, 0));
            assertNull(load(loader, plain));
            JSONArray entries = owner.offline.snapshot().getJSONArray("items");
            assertEquals(2, entries.length());
            for (int i = 0; i < entries.length(); i++) assertEquals(1234, entries.getJSONObject(i).getLong("used"));
            owner.offline.configure(owner.offline.options().put("offlineOnly", false));
            owner.metadata("tagged").put("artworkUrl", COVER);
            assertEquals(Color.RED, load(loader, tagged).getPixel(0, 0));
        } finally {
            owner.offline.remove(new JSONArray().put("tagged").put("plain"));
        }
    }

    @Test public void onlineCarCoverUsesOnlyItsServersCoverEndpointAndNeverExposesTheBearerToTheHost() throws Exception {
        PlaybackService.Access access = account();
        HeadsetAccount login = new HeadsetAccount(access.base,access.token,access.userId);
        String path = "/api/v3/library/albums/test/artwork";
        android.net.Uri art = track(access,"fixture",BASE + path).artworkUri;
        assertEquals("content",art.getScheme());
        assertFalse(art.toString().contains(login.token));
        assertFalse(art.toString().contains(login.server.host()));
        byte[] blue = picture(Color.BLUE);
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient server = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls.incrementAndGet();
            assertEquals(BASE + path + "?size=500",chain.request().url().toString());
            assertEquals("Bearer " + login.token,chain.request().header("Authorization"));
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(ResponseBody.create(MediaType.get("image/png"),blue)).build();
        }).build();
        assertEquals(Color.BLUE, CarArtworkProvider.cover(context,login,art,false,server,() -> true).getPixel(0,0));
        assertNull(CarArtworkProvider.cover(context,login,art.buildUpon().clearQuery().appendQueryParameter("cover","/api/v3/admin/users").build(), false,server,() -> true));
        assertNull(CarArtworkProvider.cover(context,login,art,false,server,() -> false));
        assertEquals(1,calls.get());
    }

    @Test public void fallbackHonorsOfflineModeAndRejectsAnotherAccountsCachedOrInFlightCover() throws Exception {
        PlaybackService.Access first = account(), second = account();
        AtomicReference<PlaybackService.Access> active = new AtomicReference<>(first);
        AtomicInteger requests = new AtomicInteger();
        byte[] blue = picture(Color.BLUE), green = picture(Color.GREEN);
        OkHttpClient http = new OkHttpClient.Builder().addInterceptor(chain -> {
            PlaybackService.Access owner = active.get();
            assertEquals(owner, chain.request().tag(PlaybackService.Access.class));
            assertEquals("Bearer " + owner.token, chain.request().header("Authorization"));
            assertEquals(COVER, chain.request().url().toString());
            if (requests.incrementAndGet() == 2) active.set(second);
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(200).message("OK").body(ResponseBody.create(MediaType.get("image/png"),
                            owner == first ? blue : green)).build();
        }).build();
        PlaybackArtwork loader = new PlaybackArtwork(active::get, http);
        MediaMetadata original = track(first, "same", COVER).buildUpon()
                .setArtworkData(new byte[] {1, 2, 3}, MediaMetadata.PICTURE_TYPE_FRONT_COVER).build();
        MediaMetadata next = track(second, "same", COVER);
        assertEquals(Color.BLUE, load(loader, original).getPixel(0, 0));
        assertEquals(Color.BLUE, load(loader, original).getPixel(0, 0));
        first.offline.configure(first.offline.options().put("offlineOnly", true));
        assertNull(load(loader, original));
        assertEquals(1, requests.get());
        first.offline.configure(first.offline.options().put("offlineOnly", false));
        assertNull(load(loader, track(first, "racing", COVER)));
        assertNull(load(loader, original));
        assertEquals(Color.GREEN, load(loader, next).getPixel(0, 0));
        assertNull(load(loader, track(second, "foreign", "https://elsewhere.example/api/v3/art")));
        assertEquals(3, requests.get());
    }
}
