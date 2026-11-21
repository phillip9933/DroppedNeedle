package app.droppedneedle.mobile;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.audiofx.Equalizer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

@RunWith(AndroidJUnit4.class)
public final class PlaybackEqualizerTest {
    @Test public void sessionEffectReadsBackCustomBandsAndRestoresOnAnotherSession() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences isolated = app.getSharedPreferences("instrumentation_equalizer", Context.MODE_PRIVATE);
        isolated.edit().clear().commit();
        Context context = new ContextWrapper(app) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return isolated; }
        };
        AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        int first = audio.generateAudioSessionId();
        int second = audio.generateAudioSessionId();
        PlaybackEqualizer eq = new PlaybackEqualizer(context);
        try {
            assertFalse("Session zero must never create a global output effect", eq.read().getBoolean("available"));
            eq.setSession(first);
            JSObject current = eq.read();
            assumeTrue("This Android output does not implement a controllable equalizer", current.getBoolean("available"));
            JSONArray centers = current.getJSONArray("centers");
            JSONArray levels = current.getJSONArray("levels");
            int gain = Math.min(current.getInt("maximum"), 500);
            assertTrue(centers.length() > 0);
            levels.put(0, gain);
            assertTrue(eq.configure(true, "", centers, levels).getBoolean("enabled"));
            Equalizer observer = new Equalizer(-1, first);
            try {
                assertTrue(observer.getEnabled());
                assertEquals(gain, observer.getBandLevel((short) 0));
            } finally { observer.release(); }
            eq.release();
            eq = new PlaybackEqualizer(context);
            eq.setSession(second);
            JSObject restored = eq.read();
            assertTrue(restored.getBoolean("enabled"));
            assertEquals(gain, restored.getJSONArray("levels").getInt(0));
            eq.route("headphones","Headphones");
            assertFalse(eq.read().getJSONObject("output").getBoolean("assigned"));
            eq.assign("headphones",true);
            JSONArray headphones = new JSONArray(levels.toString());
            headphones.put(0,0);
            eq.configure(true,"Headphones",centers,headphones,"headphones");
            eq.route("speaker","Phone speaker");
            assertEquals(gain,eq.read().getJSONArray("levels").getInt(0));
            try {
                eq.configure(false,"stale",centers,headphones,"headphones");
                fail("Routing changed while editing the headphones.");
            } catch (IllegalArgumentException expected) {}
            eq.route("headphones","Headphones");
            assertEquals("Headphones",eq.read().getString("preset"));
            assertEquals(0,eq.read().getJSONArray("levels").getInt(0));
            eq.assign("headphones",false);
            assertEquals(gain,eq.read().getJSONArray("levels").getInt(0));
            assertFalse(eq.configure(false, "", centers, levels).getBoolean("enabled"));
        } finally {
            eq.release();
            isolated.edit().clear().commit();
        }
    }
}
