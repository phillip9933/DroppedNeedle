package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.CancellationSignal;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlaylistExportDocumentTest {
    @Test public void cancelledLayoutPickerReturnsWithoutWriting() {
        java.util.concurrent.atomic.AtomicReference<JSObject> answer = new java.util.concurrent.atomic.AtomicReference<>();
        PluginCall call = new PluginCall(null, "DNPlaylistExport", "fixture", "saveLayout", new JSObject()) {
            @Override public void resolve(JSObject data) { answer.set(data); }
        };
        new DNPlaylistExportPlugin().documentChosen(call, new ActivityResult(Activity.RESULT_CANCELED, null));
        assertNotNull(answer.get());
        assertEquals(Boolean.FALSE, answer.get().opt("saved"));
    }

    @Test public void layoutUsesJsonDestinationAndWritesOnlyTheBoundedUtf8Document() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent picker = DNPlaylistExportPlugin.destination("application/json", DNPlaylistExportPlugin.LAYOUT_NAME);
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, picker.getAction());
        assertEquals("application/json", picker.getType());
        assertEquals("otohari-player-layout.json", picker.getStringExtra(Intent.EXTRA_TITLE));
        assertEquals(1, picker.getExtras().size());
        String layout = "{\"format\":\"droppedneedle-player-layout\",\"version\":1,\"sections\":[{\"id\":\"player-toggle\",\"title\":\"音楽\",\"preview\":true}]}";
        assertArrayEquals(layout.getBytes(StandardCharsets.UTF_8), DNPlaylistExportPlugin.layoutBytes(layout));
        char[] tooLarge = new char[22000];
        java.util.Arrays.fill(tooLarge, '界');
        assertThrows(java.io.IOException.class, () -> DNPlaylistExportPlugin.layoutBytes(new String(tooLarge)));
        File output = File.createTempFile("layout-test-", ".json", context.getCacheDir());
        try {
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", output);
            try (java.io.FileOutputStream previous = new java.io.FileOutputStream(output)) { previous.write(new byte[1024]); }
            DNPlaylistExportPlugin.writeDocument(context.getContentResolver(), uri, new CancellationSignal(),
                    stream -> stream.write(DNPlaylistExportPlugin.layoutBytes(layout)));
            byte[] bytes = new byte[(int) output.length()];
            try (java.io.DataInputStream in = new java.io.DataInputStream(new FileInputStream(output))) { in.readFully(bytes); }
            assertEquals(layout, new String(bytes, StandardCharsets.UTF_8));
        } finally { output.delete(); }
    }

    @Test
    public void pickerContainsOnlySuggestedNameAndCopiesUtf8ToTheChosenUri() throws Exception {
        Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent picker = DNPlaylistExportPlugin.destination("audio/x-mpegurl", "音.m3u8");
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, picker.getAction());
        assertTrue(picker.hasCategory(Intent.CATEGORY_OPENABLE));
        assertEquals("audio/x-mpegurl", picker.getType());
        assertEquals("音.m3u8", picker.getStringExtra(Intent.EXTRA_TITLE));
        assertEquals(1, picker.getExtras().size());
        assertNull(picker.getData());
        assertNull(picker.getClipData());
        File dir = new File(ctx.getCacheDir(), "export-test-" + java.util.UUID.randomUUID());
        assertTrue(dir.mkdir());
        File output = new File(dir, "chosen.m3u8");
        assertTrue(output.createNewFile());
        String body = "#EXTM3U\n#PLAYLIST:音\nMusic/枝.flac\n";
        PlaylistExportFile stage = new PlaylistExportFile(dir, java.util.UUID.randomUUID().toString(), "m3u8");
        try {
            OkHttpClient http = PlaylistExportFile.network()
                                    .addInterceptor(c
                                        -> new Response.Builder()
                                            .code(200)
                                            .message("OK")
                                            .protocol(Protocol.HTTP_1_1)
                                            .request(c.request())
                                            .header("Content-Type", "audio/x-mpegurl")
                                            .body(ResponseBody.create(MediaType.get("audio/x-mpegurl"), body))
                                            .build())
                                    .build();
            stage.prepare(http, "https://fixture.example",
                "https://fixture.example/api/v3/playlists/example/export?format=m3u8", "fixture");
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", output);
            DNPlaylistExportPlugin.writeDocument(ctx.getContentResolver(), uri, new CancellationSignal(), stage::copyTo);
            byte[] data = new byte[(int) output.length()];
            try (java.io.DataInputStream in = new java.io.DataInputStream(new FileInputStream(output))) {
                in.readFully(data);
            }
            assertEquals(body, new String(data, StandardCharsets.UTF_8));
        } finally {
            stage.discard();
            output.delete();
            dir.delete();
        }
    }
}
