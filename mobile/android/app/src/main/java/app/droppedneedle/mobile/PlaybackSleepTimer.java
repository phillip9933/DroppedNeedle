package app.droppedneedle.mobile;

/** Owned by the playback service, on its player thread. Track identity distinguishes duplicate queue entries. */
final class PlaybackSleepTimer {
    interface Host {
        long elapsed();
        void schedule(Runnable task, long delayMs);
        void unschedule(Runnable task);
        void pause();
        void pauseAtEnd(boolean enabled);
        default Object playingTrack() { return null; }
    }
    private final Host host;
    private final Runnable alarm = this::check;
    private long deadline;
    private Object track;
    private int remainingTracks;
    private boolean finishLast;

    PlaybackSleepTimer(Host host) { this.host = host; }

    void minutes(double minutes) { minutes(minutes, false); }
    void minutes(double minutes, boolean finish) {
        if (!(minutes >= 1 && minutes <= 240 && minutes == (int) minutes))
            throw new IllegalArgumentException("Choose a whole number from 1 to 240 minutes.");
        cancel();
        finishLast = finish;
        long duration = (long) minutes * 60_000;
        deadline = host.elapsed() + duration;
        host.schedule(alarm, duration);
    }
    void afterTrack(Object current) { afterTracks(current, 1); }
    void afterTracks(Object current, double count) {
        if (current == null) throw new IllegalStateException("Choose a track first.");
        if (!(count >= 1 && count <= 99 && count == (int) count))
            throw new IllegalArgumentException("Choose between 1 and 99 tracks.");
        cancel();
        track = current;
        remainingTracks = (int) count;
        host.pauseAtEnd(remainingTracks == 1);
    }
    void changedTrack(Object current) { changedTrack(current, false); }
    void changedTrack(Object current, boolean automatic) {
        if (track == null) return;
        if (automatic && current != null && remainingTracks > 1) {
            track = current;
            remainingTracks--;
            host.pauseAtEnd(remainingTracks == 1);
        } else if (track != current) cancel();
    }
    void finishedTrack() { if (track != null) cancel(); }
    boolean afterTrack() { return remainingTracks == 1; }
    int tracks() { return remainingTracks; }
    boolean finishLast() { return finishLast; }
    long remaining() { return deadline == 0 ? 0 : Math.max(0, deadline - host.elapsed()); }
    void check() {
        if (deadline != 0 && host.elapsed() >= deadline) {
            Object playing = finishLast ? host.playingTrack() : null;
            if (playing != null) afterTrack(playing);
            else {
                cancel();
                host.pause();
            }
        }
    }
    void cancel() {
        remainingTracks = 0;
        finishLast = false;
        if (deadline != 0) { deadline = 0; host.unschedule(alarm); }
        if (track != null) { track = null; host.pauseAtEnd(false); }
    }
}
