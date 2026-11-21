package app.droppedneedle.mobile;

import org.json.JSONObject;

/** RMS windows are ordered from the cut into the song, for both the head and the tail. */
final class SmartFadePlan {
    static final int MAX_MS = 8000;
    static final int BIN_MS = 100;

    private static int quiet(float[] bins) {
        int ms = 0;
        for (float rms : bins) {
            if (!(rms <= .063f)) break;
            ms += BIN_MS;
        }
        return ms < 200 ? 0 : ms;
    }

    static int overlap(float[] tail, float[] head, long outgoingMs, long incomingMs) {
        long limit = Math.min(MAX_MS, Math.min(outgoingMs, incomingMs) / 2);
        int ms = (int) Math.min(limit, quiet(tail) + quiet(head));
        if (ms >= 400) return ms;
        Pulses outgoing = Pulses.measure(tail, true), incoming = Pulses.measure(head, false);
        if (outgoing == null || incoming == null
                || Math.abs(outgoing.period - incoming.period) > .1 * Math.min(outgoing.period, incoming.period)) return 0;
        for (int back = 4; back >= 2; back--) {
            int aligned = (tail.length - outgoing.indices[outgoing.count - back] + incoming.indices[0]) * BIN_MS;
            if (aligned >= 400 && aligned <= limit) return aligned;
        }
        return 0;
    }

    private static final class Pulses {
        final int[] indices;
        int count;
        double period;
        Pulses(int bins) { indices = new int[bins]; }

        static Pulses measure(float[] bins, boolean reversed) {
            Pulses pulses = new Pulses(bins.length);
            for (int i = 1; i < bins.length; i++) {
                int index = reversed ? bins.length - 1 - i : i;
                float level = bins[index], previous = bins[reversed ? index + 1 : index - 1];
                if (level >= .09f && level - previous >= .035f && level >= previous * 1.45f
                        && (pulses.count == 0 || i - pulses.indices[pulses.count - 1] >= 3))
                    pulses.indices[pulses.count++] = i;
            }
            if (pulses.count < 5) return null;
            pulses.period = (pulses.indices[pulses.count - 1] - pulses.indices[0]) / (double) (pulses.count - 1);
            if (pulses.period < 3 || pulses.period > 10) return null;
            for (int i = 1; i < pulses.count; i++)
                if (Math.abs(pulses.indices[i] - pulses.indices[i - 1] - pulses.period) > 1) return null;
            return pulses;
        }
    }

    static float manual(long position, long duration, int fadeIn, int fadeOut) {
        int sum = fadeIn + fadeOut;
        double scale = duration > 0 && sum > 0 ? Math.min(1, duration / (double) sum) : 1;
        double in = fadeIn > 0 ? position / (fadeIn * scale) : 1;
        double out = fadeOut > 0 && duration > 0 ? (duration - position) / (fadeOut * scale) : 1;
        return (float) Math.max(0, Math.min(1, Math.min(in, out)));
    }

    static boolean albumOrder(JSONObject outgoing, JSONObject incoming) {
        if (outgoing == null || incoming == null) return false;
        String id = outgoing.optString("albumId"), nextId = incoming.optString("albumId");
        if (!id.isEmpty() && !nextId.isEmpty()) {
            if (!id.equals(nextId)) return false;
        } else {
            String album = outgoing.optString("album"), artist = albumArtist(outgoing);
            if (album.isEmpty() || artist.isEmpty() || !album.equalsIgnoreCase(incoming.optString("album"))
                    || !artist.equalsIgnoreCase(albumArtist(incoming))) return false;
        }
        int track = outgoing.optInt("trackNumber"), next = incoming.optInt("trackNumber");
        int disc = outgoing.optInt("discNumber", 1), nextDisc = incoming.optInt("discNumber", 1);
        return track > 0 && next > 0 && (disc == nextDisc && next == track + 1 || nextDisc == disc + 1 && next == 1);
    }

    private static String albumArtist(JSONObject track) {
        String artist = track.optString("albumArtist");
        return artist.isEmpty() ? track.optString("artist") : artist;
    }

    private SmartFadePlan() {}
}
