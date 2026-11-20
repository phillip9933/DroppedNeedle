package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class DownloadNotificationSettingsTest {
    private final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test public void opensTheControlThatCanEnableDownloadNotifications() {
        check(35, false, NotificationManager.IMPORTANCE_LOW, "appOff", Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        check(35, false, null, "appOff", Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        check(26, true, null, "appOn", Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        check(26, true, NotificationManager.IMPORTANCE_NONE, "channelOff", Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
        check(34, true, NotificationManager.IMPORTANCE_LOW, "on", Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
        check(25, false, null, "appOff", Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        check(24, true, null, "on", Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    }

    private void check(int sdk, boolean appEnabled, Integer importance, String state, String action) {
        DownloadNotificationSettings settings = new DownloadNotificationSettings(sdk, appEnabled, importance);
        assertEquals(state, settings.state);
        Intent destination = settings.destination(app.getPackageName());
        assertEquals(action, destination.getAction());
        if (action.equals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)) {
            assertEquals("package:" + app.getPackageName(), destination.getDataString());
            assertNull(destination.getExtras());
        } else {
            assertNull(destination.getData());
            assertEquals(app.getPackageName(), destination.getStringExtra(Settings.EXTRA_APP_PACKAGE));
            boolean channel = action.equals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            assertEquals(channel ? ManualDownloadScheduler.CHANNEL : null, destination.getStringExtra(Settings.EXTRA_CHANNEL_ID));
            assertEquals(channel ? 2 : 1, destination.getExtras().size());
        }
    }

    @Test public void readingReflectsTheCurrentSystemWithoutCreatingOrChangingTheChannel() {
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        String expected = manager.areNotificationsEnabled() ? "on" : "appOff";
        NotificationChannel before = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            before = manager.getNotificationChannel(ManualDownloadScheduler.CHANNEL);
            if (manager.areNotificationsEnabled()) {
                if (before == null) expected = "appOn";
                else if (before.getImportance() == NotificationManager.IMPORTANCE_NONE) expected = "channelOff";
            }
        }
        assertEquals(expected, DownloadNotificationSettings.read(app).state);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            assertEquals(before, manager.getNotificationChannel(ManualDownloadScheduler.CHANNEL));
    }
}
