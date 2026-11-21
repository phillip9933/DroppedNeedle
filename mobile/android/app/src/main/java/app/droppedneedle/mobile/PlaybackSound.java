package app.droppedneedle.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioTrack;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Metadata;
import androidx.media3.common.Tracks;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.extractor.metadata.flac.VorbisComment;
import androidx.media3.extractor.metadata.id3.TextInformationFrame;
import com.getcapacitor.JSObject;
import java.nio.ByteBuffer;
import java.util.Locale;
import java.util.WeakHashMap;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

/** Local playback settings and a ReplayGain PCM stage before the independent fade and device volume. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlaybackSound {
    private final SharedPreferences prefs;
    private final WeakHashMap<JSONObject, JSONObject> embedded = new WeakHashMap<>();
    final GainProcessor primary = new GainProcessor();
    private String mode;
    private float speed;

    PlaybackSound(Context context) {
        prefs = context.getSharedPreferences("dn_playback_sound", Context.MODE_PRIVATE);
        mode = prefs.getString("replayGain", "off");
        speed = prefs.getFloat("speed", 1);
    }
    float speed() {
        return speed;
    }
    String replayGainMode() { return mode; }

    JSObject configure(@Nullable Double rate, @Nullable String gainMode) {
        if (rate != null && rate != 0.5 && rate != 0.75 && rate != 1 && rate != 1.25 && rate != 1.5 && rate != 1.75
                && rate != 2)
            throw new IllegalArgumentException("Choose a supported playback speed.");
        if (gainMode != null && !gainMode.equals("off") && !gainMode.equals("track") && !gainMode.equals("album"))
            throw new IllegalArgumentException("Choose a ReplayGain mode.");
        if (rate != null || gainMode != null) {
            if (rate != null)
                speed = rate.floatValue();
            if (gainMode != null)
                mode = gainMode;
            prefs.edit().putFloat("speed", speed).putString("replayGain", mode).apply();
        }
        JSObject result = new JSObject();
        result.put("speed", speed);
        result.put("replayGain", mode);
        return result;
    }

    private static JSONObject tags(MediaItem item) {
        return item != null && item.localConfiguration != null && item.localConfiguration.tag instanceof JSONObject
                ? (JSONObject) item.localConfiguration.tag
                : null;
    }

    void remember(MediaItem item, Tracks tracks) {
        JSONObject track = tags(item);
        if (track == null)
            return;
        JSONObject values = new JSONObject();
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO)
                continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSelected(i))
                    continue;
                Metadata metadata = group.getTrackFormat(i).metadata;
                if (metadata == null)
                    continue;
                for (int j = 0; j < metadata.length(); j++) {
                    Metadata.Entry entry = metadata.get(j);
                    if (entry instanceof VorbisComment) {
                        VorbisComment comment = (VorbisComment) entry;
                        parseTag(values, comment.key, comment.value);
                    } else if (entry instanceof TextInformationFrame) {
                        TextInformationFrame text = (TextInformationFrame) entry;
                        if (("TXXX".equals(text.id) || "TXX".equals(text.id)) && !text.values.isEmpty())
                            parseTag(values, text.description, text.values.get(0));
                    }
                }
            }
        }
        if (values.length() > 0)
            embedded.put(track, values);
    }

    static void parseTag(JSONObject result, String name, String value) {
        if (name == null || value == null)
            return;
        String key;
        switch (name.toUpperCase(Locale.ROOT)) {
            case "REPLAYGAIN_TRACK_GAIN":
                key = "replayGainTrackDb";
                break;
            case "REPLAYGAIN_ALBUM_GAIN":
                key = "replayGainAlbumDb";
                break;
            case "REPLAYGAIN_TRACK_PEAK":
                key = "replayGainTrackPeak";
                break;
            case "REPLAYGAIN_ALBUM_PEAK":
                key = "replayGainAlbumPeak";
                break;
            default:
                return;
        }
        try {
            double n = Double.parseDouble(value.trim().replaceFirst("(?i)\\s*dB$", "").trim());
            if (Double.isFinite(n))
                result.put(key, n);
        } catch (NumberFormatException | JSONException ignored) {
        }
    }

    private static double value(JSONObject dn, JSONObject embedded, String key) {
        double v = dn.optDouble(key, Double.NaN);
        return Double.isFinite(v) || embedded == null ? v : embedded.optDouble(key, Double.NaN);
    }

    static float factor(String mode, JSONObject tags, JSONObject embedded) {
        if (tags == null || "off".equals(mode))
            return 1;
        boolean album = "album".equals(mode) && Double.isFinite(value(tags, embedded, "replayGainAlbumDb"));
        double db = value(tags, embedded, album ? "replayGainAlbumDb" : "replayGainTrackDb");
        if (!Double.isFinite(db))
            return 1;
        double factor = Math.pow(10, Math.max(-60, Math.min(60, db)) / 20);
        double peak = value(tags, embedded, album ? "replayGainAlbumPeak" : "replayGainTrackPeak");
        if (!(peak > 0))
            peak = value(tags, embedded, album ? "replayGainTrackPeak" : "replayGainAlbumPeak");
        if (Double.isFinite(peak) && peak > 0)
            factor = Math.min(factor, 1 / peak);
        return (float) factor;
    }
    float factor(MediaItem item) {
        JSONObject info = tags(item);
        return factor(mode, info, embedded.get(info));
    }

    static DefaultRenderersFactory renderers(
            Context context, GainProcessor gain, @Nullable Consumer<AudioTrack> output) {
        return new DefaultRenderersFactory(context) {
            @Override
            protected AudioSink buildAudioSink(Context app, boolean floatOutput, boolean playbackParams) {
                DefaultAudioSink.Builder builder = new DefaultAudioSink.Builder(app)
                                                           .setEnableAudioTrackPlaybackParams(playbackParams)
                                                           .setAudioProcessors(new AudioProcessor[] {gain});
                if (output != null)
                    builder.setAudioTrackProvider((config, attributes, id, trackContext) -> {
                        AudioTrack track = DefaultAudioSink.AudioTrackProvider.DEFAULT.getAudioTrack(
                                config, attributes, id, trackContext);
                        output.accept(track);
                        return track;
                    });
                return builder.build();
            }
        };
    }

    static final class GainProcessor extends BaseAudioProcessor {
        volatile float factor = 1;
        @Override
        protected AudioFormat onConfigure(AudioFormat input) {
            return input.encoding == C.ENCODING_PCM_16BIT ? input : AudioFormat.NOT_SET;
        }
        @Override
        public void queueInput(ByteBuffer input) {
            if (!input.hasRemaining()) return;
            ByteBuffer out = replaceOutputBuffer(input.remaining());
            float gain = factor;
            if (gain == 1)
                out.put(input);
            else
                while (input.remaining() >= 2) {
                    int scaled = Math.round(input.getShort() * gain);
                    out.putShort((short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, scaled)));
                }
            out.flip();
        }
    }
}
