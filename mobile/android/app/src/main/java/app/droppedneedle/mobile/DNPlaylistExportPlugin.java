package app.droppedneedle.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.OkHttpClient;

@CapacitorPlugin(name = "DNPlaylistExport")
public final class DNPlaylistExportPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = PlaylistExportFile.network().build();
    private File dir;
    private PlaylistExportFile active;
    private String pickerId;
    private CancellationSignal writing;

    @Override
    public void load() {
        dir = new File(getContext().getCacheDir(), "playlist-exports");
        io.execute(() -> PlaylistExportFile.cleanAbandoned(dir));
    }
    @PluginMethod
    public synchronized void prepare(PluginCall call) {
        if (active != null) {
            call.reject("Finish or cancel the open export before starting another.");
            return;
        }
        final PlaylistExportFile file;
        try {
            file = new PlaylistExportFile(dir, call.getString("id"), call.getString("format"));
        } catch (IllegalArgumentException e) {
            call.reject("Choose a valid playlist export and try again.");
            return;
        }
        active = file;
        io.execute(() -> {
            try {
                file.prepare(http, call.getString("serverUrl"), call.getString("url"), call.getString("token"));
                JSObject result = new JSObject();
                if (file.disposition != null)
                    result.put("contentDisposition", file.disposition);
                if (file.skipped != null)
                    result.put("skippedTracks", file.skipped);
                call.resolve(result);
            } catch (Exception e) {
                finish(file);
                if (e instanceof PlaylistExportFile.Failure problem)
                    call.reject(problem.getMessage(), problem.code);
                else if (e instanceof IllegalArgumentException)
                    call.reject("Invalid export address or session. Reconnect to DroppedNeedle.");
                else
                    call.reject("Could not prepare the playlist. Check the DN connection and available device storage, "
                                + "then try again.");
            }
        });
    }
    static Intent destination(String mime, String filename) {
        return new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime)
            .putExtra(Intent.EXTRA_TITLE, filename);
    }
    @PluginMethod
    public synchronized void save(PluginCall call) {
        final PlaylistExportFile file = lookup(call);
        if (file == null || !file.isReady()) {
            call.reject("The prepared file expired. Prepare the playlist again.");
            return;
        }
        if (pickerId != null || writing != null) {
            call.reject("Close the open Files picker and try again.");
            return;
        }
        final String name;
        try {
            name = file.filename(call.getString("filename"));
        } catch (IOException e) {
            call.reject(e.getMessage());
            return;
        }
        pickerId = file.id;
        getActivity().runOnUiThread(() -> {
            synchronized (this) {
                if (active != file) {
                    pickerId = null;
                    call.reject("Export cancelled.");
                    return;
                }
            }
            try {
                startActivityForResult(call, destination(file.mime, name), "documentChosen");
            } catch (RuntimeException e) {
                synchronized (this) {
                    pickerId = null;
                }
                finish(file);
                call.reject("No document picker could open. Enable a Files provider and try again.");
            }
        });
    }
    @ActivityCallback
    private synchronized void documentChosen(PluginCall call, ActivityResult result) {
        pickerId = null;
        if (call == null)
            return;
        PlaylistExportFile file = lookup(call);
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            finish(file);
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        if (file == null || !file.isReady()) {
            call.reject("The prepared export expired. Reopen the playlist and try again.");
            return;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || !"content".equals(uri.getScheme())) {
            finish(file);
            call.reject("Files did not return a writable document. Choose another destination.");
            return;
        }
        CancellationSignal signal = new CancellationSignal();
        writing = signal;
        io.execute(() -> {
            try {
                writeDocument(getContext().getContentResolver(), uri, signal, file);
                finish(file);
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception e) {
                finish(file);
                call.reject("Could not finish writing the playlist. Check the destination for an incomplete file, then "
                            + "choose a writable location with sufficient space.");
            } finally {
                synchronized (this) {
                    if (writing == signal)
                        writing = null;
                }
            }
        });
    }
    static void writeDocument(ContentResolver resolver, Uri uri, CancellationSignal signal, PlaylistExportFile file)
        throws IOException {
        if (uri == null || !"content".equals(uri.getScheme()))
            throw new IOException("Choose a document in Files.");
        ParcelFileDescriptor fd = resolver.openFileDescriptor(uri, "wt", signal);
        if (fd == null)
            throw new IOException("No writable document was returned.");
        try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(fd)) {
            file.copyTo(out);
        }
    }
    private synchronized PlaylistExportFile lookup(PluginCall call) {
        return active != null && active.id.equals(call.getString("id")) ? active : null;
    }
    private synchronized void finish(PlaylistExportFile file) {
        if (file == null)
            return;
        file.discard();
        if (active == file)
            active = null;
    }
    @PluginMethod
    public synchronized void discard(PluginCall call) {
        PlaylistExportFile file = lookup(call);
        if (file != null) {
            if (writing != null)
                writing.cancel();
            finish(file);
        }
        call.resolve();
    }
    @Override
    protected synchronized void handleOnDestroy() {
        if (writing != null)
            writing.cancel();
        finish(active);
        io.shutdownNow();
    }
}
