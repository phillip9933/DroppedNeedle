package app.droppedneedle.mobile;

import android.app.Instrumentation;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class SmartFadeAudioTest {
    private final Instrumentation test = InstrumentationRegistry.getInstrumentation();
    private final String base = "https://edge.example/dn";
    private final PlaybackService.Access owner = new PlaybackService.Access(test.getTargetContext(), base, "fixture", UUID.randomUUID().toString());
    private final Uri track = Uri.parse(base + "/api/v3/stream/local/first");

    private static byte[] pulses(int period) {
        int samples = 120 * 8000;
        byte[] song = Arrays.copyOf(OfflinePlaybackTest.wav(), 44 + samples * 2);
        ByteBuffer pcm = ByteBuffer.wrap(song).order(ByteOrder.LITTLE_ENDIAN);
        pcm.putInt(4, song.length - 8).putInt(40, song.length - 44);
        for (int i = 0; i < samples; i++) {
            int amplitude = (i / 800) % period == 1 ? 12000 : 4000;
            pcm.putShort(44 + i * 2, (short) (i % 32 < 16 ? amplitude : -amplitude));
        }
        return song;
    }

    @Test public void rangesMeasureActualPulsesAndSkipDifferentTemposWithoutCaching() throws Exception {
        byte[] music = pulses(5), slower = pulses(7);
        AtomicInteger read = new AtomicInteger();
        OkHttpClient http = new OkHttpClient.Builder().addInterceptor(chain -> {
            assertEquals("Bearer fixture", chain.request().header("Authorization"));
            assertSame(owner, chain.request().tag(PlaybackService.Access.class));
            String range = chain.request().header("Range");
            assertNotNull(range);
            byte[] data = chain.request().url().encodedPath().endsWith("slower") ? slower : music;
            String[] endpoints = range.substring(6).split("-");
            int first = Integer.parseInt(endpoints[0]), last = Math.min(data.length - 1, Integer.parseInt(endpoints[1]));
            assertTrue(last - first < 128 * 1024);
            read.addAndGet(last - first + 1);
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(206).message("Partial")
                    .header("Content-Range", "bytes " + first + "-" + last + "/" + data.length)
                    .body(ResponseBody.create(MediaType.get("audio/wav"), Arrays.copyOfRange(data, first, last + 1))).build();
        }).build();
        TrackWaveform.Job job = new TrackWaveform.Job("fixture");
        SmartFadeAudio.Edge tail = SmartFadeAudio.online(owner, track, track, 120000, true, http, job);
        SmartFadeAudio.Edge head = SmartFadeAudio.online(owner, track, track, 120000, false, http, job);
        assertEquals(2000, SmartFadePlan.overlap(tail.rms, head.rms, tail.duration, head.duration));
        assertTrue("Range reads must retrieve less than a whole song", read.get() < music.length);
        Uri other = Uri.parse(base + "/api/v3/stream/local/slower");
        SmartFadeAudio.Edge different = SmartFadeAudio.online(owner, other, other, 120000, false, http, job);
        assertEquals(0, SmartFadePlan.overlap(tail.rms, different.rms, tail.duration, different.duration));
        assertEquals(0, owner.offline.snapshot().getJSONArray("items").length());
        int used = read.get();
        owner.offline.configure(owner.offline.options().put("offlineOnly", true));
        assertThrows(IOException.class, () -> TrackWaveform.open(job, owner, track, http, "bytes=0-15"));
        assertEquals(used, read.get());
    }

    @Test public void liveMp3AndOpusUseTheSelectedRateAndAnOutgoingTimeSeek() throws Exception {
        for (String format : new String[]{"mp3", "opus"}) {
            byte[] bytes;
            try (InputStream in = test.getContext().getAssets().open("offline/silence." + format);
                 ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                byte[] block = new byte[4096];
                for (int n; (n = in.read(block)) >= 0;) buffer.write(block, 0, n);
                bytes = buffer.toByteArray();
            }
            OkHttpClient http = new OkHttpClient.Builder().addInterceptor(chain -> {
                assertEquals(format, chain.request().url().queryParameter("format"));
                assertEquals("96", chain.request().url().queryParameter("max_bitrate"));
                assertEquals("172.000", chain.request().url().queryParameter("start_seconds"));
                assertNull(chain.request().header("Range"));
                return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                        .header("Accept-Ranges", "none").body(ResponseBody.create(
                                MediaType.get(format.equals("mp3") ? "audio/mpeg" : "audio/ogg"), bytes)).build();
            }).build();
            Uri selected = track.buildUpon().appendQueryParameter("format", format).appendQueryParameter("max_bitrate","96").build();
            SmartFadeAudio.Edge tail = SmartFadeAudio.online(owner, track, selected, 180000, true, http, new TrackWaveform.Job("live"));
            assertEquals(80, tail.rms.length);
            for (float rms : tail.rms) assertTrue(rms <= .063f);
            assertEquals(180000, tail.duration);
        }
    }
}
