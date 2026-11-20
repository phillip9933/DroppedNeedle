package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public final class PlaybackSleepTimerTest {
    private static final class Host implements PlaybackSleepTimer.Host {
        long clock, delay;
        Runnable alarm;
        int pauses;
        boolean boundary;
        Object current;
        @Override public Object playingTrack() { return current; }
        @Override public long elapsed() { return clock; }
        @Override public void schedule(Runnable task, long ms) { alarm = task; delay = ms; }
        @Override public void unschedule(Runnable task) { if (task == alarm) alarm = null; }
        @Override public void pause() { pauses++; }
        @Override public void pauseAtEnd(boolean enabled) { boundary = enabled; }
    }
    @Test public void deadlinePausesOnceAndCanceledCallbacksCannotPauseANewTimer() {
        Host host = new Host();
        PlaybackSleepTimer timer = new PlaybackSleepTimer(host);
        timer.minutes(1);
        Runnable first = host.alarm;
        host.clock = 20_000;
        timer.minutes(2);
        assertEquals(120_000, host.delay);
        host.clock = 60_000;
        first.run();
        assertEquals(0, host.pauses);
        assertEquals(80_000, timer.remaining());
        host.clock = 140_000;
        host.alarm.run();
        timer.check();
        assertEquals(1, host.pauses);
        assertNull(host.alarm);
        assertEquals(0, timer.remaining());
    }
    @Test public void boundaryTracksQueueEntryIdentityAndSupersedesMinuteTimers() {
        Host host = new Host();
        PlaybackSleepTimer timer = new PlaybackSleepTimer(host);
        Object song = new Object();
        timer.minutes(240);
        timer.afterTrack(song);
        assertNull(host.alarm);
        assertTrue(host.boundary);
        timer.changedTrack(song);
        assertTrue(timer.afterTrack());
        timer.changedTrack(new Object());
        assertFalse(host.boundary);
        timer.afterTrack(song);
        timer.finishedTrack();
        assertFalse(timer.afterTrack());
        timer.afterTrack(song);
        timer.cancel();
        assertFalse(host.boundary);
        assertEquals(0, host.pauses);
    }
    @Test public void countedNaturalTransitionsAndFinishLastArmOnlyTheFinalBoundary() {
        Host host = new Host();
        PlaybackSleepTimer timer = new PlaybackSleepTimer(host);
        Object repeated = new Object(), next = new Object();
        timer.afterTracks(repeated, 3);
        assertFalse(host.boundary);
        timer.changedTrack(repeated, true);
        assertEquals(2, timer.tracks());
        timer.changedTrack(next, true);
        assertTrue(host.boundary);
        timer.finishedTrack();
        assertEquals(0, timer.tracks());
        timer.minutes(1, true);
        host.current = next;
        host.clock = 60_001;
        host.alarm.run();
        assertTrue(host.boundary);
        assertEquals(1, timer.tracks());
        assertEquals(0, host.pauses);
        timer.changedTrack(repeated);
        assertFalse(host.boundary);
    }
}
