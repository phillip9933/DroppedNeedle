package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class DownloadNotificationRouteTest {
    private final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test public void notificationUsesOnlyThePrivateOfflineDestination() throws Exception {
        Intent target = DownloadNotificationRoute.intent(app);
        ActivityInfo alias = app.getPackageManager().getActivityInfo(target.getComponent(), 0);
        assertFalse(alias.exported);
        assertEquals(MainActivity.class.getName(), alias.targetActivity);
        assertNull(target.getData());
        assertNull(target.getExtras());
        Notification first = ManualDownloadScheduler.notification(app, "synthetic-one", 1, 5);
        Notification second = ManualDownloadScheduler.notification(app, "synthetic-two", 0, 3);
        assertEquals(first.contentIntent, second.contentIntent);
        assertEquals(PendingIntent.getActivity(app, 0, target, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE), first.contentIntent);
        if (Build.VERSION.SDK_INT >= 31) assertTrue(first.contentIntent.isImmutable());
    }

    @Test public void coldWarmAndRestoredTapsAreConsumedOnceAndLeaveOtherIntentsAlone() {
        Intent tap = DownloadNotificationRoute.intent(app);
        DownloadNotificationRoute route = new DownloadNotificationRoute();
        route.restore(app, tap, null);
        Bundle beforeSignIn = new Bundle();
        route.save(beforeSignIn);
        route = new DownloadNotificationRoute();
        route.restore(app, tap, beforeSignIn);
        assertTrue(route.take());
        assertFalse(route.take());
        Bundle afterSignIn = new Bundle();
        route.save(afterSignIn);
        route.restore(app, tap, afterSignIn);
        assertFalse(route.take());
        assertFalse(route.receive(app, new Intent(tap).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)));
        assertFalse(route.receive(app, new Intent(Intent.ACTION_MAIN)));
        assertFalse(route.receive(app, new Intent(tap).setComponent(new ComponentName(app, MainActivity.class))));
        Uri approval = Uri.parse("app.droppedneedle.mobile://connect/callback#fixture");
        Intent browser = new Intent(Intent.ACTION_VIEW, approval).setComponent(new ComponentName(app, MainActivity.class));
        assertFalse(route.receive(app, browser));
        assertEquals(approval, browser.getData());
        assertFalse(route.take());
        assertTrue(route.receive(app, tap));
        assertTrue(route.receive(app, tap));
        assertTrue(route.take());
        assertFalse(route.take());
    }

    @Test public void notificationTapReusesTheRunningActivity() throws Exception {
        try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
            takeNextTap(screen);
        }
    }
    @Test public void anotherTapWorksWhenTheFirstTapCreatedTheActivity() throws Exception {
        Intent first = DownloadNotificationRoute.intent(app);
        try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(first)) {
            screen.onActivity(activity -> assertEquals(first.getComponent(), activity.getIntent().getComponent()));
            takeNextTap(screen);
        }
    }
    private void takeNextTap(ActivityScenario<MainActivity> screen) throws Exception {
        // The native fixture consumes the route itself, independent of the app's signed-in state.
        screen.onActivity(activity -> {
            activity.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
            activity.takeDownloadNotification();
        });
        ManualDownloadScheduler.notification(app, "synthetic", 1, 2).contentIntent.send();
        AtomicBoolean delivered = new AtomicBoolean();
        long end = SystemClock.elapsedRealtime() + 8000;
        while (!delivered.get() && SystemClock.elapsedRealtime() < end) {
            screen.onActivity(activity -> delivered.set(activity.takeDownloadNotification()));
            if (!delivered.get()) SystemClock.sleep(50);
        }
        assertTrue("The notification did not reach the running activity", delivered.get());
        screen.onActivity(activity -> assertFalse(activity.takeDownloadNotification()));
    }
}
