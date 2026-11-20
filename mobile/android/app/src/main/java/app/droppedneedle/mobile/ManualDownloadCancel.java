package app.droppedneedle.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

public final class ManualDownloadCancel extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Uri data = intent.getData();
        if (data == null || !"dn-download".equals(data.getScheme()) || !"cancel".equals(data.getAuthority())) return;
        String owner = data.getLastPathSegment();
        if (owner == null || !owner.matches("[a-f0-9]{64}")) return;
        PendingResult result = goAsync();
        new Thread(() -> {
            try { ManualDownloads.get(context).cancel(owner); }
            finally { result.finish(); }
        }, "DN-download-cancel").start();
    }
}
