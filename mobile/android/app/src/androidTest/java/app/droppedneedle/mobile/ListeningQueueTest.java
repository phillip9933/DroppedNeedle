package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
@RunWith(AndroidJUnit4.class)
public final class ListeningQueueTest {
    private final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
    @Test
    public void originalOrderKeepsThePlayingDuplicateAndPositionAfterARehydratedShuffle() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            ExoPlayer deck = new ExoPlayer.Builder(app).build();
            try {
                ArrayList<MediaItem> tracks = new ArrayList<>();
                for (String id : new String[] {"a", "b", "a", "c", "d"})
                    tracks.add(new MediaItem.Builder()
                                    .setMediaId(id)
                                    .setUri("https://example.test/" + id)
                                    .setTag(new JSONObject())
                                    .build());
                deck.setMediaItems(tracks, 0, 0);
                QueueOrder order = new QueueOrder();
                order.toggle(deck);
                int second = -1;
                ArrayList<MediaItem> shown = new ArrayList<>();
                for (int i = 0; i < tracks.size(); i++) {
                    MediaItem item = deck.getMediaItemAt(i);
                    shown.add(item);
                    if (item.localConfiguration.tag == tracks.get(2).localConfiguration.tag)
                        second = i;
                }
                assertTrue(second > 0);
                deck.seekTo(second, 3210);
                QueueOrder reopened = new QueueOrder();
                reopened.restore(shown, order.save(deck));
                reopened.toggle(deck);
                assertFalse(reopened.shuffled());
                assertEquals(2, deck.getCurrentMediaItemIndex());
                assertEquals(3210, deck.getCurrentPosition());
                assertSame(
                        tracks.get(2).localConfiguration.tag, deck.getCurrentMediaItem().localConfiguration.tag);
            } finally {
                deck.release();
            }
        });
    }

    @Test
    public void localMusicPlanSkipsPreviouslyHeardRecordingsExternalMediaAndDuplicateFiles() throws Exception {
        String mbid = "11111111-1111-1111-1111-111111111111", recording = "22222222-2222-2222-2222-222222222222";
        JSONObject former = new JSONObject()
                                    .put("id", "old")
                                    .put("title", "Jazz")
                                    .put("artist", "Artist")
                                    .put("artistMbid", mbid)
                                    .put("recordingMbid", recording);
        JSONObject row = new JSONObject()
                                 .put("track_name", "New")
                                 .put("artist_name", "Artist")
                                 .put("artist_mbid", mbid)
                                 .put("in_library", true)
                                 .put("local_file_id", "new");
        JSONArray tracks = new JSONArray()
                                   .put(new JSONObject(row.toString()).put("local_file_id", "old"))
                                   .put(new JSONObject(row.toString())
                                                   .put("local_file_id", "other")
                                                   .put("recording_mbid", recording))
                                   .put(new JSONObject(row.toString()).put("in_library", false))
                                   .put(row)
                                   .put(row);
        String data = new JSONObject().put("tracks", tracks).toString();
        AtomicReference<String> request = new AtomicReference<>();
        OkHttpClient http = new OkHttpClient.Builder()
                                    .addInterceptor(chain -> {
                                        assertEquals("/prefix/api/v3/discover/radio/plan",
                                                chain.request().url().encodedPath());
                                        Buffer body = new Buffer();
                                        chain.request().body().writeTo(body);
                                        request.set(body.readUtf8());
                                        return new Response.Builder()
                                                .request(chain.request())
                                                .protocol(Protocol.HTTP_1_1)
                                                .code(200)
                                                .message("OK")
                                                .body(ResponseBody.create(data, MediaType.get("application/json")))
                                                .build();
                                    })
                                    .build();
        PlaybackService.Access owner =
                new PlaybackService.Access(app, "https://queue-test.invalid/prefix", "fixture", "radio-user");
        JSArray result = new SimilarMusic(http, owner).plan((JSArray) new JSArray().put(former), new JSONArray());
        assertEquals(1, result.length());
        assertEquals("new", result.getJSONObject(0).getString("id"));
        assertEquals("https://queue-test.invalid/prefix/api/v3/stream/local/new",
                result.getJSONObject(0).getString("streamUrl"));
        assertEquals(
                recording, new JSONObject(request.get()).getJSONArray("exclude_recording_mbids").getString(0));
    }

    @Test
    public void pcmProcessorAppliesBothBoostAndAttenuationAndPreservesUnity() {
        PlaybackSound.GainProcessor processor = new PlaybackSound.GainProcessor();
        processor.queueInput(androidx.media3.common.audio.AudioProcessor.EMPTY_BUFFER);
        assertFalse(processor.getOutput().hasRemaining());
        for (float factor : new float[] {0.5f, 1, 2}) {
            ByteBuffer pcm = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder());
            pcm.putShort((short) 10000).putShort((short) -20000).flip();
            processor.factor = factor;
            processor.queueInput(pcm);
            ByteBuffer out = processor.getOutput();
            assertEquals(Math.round(10000 * factor), out.getShort());
            assertEquals(Math.max(-32768, Math.round(-20000 * factor)), out.getShort());
        }
    }
}
