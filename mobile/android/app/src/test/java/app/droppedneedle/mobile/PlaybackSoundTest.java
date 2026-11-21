package app.droppedneedle.mobile;

import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

public class PlaybackSoundTest {
    @Test
    public void gainUsesAlbumOrTrackAndCapsBoostAtTheTaggedPeak() throws Exception {
        JSONObject tags = new JSONObject()
                                  .put("replayGainAlbumDb", -6.0206)
                                  .put("replayGainTrackDb", 6.0206)
                                  .put("replayGainTrackPeak", 0.8);
        assertEquals(1, PlaybackSound.factor("off", tags, null), 0.0001);
        assertEquals(0.5, PlaybackSound.factor("album", tags, null), 0.0001);
        assertEquals(1.25, PlaybackSound.factor("track", tags, null), 0.0001);
        tags.remove("replayGainAlbumDb");
        assertEquals(1.25, PlaybackSound.factor("album", tags, null), 0.0001);
        assertEquals(1, PlaybackSound.factor("track", new JSONObject(), null), 0.0001);
    }
    @Test
    public void embeddedTagsWorkWhenTheServerHasNoGainTags() {
        JSONObject file = new JSONObject();
        PlaybackSound.parseTag(file, "replaygain_track_gain", "-6.0206 dB");
        PlaybackSound.parseTag(file, "replaygain_album_gain", "NaN");
        assertEquals(0.5, PlaybackSound.factor("album", new JSONObject(), file), 0.0001);
    }
}
