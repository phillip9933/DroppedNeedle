package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import org.json.JSONObject;

/** Apply the local track envelope independently of the hardware volume. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlaybackFades implements Player.Listener {
    private final Player player;
    private final SharedPreferences preferences;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable update = this::refresh;
    private int milliseconds;

    PlaybackFades(Context context, Player player) {
        this.player = player;
        preferences = context.getSharedPreferences("dn_track_fades", Context.MODE_PRIVATE);
        milliseconds = allowed(preferences.getInt("milliseconds", 0));
        player.addListener(this);
        refresh();
    }

    private static int allowed(int value) {
        switch (value) {
            case 500: case 2000: case 4000: case 8000: return value;
            default: return 0;
        }
    }

    int length() { return milliseconds; }

    void configure(int value) {
        milliseconds = allowed(value);
        preferences.edit().putInt("milliseconds", milliseconds).apply();
        refresh();
    }

    static float gain(long position, long duration, int fade) {
        if (fade <= 0) return 1;
        // Even very short tracks reach full volume at their midpoint.
        double ramp = duration > 0 ? Math.min(fade, duration / 2.0) : fade;
        double distance = duration > 0 ? Math.min(position, duration - position) : position;
        return (float) Math.max(0, Math.min(1, distance / ramp));
    }

    @Override public void onEvents(Player source, Player.Events events) {
        if (events.containsAny(Player.EVENT_POSITION_DISCONTINUITY, Player.EVENT_IS_PLAYING_CHANGED,
                Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_PLAYBACK_STATE_CHANGED,
                Player.EVENT_TIMELINE_CHANGED, Player.EVENT_PLAYBACK_PARAMETERS_CHANGED)) refresh();
    }

    private void refresh() {
        main.removeCallbacks(update);
        MediaItem item = player.getCurrentMediaItem();
        long duration = player.getDuration();
        if (duration <= 0 && item != null && item.localConfiguration != null
                && item.localConfiguration.tag instanceof JSONObject) {
            duration = (long) (((JSONObject) item.localConfiguration.tag).optDouble("duration", 0) * 1000);
        }
        long position = player.getCurrentPosition();
        float level = item == null ? 1 : gain(position, duration, milliseconds);
        if (player.getVolume() != level) player.setVolume(level);
        if (item == null || milliseconds == 0 || !player.isPlaying()) return;
        long beforeEnd = duration - milliseconds - position;
        if (position >= milliseconds && duration <= 0) return;
        long interval = position < milliseconds || beforeEnd <= 0 ? 50 : beforeEnd;
        main.postDelayed(update, Math.max(16, (long) (interval / player.getPlaybackParameters().speed)));
    }

    void release() {
        main.removeCallbacks(update);
        player.removeListener(this);
    }
}
