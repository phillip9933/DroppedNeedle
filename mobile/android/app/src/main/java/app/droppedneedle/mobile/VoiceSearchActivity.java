package app.droppedneedle.mobile;

import android.app.Activity;
import android.app.SearchManager;
import android.content.ComponentName;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.google.common.util.concurrent.ListenableFuture;

/** System assistants can send a voice intent as well as a media-session search. Both use the same DN resolver. */
public final class VoiceSearchActivity extends Activity {
    private ListenableFuture<MediaController> connection;
    private final Handler main = new Handler(Looper.getMainLooper());
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        String query = getIntent().getStringExtra(SearchManager.QUERY);
        if (!android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH.equals(getIntent().getAction())
                || query != null && query.length() > 512) { finish(); return; }
        SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        connection = new MediaController.Builder(this, token).buildAsync();
        connection.addListener(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                MediaController player = connection.get();
                player.addListener(new Player.Listener() {
                    @Override public void onIsPlayingChanged(boolean playing) { if (playing) finish(); }
                    @Override public void onPlayerError(PlaybackException error) { finish(); }
                });
                player.setMediaItem(new MediaItem.Builder().setRequestMetadata(new MediaItem.RequestMetadata.Builder()
                        .setSearchQuery(query == null ? "" : query).build()).build());
                player.prepare();
                player.play();
            } catch (Exception unavailable) { finish(); }
        }, ContextCompat.getMainExecutor(this));
        main.postDelayed(this::finish, 12000);
    }
    @Override protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (connection != null) MediaController.releaseFuture(connection);
        super.onDestroy();
    }
}
