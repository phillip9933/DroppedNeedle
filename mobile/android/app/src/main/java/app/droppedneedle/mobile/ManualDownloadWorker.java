package app.droppedneedle.mobile;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Android 7–13 run long manual transfers as foreground work. */
public final class ManualDownloadWorker extends Worker {
    private final ManualDownloads.Run run;
    public ManualDownloadWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
        run = new ManualDownloads.Run(getInputData().getString(ManualDownloadScheduler.OWNER));
    }
    @NonNull @Override public Result doWork() {
        if (run.owner == null) return Result.failure();
        Context ctx = getApplicationContext();
        try {
            setForegroundAsync(new ForegroundInfo(ManualDownloadScheduler.NOTIFICATION,
                    ManualDownloadScheduler.notification(ctx, run.owner, 0, 0))).get();
        } catch (Exception backgroundRestricted) {
            if (isStopped()) return Result.retry();
            // Android 12–13 may decline foreground promotion after a network wait.
            // An ordinary worker can still commit complete songs within its time slice.
        }
        boolean retry = ManualDownloads.get(ctx).drain(run, ManualDownloads.HTTP, (done,total) ->
                setForegroundAsync(new ForegroundInfo(ManualDownloadScheduler.NOTIFICATION,
                        ManualDownloadScheduler.notification(ctx, run.owner, done, total))));
        return retry ? Result.retry() : Result.success();
    }
    @Override public void onStopped() { run.stop(); }
}
