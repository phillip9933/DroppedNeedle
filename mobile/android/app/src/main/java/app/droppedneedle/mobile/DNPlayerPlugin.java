package app.droppedneedle.mobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "DNPlayer")
public final class DNPlayerPlugin extends Plugin {
    private PlaybackService service;
    private boolean bound;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayList<Runnable> waiting = new ArrayList<>();
    private final HashMap<String, DlnaRenderer> outputs = new HashMap<>();
    private final ExecutorService discovery = Executors.newSingleThreadExecutor();
    private boolean looking;
    private boolean destroyed;
    private GoogleCastPicker googlePicker;

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
            p.setQueue(call.getString("serverUrl"), call.getString("token"), call.getString("userId"), call.getArray("tracks"),
                    call.getInt("index", -1), call.getString("placement"), call.getObject("profiles"));
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
        execute(call, p -> p.restore(call.getString("serverUrl"), call.getString("token"), call.getString("userId"), call.getObject("profiles"),
                () -> call.resolve(p.snapshot()), () -> call.reject("The playback session changed.")));
    }

    @PluginMethod public void setStreamProfiles(PluginCall call) {
        try {
            StreamProfiles profiles = new StreamProfiles(getContext(), call.getString("serverUrl"),
                    call.getString("userId"), () -> StreamProfiles.active(getContext()));
            profiles.set(call.getObject("wifi"), call.getObject("cellular"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save streaming profiles for this account.");
        }
    }

    @PluginMethod public void getStreamNetwork(PluginCall call) {
        JSObject result = new JSObject();
        result.put("network", StreamProfiles.active(getContext()).value);
        call.resolve(result);
    }

    @PluginMethod public void getTrackFade(PluginCall call) {
        execute(call, p -> {
            JSObject result = new JSObject();
            result.put("milliseconds", p.fades().length());
            call.resolve(result);
        });
    }

    @PluginMethod public void setTrackFade(PluginCall call) {
        execute(call, p -> {
            p.fades().configure(call.getInt("milliseconds", 0));
            call.resolve();
        });
    }

    @PluginMethod public void getEqualizer(PluginCall call) {
        execute(call, p -> call.resolve(p.equalizer().read()));
    }

    @PluginMethod public void setEqualizer(PluginCall call) {
        execute(call, p -> call.resolve(p.equalizer().configure(call.getBoolean("enabled", false),
                call.getString("preset"), call.getArray("centers"), call.getArray("levels"))));
    }

    @PluginMethod public void getState(PluginCall call) { execute(call, p -> call.resolve(p.snapshot())); }

    private static JSObject outputState(RoutedPlayer player) {
        JSObject result = new JSObject();
        result.put("destination", player.destination());
        return result;
    }

    @PluginMethod public void outputState(PluginCall call) {
        execute(call, p -> call.resolve(outputState(p.output())));
    }

    @PluginMethod public void findOutputs(PluginCall call) {
        main.post(() -> {
            if (looking || destroyed) { call.reject("A speaker search is already in progress."); return; }
            looking = true;
            outputs.clear();
            discovery.execute(() -> {
                try {
                    List<DlnaRenderer> found = DlnaDiscovery.find(getContext());
                    main.post(() -> {
                        looking = false;
                        if (destroyed) return;
                        JSArray devices = new JSArray();
                        for (DlnaRenderer device : found) {
                            String id = UUID.randomUUID().toString();
                            outputs.put(id, device);
                            JSObject entry = new JSObject();
                            entry.put("id", id);
                            entry.put("name", device.name);
                            devices.put(entry);
                        }
                        JSObject result = new JSObject();
                        result.put("devices", devices);
                        call.resolve(result);
                    });
                } catch (Exception e) {
                    main.post(() -> {
                        looking = false;
                        if (!destroyed) call.reject("Could not search this network. Connect to Wi-Fi and try again.");
                    });
                }
            });
        });
    }

    @PluginMethod public void castTo(PluginCall call) {
        execute(call, p -> {
            DlnaRenderer device = outputs.get(call.getString("id"));
            if (device == null) { call.reject("Find the speaker again before connecting."); return; }
            p.output().connect(device, error -> {
                if (error.isEmpty()) call.resolve(outputState(p.output()));
                else call.reject(error);
            });
        });
    }

    @PluginMethod public void stopCasting(PluginCall call) {
        execute(call, p -> { p.output().disconnect(true, ""); call.resolve(outputState(p.output())); });
    }

    @PluginMethod public void googleCast(PluginCall call) {
        execute(call, p -> {
            if (googlePicker != null || !p.output().destination().isEmpty()) {
                call.reject("Stop the current cast before choosing a new receiver.");
                return;
            }
            googlePicker = new GoogleCastPicker(getActivity(), p.output(), error -> {
                googlePicker = null;
                if (error.isEmpty()) call.resolve(outputState(p.output())); else call.reject(error);
            });
            googlePicker.show(discovery);
        });
    }

    @PluginMethod public void castScreen(PluginCall call) {
        main.post(() -> {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_CAST_SETTINGS));
                call.resolve();
            } catch (android.content.ActivityNotFoundException e) {
                call.reject("Cast display settings are unavailable on this phone.");
            }
        });
    }

    @Override protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            if (googlePicker != null) googlePicker.cancel();
            outputs.clear();
            discovery.shutdownNow();
            disconnect();
        });
        super.handleOnDestroy();
    }
}
