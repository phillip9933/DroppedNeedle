package app.droppedneedle.mobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

@CapacitorPlugin(name = "DNPlayer")
public final class DNPlayerPlugin extends Plugin {
    private PlaybackService service;
    private boolean bound;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayList<Runnable> waiting = new ArrayList<>();

    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((PlaybackService.LocalBinder) binder).service();
            flush();
        }
        @Override public void onServiceDisconnected(ComponentName name) { service = null; }
        @Override public void onBindingDied(ComponentName name) { disconnect(); }
        @Override public void onNullBinding(ComponentName name) { disconnect(); }
    };

    private void flush() {
        for (Runnable run : waiting) run.run();
        waiting.clear();
    }

    private void disconnect() {
        if (bound) getContext().unbindService(connection);
        bound = false;
        service = null;
        flush();
    }

    private interface Action { void run(PlaybackService playback) throws Exception; }

    private void execute(PluginCall call, Action action) {
        main.post(() -> {
            Runnable run = () -> {
                if (service == null) {
                    call.reject("The playback service is unavailable.");
                    return;
                }
                try {
                    action.run(service);
                } catch (Exception e) {
                    call.reject("DroppedNeedle could not complete this playback command.");
                }
            };
            if (service != null) { run.run(); return; }
            waiting.add(run);
            if (!bound) {
                Intent intent = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.LOCAL_BIND);
                bound = getContext().bindService(intent, connection, Context.BIND_AUTO_CREATE);
                if (!bound) flush();
            }
        });
    }

    @PluginMethod public void setQueue(PluginCall call) {
        execute(call, p -> {
            p.setQueue(call.getString("serverUrl"), call.getString("token"), call.getArray("tracks"),
                    call.getInt("index", -1), call.getString("placement"));
            JSObject result = p.snapshot();
            p.afterWrite(() -> call.resolve(result));
        });
    }

    @PluginMethod public void command(PluginCall call) {
        execute(call, p -> {
            p.command(call.getString("action", ""), call.getDouble("value", -1d), call.getInt("to", -1));
            JSObject result = p.snapshot();
            p.afterWrite(() -> call.resolve(result));
        });
    }

    @PluginMethod public void restore(PluginCall call) {
        execute(call, p -> p.restore(call.getString("serverUrl"), call.getString("token"),
                () -> call.resolve(p.snapshot()), () -> call.reject("The playback session changed.")));
    }

    @PluginMethod public void getEqualizer(PluginCall call) {
        execute(call, p -> call.resolve(p.equalizer().read()));
    }

    @PluginMethod public void setEqualizer(PluginCall call) {
        execute(call, p -> call.resolve(p.equalizer().configure(call.getBoolean("enabled", false),
                call.getString("preset"), call.getArray("centers"), call.getArray("levels"))));
    }

    @PluginMethod public void getState(PluginCall call) { execute(call, p -> call.resolve(p.snapshot())); }

    @Override protected void handleOnDestroy() {
        main.post(this::disconnect);
        super.handleOnDestroy();
    }
}
