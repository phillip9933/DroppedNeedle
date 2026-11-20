package app.droppedneedle.mobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import java.util.concurrent.atomic.AtomicBoolean;

final class DownloadNotificationRoute {
    private static final String ALIAS = "app.droppedneedle.mobile.DownloadsNotification";
    private static final String ACTION = "app.droppedneedle.mobile.OPEN_DOWNLOADS";
    private static final String STATE = "dn.openDownloads";
    private final AtomicBoolean pending = new AtomicBoolean();

    static Intent intent(Context context) {
        return new Intent(ACTION).setComponent(new ComponentName(context, ALIAS))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }
    boolean receive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction()) || intent.getData() != null
                || !new ComponentName(context, ALIAS).equals(intent.getComponent())
                || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        pending.set(true);
        return true;
    }
    void restore(Context context, Intent initial, Bundle state) {
        if (state != null && state.containsKey(STATE)) pending.set(state.getBoolean(STATE));
        else receive(context, initial);
    }
    void save(Bundle state) { state.putBoolean(STATE, pending.get()); }
    boolean take() { return pending.getAndSet(false); }
}
