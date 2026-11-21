package app.droppedneedle.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.function.BooleanSupplier;
import okhttp3.Call;
import org.json.JSONObject;

public final class DownloadCompanionWorker extends Worker {
    private static final Set<String> scheduled = new HashSet<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private volatile Call active;
    public DownloadCompanionWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }
    static synchronized void schedule(Context context, OfflineStore store) {
        if (!store.completeDownloads() || store.offlineOnly() || !scheduled.add(store.account))
            return;
        // Many audio files may complete together. Coalesce their durable requests into one job.
        main.postDelayed(() -> {
            synchronized (DownloadCompanionWorker.class) {
                scheduled.remove(store.account);
            }
            if (store.offlineOnly() || !store.completeDownloads())
                return;
            OneTimeWorkRequest work =
                    new OneTimeWorkRequest.Builder(DownloadCompanionWorker.class)
                            .setConstraints(new Constraints.Builder()
                                            .setRequiredNetworkType(store.unmeteredOnly() ? NetworkType.UNMETERED
                                                                                          : NetworkType.CONNECTED)
                                            .build())
                            .setInputData(new Data.Builder().putString("owner", store.account).build())
                            .build();
            WorkManager.getInstance(context.getApplicationContext())
                    .enqueueUniqueWork("dn-companions-" + store.account, ExistingWorkPolicy.KEEP, work);
        }, 750);
    }
    @Override
    @NonNull
    public Result doWork() {
        Context context = getApplicationContext();
        HeadsetAccount owner = HeadsetAccount.read(context);
        if (owner == null)
            return Result.success();
        OfflineStore store = OfflineStore.forUser(context, owner.server.toString(), owner.userId);
        if (store == null || !store.account.equals(getInputData().getString("owner")))
            return Result.success();
        BooleanSupplier allowed = ()
                -> !isStopped() && store.completeDownloads() && !store.offlineOnly() && store.permittedNetwork()
                && owner.matches(HeadsetAccount.read(context));
        try {
            while (allowed.getAsBoolean()) {
                var pending = store.pendingCompanions();
                if (pending.isEmpty())
                    break;
                boolean retry = false;
                for (String id : pending) {
                    if (!allowed.getAsBoolean())
                        return Result.success();
                    long revision = store.itemRevision(id);
                    JSONObject track = store.savedTrack(id);
                    boolean ready = track == null || OfflineCompanions.prepare(store, owner, track, request -> {
                        if (!allowed.getAsBoolean())
                            throw new IOException("Download paused.");
                        active = ManualDownloads.HTTP.newCall(request);
                        if (isStopped())
                            active.cancel();
                        return active.execute();
                    }, allowed, false);
                    if (!allowed.getAsBoolean())
                        return Result.success();
                    if (ready || getRunAttemptCount() >= 3)
                        store.completedCompanions(id, revision);
                    else
                        retry = true;
                }
                if (retry)
                    return Result.retry();
            }
            return Result.success();
        } catch (IOException | RuntimeException unavailable) {
            return Result.retry();
        } finally {
            active = null;
        }
    }
    @Override
    public void onStopped() {
        Call call = active;
        if (call != null)
            call.cancel();
        super.onStopped();
    }
}
