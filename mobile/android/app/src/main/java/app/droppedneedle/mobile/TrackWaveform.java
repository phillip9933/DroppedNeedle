package app.droppedneedle.mobile;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Decode the selected song away from the playback thread. The result contains only amplitude peaks. */
final class TrackWaveform {
    static final int BINS = 112;
    private static final long MAX_DOWNLOAD = 128L * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Job active;

    private static final class Job {
        final String request;
        volatile boolean cancelled;
        volatile Call network;
        Job(String request) { this.request = request; }
        void check() throws IOException {
            if (cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Waveform canceled.");
        }
        void cancel() {
            cancelled = true;
            Call call = network;
            if (call != null) call.cancel();
        }
    }

    void cancel(String request) {
        if (active != null && active.request.equals(request)) active.cancel();
    }

    void close() {
        if (active != null) active.cancel();
        worker.shutdown();
    }

    void read(String request, File directory, PlaybackService.Access owner, Uri stream, double seconds,
              OkHttpClient http, Consumer<JSObject> complete) {
        if (active != null) active.cancel();
        Job job = new Job(request);
        active = job;
        worker.execute(() -> {
            File temporary = null;
            JSArray values = new JSArray();
            try {
                job.check();
                File file = owner.offline == null ? null : owner.offline.artworkSource(stream.toString());
                if (file == null) {
                    if (!owner.allowsOnlineMedia()) throw new IOException("Not available offline.");
                    temporary = File.createTempFile("dn-wave-", ".audio", directory);
                    Uri uri = owner.profiles.track().forRequest(stream);
                    try (Response initial = open(job, owner, uri, http)) {
                        if (initial.code() == 409 && ConversionSource.requested(uri)) {
                            try (Response raw = open(job, owner, ConversionSource.original(stream), http)) {
                                copy(raw, temporary, job, owner);
                            }
                        } else copy(initial, temporary, job, owner);
                    }
                    file = temporary;
                }
                for (float peak : decode(file, seconds, job)) values.put((double) peak);
            } catch (IOException | org.json.JSONException | RuntimeException ignored) {
                // An unavailable waveform leaves the normal seek control and playback operational.
            } finally {
                if (temporary != null) temporary.delete();
                JSObject out = new JSObject();
                out.put("peaks", values);
                complete.accept(out);
            }
        });
    }

    private static Response open(Job job, PlaybackService.Access owner, Uri uri, OkHttpClient http) throws IOException {
        Request request = new Request.Builder().url(uri.toString())
                .tag(PlaybackService.Access.class, owner).header("Authorization", "Bearer " + owner.token).build();
        if (!owner.permits(request.url(), "stream/local/")) throw new IOException("Invalid track address.");
        job.network = http.newCall(request);
        job.check();
        return job.network.execute();
    }

    private static void copy(Response response, File file, Job job, PlaybackService.Access owner) throws IOException {
        if (!response.isSuccessful() || response.body() == null || response.body().contentLength() > MAX_DOWNLOAD)
            throw new IOException("Waveform audio unavailable.");
        try (InputStream in = response.body().byteStream(); FileOutputStream out = new FileOutputStream(file)) {
            byte[] chunk = new byte[65536];
            long size = 0;
            for (int n; (n = in.read(chunk)) != -1;) {
                job.check();
                if (!owner.allowsOnlineMedia()) throw new IOException("Not available offline.");
                size += n;
                if (size > MAX_DOWNLOAD) throw new IOException("File too large for waveform analysis.");
                out.write(chunk, 0, n);
            }
        }
    }

    static float[] decode(File file, double seconds) throws IOException { return decode(file, seconds, new Job("local")); }

