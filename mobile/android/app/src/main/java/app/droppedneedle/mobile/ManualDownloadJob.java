package app.droppedneedle.mobile;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.net.Network;
import androidx.annotation.RequiresApi;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.OkHttpClient;

/** Android 14+ can run a user-initiated transfer outside regular job quotas. */
@RequiresApi(34)
public final class ManualDownloadJob extends JobService {
    static volatile int runningId = -1;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<Integer, ManualDownloads.Run> runs = new HashMap<>();

    @Override public boolean onStartJob(JobParameters parameters) {
        String owner = parameters.getExtras().getString(ManualDownloadScheduler.OWNER);
        if (owner == null) return false;
        ManualDownloads.Run run = new ManualDownloads.Run(owner);
        runs.put(parameters.getJobId(), run);
        if (parameters.isUserInitiatedJob()) notify(parameters, owner, 0, 0);
        worker.execute(() -> {
            runningId = parameters.getJobId();
            Network network = parameters.getNetwork();
            OkHttpClient http = network == null ? ManualDownloads.HTTP : ManualDownloads.HTTP.newBuilder()
                    .socketFactory(network.getSocketFactory()).dns(name -> Arrays.asList(network.getAllByName(name))).build();
            boolean retry = ManualDownloads.get(this).drain(run, http, (done,total) -> {
                if (!run.stopped && parameters.isUserInitiatedJob()) notify(parameters, owner, done, total);
            });
            getMainExecutor().execute(() -> {
                if (runs.remove(parameters.getJobId(), run)) jobFinished(parameters, retry);
            });
            runningId = -1;
        });
        return true;
    }
    private void notify(JobParameters parameters, String owner, int done, int total) {
        setNotification(parameters, ManualDownloadScheduler.NOTIFICATION,
                ManualDownloadScheduler.notification(this, owner, done, total), JOB_END_NOTIFICATION_POLICY_REMOVE);
    }
    @Override public boolean onStopJob(JobParameters parameters) {
        ManualDownloads.Run run = runs.remove(parameters.getJobId());
        if (run != null) run.stop();
        return parameters.getStopReason() != JobParameters.STOP_REASON_CANCELLED_BY_APP
                && parameters.getStopReason() != JobParameters.STOP_REASON_USER;
    }
    @Override public void onDestroy() {
        for (ManualDownloads.Run run : runs.values()) run.stop();
        worker.shutdown();
        super.onDestroy();
    }
}
