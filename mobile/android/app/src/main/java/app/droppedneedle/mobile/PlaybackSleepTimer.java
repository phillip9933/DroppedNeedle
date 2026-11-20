package app.droppedneedle.mobile;

/** Owned by the playback service, on its player thread. Track identity distinguishes duplicate queue entries. */
final class PlaybackSleepTimer {
    interface Host {
        long elapsed();
        void schedule(Runnable task, long delayMs);
        void unschedule(Runnable task);
        void pause();
        void pauseAtEnd(boolean enabled);
    }
    private final Host host;
    private final Runnable alarm = this::check;
    private long deadline;
    private Object track;

    PlaybackSleepTimer(Host host) { this.host = host; }

    void minutes(double minutes) {
        if (!(minutes >= 1 && minutes <= 240 && minutes == (int) minutes))
            throw new IllegalArgumentException("Choose a whole number from 1 to 240 minutes.");
        cancel();
        long duration = (long) minutes * 60_000;
        deadline = host.elapsed() + duration;
        host.schedule(alarm, duration);
    }
    void afterTrack(Object current) {
        if (current == null) throw new IllegalStateException("Choose a track first.");
        cancel();
        track = current;
        host.pauseAtEnd(true);
    }
    void changedTrack(Object current) { if (track != null && track != current) cancel(); }
    void finishedTrack() { if (track != null) cancel(); }
    boolean afterTrack() { return track != null; }
    long remaining() { return deadline == 0 ? 0 : Math.max(0, deadline - host.elapsed()); }
    void check() {
        if (deadline != 0 && host.elapsed() >= deadline) {
            cancel();
            host.pause();
        }
    }
    void cancel() {
        if (deadline != 0) { deadline = 0; host.unschedule(alarm); }
        if (track != null) { track = null; host.pauseAtEnd(false); }
    }
}
