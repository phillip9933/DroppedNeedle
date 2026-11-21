package app.droppedneedle.mobile;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class SmartFadePlanTest {
    @Test public void quietRunsAreMeasuredFromTheBoundaryAndCappedForShortSongs() {
        float[] tail = {.012f, .023f, .035f, .04f, .1f, .02f};
        float[] head = {0, .008f, .03f, .16f};
        assertEquals(700, SmartFadePlan.overlap(tail, head, 10000, 10000));
        assertEquals(500, SmartFadePlan.overlap(tail, head, 1000, 1200));
        assertEquals(0, SmartFadePlan.overlap(tail, head, 600, 1200));
        assertEquals(0, SmartFadePlan.overlap(new float[]{.2f, 0}, new float[]{0, .2f}, 10000, 10000));
        assertEquals(8000, SmartFadePlan.overlap(new float[80], new float[80], 60000, 60000));
    }

    @Test public void albumSequencingRequiresAnIdentityAndTrackNumbers() throws Exception {
        JSONObject a = new JSONObject().put("albumId","record").put("trackNumber",3);
        JSONObject b = new JSONObject().put("albumId","record").put("trackNumber",4);
        assertTrue(SmartFadePlan.albumOrder(a,b));
        b.put("trackNumber",1).put("discNumber",2);
        assertTrue(SmartFadePlan.albumOrder(a,b));
        b.put("trackNumber",2);
        assertFalse(SmartFadePlan.albumOrder(a,b));
        b.put("discNumber",1).put("trackNumber",4).put("albumId","another");
        assertFalse(SmartFadePlan.albumOrder(a,b));
        a.remove("albumId"); b.remove("albumId");
        assertFalse(SmartFadePlan.albumOrder(a,b));
        a.put("album","Record").put("artist","Artist");
        b.put("album","Record").put("artist","Artist");
        assertTrue(SmartFadePlan.albumOrder(a,b));
    }

    @Test public void manualEdgesAreIndependentAndRecoverFullLevelOnShortTracks() {
        assertEquals(.2f, SmartFadePlan.manual(100,800,500,0), .001f);
        assertEquals(1f, SmartFadePlan.manual(700,800,500,0), .001f);
        assertEquals(1f, SmartFadePlan.manual(100,800,0,500), .001f);
        assertEquals(.2f, SmartFadePlan.manual(700,800,0,500), .001f);
        assertEquals(1f, SmartFadePlan.manual(400,800,500,500), .001f);
    }
}
