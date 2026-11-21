package app.droppedneedle.mobile;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;

public final class PinnedDownloadWorker extends Worker {
    private static final String WORK = "dn-pinned-collections";
    private static String scheduled;
    private volatile PinnedDownloads running;
    public PinnedDownloadWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static synchronized void schedule(Context context, OfflineStore store) throws JSONException {
        boolean enabled = !store.offlineOnly() && store.effectivePins().length() > 0;
        String policy = store.account + "/" + enabled + "/" + store.unmeteredOnly();
        if (policy.equals(scheduled))
            return;
        HeadsetAccount account = HeadsetAccount.read(context);
        if (account == null
                || !store.account.equals(
                        OfflineStore.forUser(context, account.server.toString(), account.userId).account))
            return;
        WorkManager jobs = WorkManager.getInstance(context);
        if (enabled) {
            PeriodicWorkRequest work =
                    new PeriodicWorkRequest.Builder(PinnedDownloadWorker.class, 6, TimeUnit.HOURS)
                            .setInitialDelay(6, TimeUnit.HOURS)
                            .setConstraints(new Constraints.Builder()
                                            .setRequiredNetworkType(store.unmeteredOnly() ? NetworkType.UNMETERED
                                                                                          : NetworkType.CONNECTED)
                                            .build())
                            .setInputData(new Data.Builder().putString("owner", store.account).build())
                            .build();
            jobs.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, work);
        } else
            jobs.cancelUniqueWork(WORK);
        scheduled = policy;
    }
    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        HeadsetAccount owner = HeadsetAccount.read(context);
        if (owner == null)
            return Result.success();
        OfflineStore store = OfflineStore.forUser(context, owner.server.toString(), owner.userId);
        if (!store.account.equals(getInputData().getString("owner")) || store.offlineOnly())
            return Result.success();
        if (!store.permittedNetwork())
            return Result.retry();
        running = new PinnedDownloads(
                context, store, owner, ManualDownloads.HTTP, () -> HeadsetAccount.read(context), this::isStopped);
        try {
            running.sync();
            return Result.success();
        } catch (Exception unavailable) {
            return Result.retry();
        } finally {
            running = null;
        }
    }
    @Override
    public void onStopped() {
        PinnedDownloads task = running;
        if (task != null)
            task.cancel();
    }
}
