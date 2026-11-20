package app.droppedneedle.mobile;

import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;
import androidx.core.content.IntentCompat;
import androidx.media3.session.MediaButtonReceiver;

/** An explicit Play from Android can reopen a previously saved queue after user unlock. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class HeadsetPlayReceiver extends MediaButtonReceiver {
    @Override protected boolean shouldStartForegroundService(Context context, Intent intent) {
        if (!Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) return false;
        KeyEvent event = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_KEY_EVENT, KeyEvent.class);
        if (event == null || event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() != 0
                || event.isCanceled()) return false;
        int key = event.getKeyCode();
        return (key == KeyEvent.KEYCODE_MEDIA_PLAY || key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                || key == KeyEvent.KEYCODE_HEADSETHOOK) && HeadsetAccount.unlocked(context) && SavedQueue.exists(context);
    }
}
