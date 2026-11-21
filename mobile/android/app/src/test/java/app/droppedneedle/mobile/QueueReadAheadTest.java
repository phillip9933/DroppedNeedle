package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import androidx.media3.common.Player;
import java.util.List;
import org.junit.Test;

public class QueueReadAheadTest {
    @Test
    public void followsCurrentQueueOrderAndStopsAtLimitOrEnd() {
        assertEquals(List.of(2, 3), QueueReadAhead.nextIndices(1, 8, 2, Player.REPEAT_MODE_OFF));
        assertEquals(List.of(2), QueueReadAhead.nextIndices(1, 3, 10, Player.REPEAT_MODE_OFF));
        assertTrue(QueueReadAhead.nextIndices(0, 3, 0, Player.REPEAT_MODE_OFF).isEmpty());
        assertTrue(QueueReadAhead.nextIndices(-1, 3, 2, Player.REPEAT_MODE_OFF).isEmpty());
    }
    @Test
    public void repeatAllWrapsOnceWithoutCurrentAndRepeatOneDoesNotFetch() {
        assertEquals(List.of(0, 1), QueueReadAhead.nextIndices(2, 3, 10, Player.REPEAT_MODE_ALL));
        assertTrue(QueueReadAhead.nextIndices(2, 3, 10, Player.REPEAT_MODE_ONE).isEmpty());
        assertTrue(QueueReadAhead.nextIndices(0, 1, 10, Player.REPEAT_MODE_ALL).isEmpty());
    }
    @Test
    public void onlyKnownAlbumCoverRoutesCanReceiveAccountCredentials() {
        assertEquals("/api/v3/covers/release-group/abc",
                OfflineCompanions.coverPath("/api/v3/covers/release-group/abc?size=128"));
        assertEquals("/api/v3/library/albums/123/artwork",
                OfflineCompanions.coverPath("/api/v3/library/albums/123/artwork?size=500"));
        assertNull(OfflineCompanions.coverPath("https://elsewhere.invalid/api/v3/covers/release-group/abc"));
        assertNull(OfflineCompanions.coverPath("/api/v3/library/albums/%2F/artwork"));
        assertNull(OfflineCompanions.coverPath("/api/v3/library/tracks/delete"));
    }
}
