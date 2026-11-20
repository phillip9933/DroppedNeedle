package app.droppedneedle.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.google.android.gms.cast.CastDevice;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.api.PendingResult;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Google Cast's default media receiver gets only the selected song's phone-hosted URI. */
final class GoogleRenderer extends NetworkRenderer {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SessionManager sessions;
    private final CastSession session;
    private final RemoteMediaClient client;

    static GoogleRenderer selected(Context ctx, SessionManager sessions, CastSession session) throws IOException {
        CastDevice device = session.getCastDevice();
        InetAddress peer = device == null ? null : device.getInetAddress();
        if (!(peer instanceof Inet4Address) || session.getRemoteMediaClient() == null)
            throw new IOException("Choose a Cast device on this Wi-Fi network with an IPv4 address.");
        DlnaDiscovery.Lan lan = DlnaDiscovery.networkFor(ctx, peer);
        return new GoogleRenderer(lan.address.getAddress(), peer, device.getFriendlyName(), sessions, session);
    }
    private GoogleRenderer(InetAddress local, InetAddress peer, String name, SessionManager sessions, CastSession session) {
        super(local, peer, name);
        this.sessions = sessions; this.session = session; client = session.getRemoteMediaClient();
    }
    private static <T> T await(CompletableFuture<T> result) throws IOException {
        try { return result.get(12, TimeUnit.SECONDS); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException("Cast interrupted.", e); }
        catch (ExecutionException | TimeoutException e) { throw new IOException("The Cast device did not respond.", e); }
    }
    private void command(Callable<PendingResult<RemoteMediaClient.MediaChannelResult>> action) throws IOException {
        CompletableFuture<Void> result = new CompletableFuture<>();
        main.post(() -> {
            try {
                if (!session.isConnected()) throw new IOException("Cast disconnected.");
                action.call().setResultCallback(value -> {
                    if (value.getStatus().isSuccess()) result.complete(null);
                    else result.completeExceptionally(new IOException("Cast rejected the command."));
                });
            } catch (Exception e) { result.completeExceptionally(e); }
        });
        await(result);
    }
    @Override void load(String url, String mime, String title, String artist, String album) throws IOException {
        command(() -> client.load(request(url, mime, title, artist, album)));
    }

    static MediaLoadRequestData request(String url, String mime, String title, String artist, String album) {
        MediaMetadata meta = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
        meta.putString(MediaMetadata.KEY_TITLE, title);
        meta.putString(MediaMetadata.KEY_ARTIST, artist);
        meta.putString(MediaMetadata.KEY_ALBUM_TITLE, album);
        MediaInfo info = new MediaInfo.Builder(url).setContentType(mime).setMetadata(meta)
                .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED).build();
        return new MediaLoadRequestData.Builder().setMediaInfo(info).setAutoplay(false).build();
    }
    @Override void play() throws IOException { command(client::play); }
    @Override void pause() throws IOException { command(client::pause); }
    @Override void stop() throws IOException { command(client::stop); }
    @Override void seek(long ms) throws IOException {
        command(() -> client.seek(new MediaSeekOptions.Builder().setPosition(ms).build()));
    }
    @Override Reading read() throws IOException {
        CompletableFuture<Reading> result = new CompletableFuture<>();
        main.post(() -> {
            try {
                if (!session.isConnected()) throw new IOException("Cast disconnected.");
                MediaStatus status = client.getMediaStatus();
                MediaInfo info = client.getMediaInfo();
                String state = "TRANSITIONING";
                if (status != null) switch (status.getPlayerState()) {
                    case MediaStatus.PLAYER_STATE_PLAYING: state = "PLAYING"; break;
                    case MediaStatus.PLAYER_STATE_PAUSED: state = "PAUSED_PLAYBACK"; break;
                    case MediaStatus.PLAYER_STATE_IDLE:
                        if (status.getIdleReason() == MediaStatus.IDLE_REASON_ERROR) throw new IOException("Cast playback failed.");
                        state = status.getIdleReason() == MediaStatus.IDLE_REASON_FINISHED ? "FINISHED" : "STOPPED";
                        break;
                }
                result.complete(new Reading(state, info == null ? "" : info.getContentId(),
                        client.getApproximateStreamPosition(), client.getStreamDuration()));
            } catch (Exception e) { result.completeExceptionally(e); }
        });
        return await(result);
    }
    @Override void leave() {
        main.post(() -> { if (sessions.getCurrentCastSession() == session) sessions.endCurrentSession(false); });
    }
}
