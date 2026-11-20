package app.droppedneedle.mobile;

import android.content.Context;
import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import com.google.android.gms.cast.framework.media.CastMediaOptions;
import java.util.Collections;
import java.util.List;

public final class GoogleCastOptions implements OptionsProvider {
    @Override public CastOptions getCastOptions(Context context) {
        return new CastOptions.Builder()
                .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
                .setResumeSavedSession(false).setEnableReconnectionService(false)
                .setSessionTransferEnabled(false).setStopReceiverApplicationWhenEndingSession(false)
                // DN's Media3 session owns the queue, lock-screen controls and notification.
                .setCastMediaOptions(new CastMediaOptions.Builder().setMediaSessionEnabled(false)
                        .setNotificationOptions(null).build()).build();
    }
    @Override public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return Collections.emptyList();
    }
}
