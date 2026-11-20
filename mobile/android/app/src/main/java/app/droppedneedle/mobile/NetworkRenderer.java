package app.droppedneedle.mobile;

import java.io.IOException;
import java.net.InetAddress;

/** Blocking transport commands used only by the playback service's route executor. */
abstract class NetworkRenderer {
    final InetAddress local, peer;
    final String name;
    NetworkRenderer(InetAddress local, InetAddress peer, String name) {
        this.local = local; this.peer = peer;
        String label = name == null ? "" : name.trim();
        this.name = label.isEmpty() ? "Network speaker" : label.substring(0, Math.min(96, label.length()));
    }
    static final class Reading {
        final String state, uri;
        final long position, duration;
        Reading(String state, String uri, long position, long duration) {
            this.state = state; this.uri = uri; this.position = position; this.duration = duration;
        }
    }
    abstract void load(String url, String mime, String title, String artist, String album) throws IOException;
    abstract void play() throws IOException;
    abstract void pause() throws IOException;
    abstract void seek(long milliseconds) throws IOException;
    abstract void stop() throws IOException;
    abstract Reading read() throws IOException;
    void leave() {}
}
