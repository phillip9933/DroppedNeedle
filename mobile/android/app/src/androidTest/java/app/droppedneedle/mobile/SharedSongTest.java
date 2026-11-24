package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class SharedSongTest {
    @Test public void receivesTextFromTheSystemChooserOnceIncludingAcrossRecreation() {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String link = "https://music.apple.com/jp/song/example/123";
        Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .setPackage(app.getPackageName()).putExtra(Intent.EXTRA_TEXT, link);
        assertNotNull(intent.resolveActivity(app.getPackageManager()));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
            scenario.recreate();
            scenario.onActivity(activity -> {
                assertEquals(link, activity.takeSharedSong());
                assertNull(activity.takeSharedSong());
                activity.onNewIntent(new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_TEXT, link));
                assertNull(activity.takeSharedSong());
                activity.onNewIntent(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Song " + link));
                assertEquals("Song " + link, activity.takeSharedSong());
            });
            scenario.recreate();
            scenario.onActivity(activity -> assertNull(activity.takeSharedSong()));
        }
    }
}
