package app.droppedneedle.mobile;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import androidx.mediarouter.app.MediaRouteChooserDialog;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailabilityLight;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/** A session is handed to the player only after the user selects a Cast route. */
final class GoogleCastPicker implements SessionManagerListener<CastSession> {
    private final Activity activity;
    private final RoutedPlayer player;
    private final Consumer<String> complete;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final int generation;
    private final Runnable timeout = () -> finish("The Cast device did not respond.");
    private MediaRouteChooserDialog dialog;
    private SessionManager sessions;
    private GoogleRenderer connecting;
    private boolean finished;

    GoogleCastPicker(Activity activity, RoutedPlayer player, Consumer<String> complete) {
        this.activity = activity; this.player = player; this.complete = complete;
        generation = player.routeGeneration();
    }
    void show(Executor executor) {
        try {
            int availability = GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(activity);
            if (availability != ConnectionResult.SUCCESS) {
                String cause = availability == ConnectionResult.SERVICE_DISABLED ? "Google Play services is disabled."
                        : availability == ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED || availability == ConnectionResult.SERVICE_UPDATING
                        ? "Google Cast requires an updated Google Play services installation."
                        : "Google Cast requires a working Google Play services and Play Store installation.";
                finish(cause + " Choose Find network speakers for UPnP or DLNA.");
                return;
            }
            CastContext.getSharedInstance(activity.getApplicationContext(), executor)
                    .addOnSuccessListener(context -> {
                        if (finished) return;
                        if (activity.isFinishing() || activity.isDestroyed()) { cancel(); return; }
                        try {
                            sessions = context.getSessionManager();
                            sessions.addSessionManagerListener(this, CastSession.class);
                            dialog = new MediaRouteChooserDialog(activity);
                            dialog.setRouteSelector(context.getMergedSelector());
                            dialog.setOnCancelListener(d -> finish(""));
                            dialog.setOnDismissListener(d -> {
                                if (!finished) { main.removeCallbacks(timeout); main.postDelayed(timeout, 35000); }
                            });
                            dialog.show();
                        } catch (RuntimeException e) {
                            android.util.Log.w("DNCast", "Device chooser unavailable: " + e.getClass().getSimpleName());
                            finish("The Google Cast chooser could not open. Choose Find network speakers for UPnP or DLNA.");
                        }
                    }).addOnFailureListener(e -> unavailable());
        } catch (RuntimeException e) { unavailable(); }
    }
    void cancel() { finish(""); }
    private void unavailable() {
        finish("The Google Cast module is unavailable in Google Play services. Choose Find network speakers for UPnP or DLNA.");
    }
    private void finish(String error) {
        if (finished) return;
        finished = true;
        main.removeCallbacks(timeout);
        if (sessions != null) sessions.removeSessionManagerListener(this, CastSession.class);
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        GoogleRenderer pending = connecting;
        if (pending != null) {
            if (player.routeGeneration() == generation + 1) player.disconnect(true, "");
            pending.leave();
        }
        complete.accept(error);
    }
    @Override public void onSessionStarting(CastSession session) { main.postDelayed(timeout, 35000); }
    @Override public void onSessionStarted(CastSession session, String id) {
        if (finished) return;
        if (generation != player.routeGeneration()) {
            sessions.endCurrentSession(false);
            finish("Playback changed while choosing the Cast device.");
            return;
        }
        try {
            GoogleRenderer selected = GoogleRenderer.selected(activity, sessions, session);
            connecting = selected;
            player.connect(selected, error -> {
                connecting = null;
                if (!error.isEmpty()) selected.leave();
                finish(error);
            });
        } catch (IOException | RuntimeException e) {
            sessions.endCurrentSession(false);
            finish("This Cast device needs a reachable IPv4 address on the phone’s Wi-Fi network.");
        }
    }
    @Override public void onSessionStartFailed(CastSession session, int reason) { finish("Could not connect to the Cast device."); }
    @Override public void onSessionResumed(CastSession session, boolean suspended) { onSessionStarted(session, ""); }
    @Override public void onSessionResumeFailed(CastSession session, int reason) { onSessionStartFailed(session, reason); }
    @Override public void onSessionEnded(CastSession session, int reason) {}
    @Override public void onSessionEnding(CastSession session) {}
    @Override public void onSessionSuspended(CastSession session, int reason) {}
    @Override public void onSessionResuming(CastSession session, String id) {}
}
