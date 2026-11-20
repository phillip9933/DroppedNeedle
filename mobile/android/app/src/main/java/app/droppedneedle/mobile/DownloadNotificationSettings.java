package app.droppedneedle.mobile;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

final class DownloadNotificationSettings {
    final String state;
    private final String action;

    DownloadNotificationSettings(int sdk, boolean appEnabled, Integer channelImportance) {
        if (sdk < Build.VERSION_CODES.O) {
            state = appEnabled ? "on" : "appOff";
            action = Settings.ACTION_APPLICATION_DETAILS_SETTINGS;
        } else if (!appEnabled || channelImportance == null) {
            state = appEnabled ? "appOn" : "appOff";
            action = Settings.ACTION_APP_NOTIFICATION_SETTINGS;
        } else {
            state = channelImportance == NotificationManager.IMPORTANCE_NONE ? "channelOff" : "on";
            action = Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS;
        }
    }

    static DownloadNotificationSettings read(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        Integer importance = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(ManualDownloadScheduler.CHANNEL);
            if (channel != null) importance = channel.getImportance();
        }
        return new DownloadNotificationSettings(Build.VERSION.SDK_INT, manager.areNotificationsEnabled(), importance);
    }

    Intent destination(String packageName) {
        if (Settings.ACTION_APPLICATION_DETAILS_SETTINGS.equals(action)) return details(packageName);
        Intent intent = new Intent(action).putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
        if (Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS.equals(action))
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, ManualDownloadScheduler.CHANNEL);
        return intent;
    }

    void open(Activity activity) {
        String packageName = activity.getPackageName();
        try {
            activity.startActivity(destination(packageName));
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            if (Settings.ACTION_APPLICATION_DETAILS_SETTINGS.equals(action)) throw unavailable;
            activity.startActivity(details(packageName));
        }
    }

    private static Intent details(String packageName) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null));
    }
}