    private static float[] decode(File file, double seconds, Job job) throws IOException {
        MediaExtractor source = new MediaExtractor();
        try {
            source.setDataSource(file.getAbsolutePath());
            for (int i = 0; i < source.getTrackCount(); i++) {
                MediaFormat format = source.getTrackFormat(i);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("audio/")) continue;
                long duration = format.containsKey(MediaFormat.KEY_DURATION)
                        ? format.getLong(MediaFormat.KEY_DURATION) : (long) (seconds * 1_000_000);
                if (duration <= 0) return new float[0];
                source.selectTrack(i);
                float[] peaks = new float[BINS];
                boolean sampled = false;
                if ("audio/raw".equals(mime)) {
                    int max = format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE) ? format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) : 0;
                    ByteBuffer buffer = ByteBuffer.allocateDirect(Math.max(65536, Math.min(4 * 1024 * 1024, max)));
                    for (;;) {
                        job.check();
                        buffer.clear();
                        int size = source.readSampleData(buffer, 0);
                        if (size < 0) break;
                        buffer.position(0).limit(size);
                        sampled |= sample(buffer, format, source.getSampleTime(), duration, peaks);
                        source.advance();
                    }
                } else sampled = decodeFrames(source, format, mime, duration, peaks, job);
                return sampled ? peaks : new float[0];
            }
            return new float[0];
        } finally { source.release(); }
    }

    private static boolean decodeFrames(MediaExtractor source, MediaFormat format, String mime, long duration,
                                        float[] peaks, Job job) throws IOException {
        MediaCodec codec = MediaCodec.createDecoderByType(mime);
        try {
            codec.configure(format, null, null, 0);
            codec.start();
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean sampled = false;
            while (true) {
                job.check();
                if (!inputDone) {
                    int index = codec.dequeueInputBuffer(5000);
                    if (index >= 0) {
                        ByteBuffer in = codec.getInputBuffer(index);
                        if (in == null) throw new IOException("Decoder input unavailable.");
                        int size = source.readSampleData(in, 0);
                        inputDone = size < 0;
                        codec.queueInputBuffer(index, 0, Math.max(size, 0), inputDone ? 0 : source.getSampleTime(),
                                inputDone ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                        if (!inputDone) source.advance();
                    }
                }
                int out = codec.dequeueOutputBuffer(info, 5000);
                if (out >= 0) {
                    ByteBuffer pcm = codec.getOutputBuffer(out);
                    if (pcm != null && info.size > 0) {
                        pcm.position(info.offset).limit(info.offset + info.size);
                        sampled |= sample(pcm, codec.getOutputFormat(out), info.presentationTimeUs, duration, peaks);
                    }
                    codec.releaseOutputBuffer(out, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return sampled;
                }
            }
        } finally { codec.release(); }
    }

    private static boolean sample(ByteBuffer data, MediaFormat format, long startUs, long duration,
                                  float[] peaks) throws IOException {
        int encoding = format.containsKey(MediaFormat.KEY_PCM_ENCODING) ? format.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
        int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT), rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
        int bytes = encoding == AudioFormat.ENCODING_PCM_8BIT ? 1 : encoding == AudioFormat.ENCODING_PCM_16BIT ? 2 :
                encoding == AudioFormat.ENCODING_PCM_24BIT_PACKED ? 3 : 4;
        if (rate <= 0 || channels <= 0 || channels > 64) throw new IOException("Invalid PCM format.");
        data.order(ByteOrder.LITTLE_ENDIAN);
        int frames = data.remaining() / (bytes * channels);
        for (int f = 0; f < frames; f++) {
            long timestamp = startUs + f * 1_000_000L / rate;
            int bin = (int) Math.max(0, Math.min(peaks.length - 1, timestamp * peaks.length / duration));
            for (int c = 0; c < channels; c++) {
                float value;
                switch (encoding) {
                    case AudioFormat.ENCODING_PCM_8BIT: value = ((data.get() & 255) - 128) / 128f; break;
                    case AudioFormat.ENCODING_PCM_16BIT: value = data.getShort() / 32768f; break;
                    case AudioFormat.ENCODING_PCM_24BIT_PACKED:
                        value = ((data.get() & 255) | ((data.get() & 255) << 8) | (data.get() << 16)) / 8388608f;
                        break;
                    case AudioFormat.ENCODING_PCM_32BIT: value = data.getInt() / 2147483648f; break;
                    case AudioFormat.ENCODING_PCM_FLOAT: value = data.getFloat(); break;
                    default: throw new IOException("Unsupported PCM format.");
                }
                if (Float.isFinite(value)) peaks[bin] = Math.max(peaks[bin], Math.abs(value));
            }
        }
        return frames > 0;
    }
}
