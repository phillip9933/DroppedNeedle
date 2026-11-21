package app.droppedneedle.mobile;

import android.content.Context;
import android.net.Uri;
import android.os.SystemClock;
import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import okhttp3.Call;
import okhttp3.Response;
import org.json.JSONException;
import org.json.JSONObject;

/** Follows the local player's actual queue, including its shuffled order, while the WebView sleeps. */
final class QueueReadAhead {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Job active;
    private boolean closed;
    record Entry(String id, Uri representation, JSONObject track) {}
    private static final class Job {
        final PlaybackService.Access owner;
        final StreamProfiles.Path path;
        final int rate;
        final long generation;
        final List<Entry> entries;
        final String currentId;
        volatile Call call;
        Future<?> task;
        Job(PlaybackService.Access owner, StreamProfiles.Path path, int rate, List<Entry> entries, String currentId) {
            this.owner = owner;
            this.path = path;
            this.rate = rate;
            this.entries = entries;
            this.currentId = currentId;
            generation = owner.offline.cacheGeneration();
        }
    }

    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    void update(Context context, @Nullable PlaybackService.Access owner, RoutedPlayer player, Call.Factory http) {
        if (closed)
            return;
        StreamProfiles.Path path = StreamProfiles.active(context);
        OfflineStore store = owner == null ? null : owner.offline;
        int count = store == null ? 0 : store.ahead(path, false);
        if (count == 0 || !store.readAheadOn(path) || !player.destination().isEmpty() || !player.isPlaying()) {
            cancel();
            return;
        }
        ArrayList<Entry> entries = new ArrayList<>();
        HashSet<String> seen = new HashSet<>();
        int current = player.getCurrentMediaItemIndex();
        MediaItem first = player.getCurrentMediaItem();
        if (first != null)
            seen.add(first.mediaId);
        // Whole-library pages and shuffled queues expose their next items in playback order.
        for (int index : nextIndices(current, player.getMediaItemCount(), count, player.getRepeatMode())) {
            MediaItem media = player.getMediaItemAt(index);
            if (media.localConfiguration == null || !(media.localConfiguration.tag instanceof JSONObject track))
                continue;
            String id = store.trackId(media.localConfiguration.uri.toString());
            if (id == null || !id.equals(track.optString("id")) || !seen.add(id))
                continue;
            try {
                entries.add(new Entry(id, owner.profiles.track().forRequest(media.localConfiguration.uri), track));
            } catch (IOException disconnected) {
                cancel();
                return;
            }
        }
        schedule(context, owner, path, store.ahead(path, true), entries, first == null ? "" : first.mediaId, http);
    }
    void schedule(Context context, PlaybackService.Access owner, StreamProfiles.Path path, int rate,
            List<Entry> entries, String currentId, Call.Factory http) {
        if (closed)
            return;
        OfflineStore store = owner.offline;
        Job prior = active;
        if (prior != null && owner == prior.owner && path == prior.path && rate == prior.rate
                && currentId.equals(prior.currentId) && entries.equals(prior.entries)) {
            if (prior.generation != store.cacheGeneration())
                abort(prior);
            return;
        }
        cancel();
        if (entries.isEmpty())
            return;
        Job job = new Job(owner, path, rate, entries, currentId);
        active = job;
        job.task = worker.submit(() -> {
            HashSet<String> nearer = new HashSet<>();
            if (!currentId.isEmpty())
                nearer.add(currentId);
            for (Entry entry : entries) {
                if (!current(context, job) || store.cacheRoom(nearer) <= 0)
                    break;
                try {
                    fetch(context, http, job, entry, nearer);
                    nearer.add(entry.id());
                } catch (IOException | JSONException ignored) {
                    break;
                } // Live playback remains authoritative.
            }
        });
    }
    static List<Integer> nextIndices(int current, int size, int count, int repeat) {
        ArrayList<Integer> upcoming = new ArrayList<>();
        if (current < 0 || current >= size || repeat == Player.REPEAT_MODE_ONE)
            return upcoming;
        for (int offset = 1; offset <= count && offset < size; offset++) {
            int index = current + offset;
            if (index >= size && repeat != Player.REPEAT_MODE_ALL)
                break;
            upcoming.add(index % size);
        }
        return upcoming;
    }
    private boolean current(Context context, Job job) {
        return active == job && !Thread.currentThread().isInterrupted() && !job.owner.offline.offlineOnly()
                && job.owner.offline.cacheGeneration() == job.generation && StreamProfiles.active(context) == job.path
                && job.owner.offline.readAheadOn(job.path);
    }
    private void fetch(Context context, Call.Factory http, Job job, Entry entry, java.util.Set<String> nearer)
            throws IOException, JSONException {
        OfflineStore store = job.owner.offline;
        long revision = store.itemRevision(entry.id());
        if (!store.wantsAhead(entry.id()))
            return;
        Uri representation = entry.representation();
        String format = representation.getQueryParameter("format"),
               rate = representation.getQueryParameter("max_bitrate");
        int bitrate;
        try {
            bitrate = rate == null ? 192 : Integer.parseInt(rate);
        } catch (NumberFormatException bad) {
            return;
        }
        try (Response audio = DownloadRepresentation.open(store.original(entry.id()), job.owner.token,
                     "mp3".equals(format) || "opus".equals(format) ? format : "original", bitrate, request -> {
                         if (!current(context, job))
                             throw new IOException("Queue changed.");
                         Call call = http.newCall(
                                 request.newBuilder().tag(PlaybackService.Access.class, job.owner).build());
                         job.call = call;
                         if (active != job)
                             call.cancel();
                         return call.execute();
                     })) {
            String mime = DownloadRepresentation.mime(audio);
            if (mime == null || !current(context, job) || store.itemRevision(entry.id()) != revision)
                return;
            try (OfflineStore.Capture copy = store.begin(
                         entry.track(), OfflineStore.CACHE, OfflineStore.AHEAD, audio.body().contentLength(), nearer);
                    InputStream input = audio.body().byteStream()) {
                if (copy == null)
                    return;
                byte[] block = new byte[32768];
                long bytes = 0, start = SystemClock.elapsedRealtime();
                for (int n; (n = input.read(block)) != -1;) {
                    if (active != job || Thread.currentThread().isInterrupted())
                        return;
                    copy.write(block, 0, n);
                    bytes += n;
                    if (job.rate > 0) {
                        long delay = start + bytes * 1000 / (1024L * job.rate) - SystemClock.elapsedRealtime();
                        if (delay > 0)
                            try {
                                Thread.sleep(delay);
                            } catch (InterruptedException stale) {
                                Thread.currentThread().interrupt();
                                return;
                            }
                    }
                }
                copy.finish(mime, () -> current(context, job) && store.itemRevision(entry.id()) == revision);
            }
        } finally {
            job.call = null;
        }
    }
    void cancel() {
        Job job = active;
        active = null;
        abort(job);
    }
    private void abort(Job job) {
        if (job == null)
            return;
        Call call = job.call;
        if (call != null)
            call.cancel();
        if (job.task != null)
            job.task.cancel(true);
    }
    void close() {
        closed = true;
        cancel();
        worker.shutdownNow();
    }
}
