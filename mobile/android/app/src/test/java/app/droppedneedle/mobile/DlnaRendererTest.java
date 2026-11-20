package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import javax.net.SocketFactory;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public final class DlnaRendererTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private static int status(String url) throws IOException {
        HttpURLConnection req = (HttpURLConnection) new URL(url).openConnection(Proxy.NO_PROXY);
        req.setRequestMethod("HEAD");
        req.setConnectTimeout(1000);
        req.setReadTimeout(1500);
        try { return req.getResponseCode(); } finally { req.disconnect(); }
    }

    @Test public void selectedSpeakerReadsOnlyPublishedSongAndControlsTransport() throws Exception {
        byte[] song = "0123456789".getBytes(StandardCharsets.US_ASCII);
        OkHttpClient dn = new OkHttpClient.Builder().addInterceptor(chain -> {
            assertEquals("https://dn.example/api/v3/stream/local/first", chain.request().url().toString());
            assertEquals("Bearer auth-token", chain.request().header("Authorization"));
            boolean range = "bytes=1-3".equals(chain.request().header("Range"));
            Response.Builder result = new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(range ? 206 : 200).message("OK").header("Content-Type", "audio/mpeg")
                    .header("Accept-Ranges", "bytes").header("Content-Length", range ? "3" : "10")
                    .header("Set-Cookie", "synthetic=auth-token");
            if (range) result.header("Content-Range", "bytes 1-3/10");
            return result.body(ResponseBody.create(MediaType.get("audio/mpeg"),
                    range ? Arrays.copyOfRange(song, 1, 4) : new byte[0])).build();
        }).build();
        String last;
        try (SyntheticSpeaker speaker = new SyntheticSpeaker();
             CastRelay relay = new CastRelay(speaker.loopback, speaker.loopback)) {
            DlnaRenderer target = speaker.describe();
            assertEquals("Test speaker", target.name);
            CastRelay.Publication first = relay.publish(CastRelay.fromDn(dn, "https://dn.example/api/v3/stream/local/first", "auth-token"));
            String url = relay.url(first);
            target.load(url, first.mime, "A & B <Live>", "Artist", "Album");
            assertEquals(url, speaker.uri);
            assertEquals("A & B <Live>", SyntheticSpeaker.element(speaker.metadata, "dc:title"));
            assertFalse(speaker.lastBody.contains("auth-token"));
            target.play();
            assertEquals("123", speaker.sample);
            assertEquals("bytes 1-3/10", speaker.contentRange);
            target.seek(42000);
            assertEquals(42000, target.read().position);
            assertEquals(120000, target.read().duration);
            target.pause();
            assertEquals("PAUSED_PLAYBACK", target.read().state);
            assertEquals(url, target.read().uri);
            File downloaded = temp.newFile();
            Files.write(downloaded.toPath(), "fLaCsample".getBytes(StandardCharsets.US_ASCII));
            CastRelay.Publication second = relay.publish(CastRelay.fromFile(downloaded, CastRelay.audioType(downloaded)));
            last = relay.url(second);
            assertEquals(404, status(url));
            assertEquals(200, status(last));
            assertEquals("audio/flac", second.mime);
            target.load(last, second.mime, "Saved song", "Artist", "Album");
            target.play();
            assertEquals("LaC", speaker.sample);
            target.stop();
            assertEquals("STOPPED", target.read().state);
        }
        assertThrows(IOException.class, () -> status(last));
    }

    @Test public void rejectsOtherPeersAndOffDeviceControlUrls() throws Exception {
        try (SyntheticSpeaker speaker = new SyntheticSpeaker();
             CastRelay relay = new CastRelay(speaker.loopback, speaker.loopback)) {
            InetAddress peer = InetAddress.getByName("127.0.0.2");
            assertThrows(IOException.class, () -> DlnaRenderer.describe(speaker.loopback, peer, SocketFactory.getDefault(),
                    "http://127.0.0.1/other"));
            File saved = temp.newFile();
            Files.write(saved.toPath(), "saved".getBytes(StandardCharsets.US_ASCII));
            URL url = new URL(relay.url(relay.publish(CastRelay.fromFile(saved, "audio/mpeg"))));
            try (Socket unauthorized = new Socket()) {
                unauthorized.bind(new InetSocketAddress(peer, 0));
                unauthorized.connect(new InetSocketAddress(speaker.loopback, url.getPort()), 1000);
                unauthorized.setSoTimeout(1500);
                try {
                    unauthorized.getOutputStream().write(("GET " + url.getPath() + " HTTP/1.1\r\n\r\n")
                            .getBytes(StandardCharsets.US_ASCII));
                    assertEquals(-1, unauthorized.getInputStream().read());
                } catch (java.net.SocketException refused) { /* Peer was refused before reading a request. */ }
            }
        }
    }

    @Test public void authGatewayPagesAreNeverPublishedOrServedToTheReceiver() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (CastRelay relay = new CastRelay(loopback, loopback)) {
            CastRelay.Source html = (range, head) -> new CastRelay.Media(200, "text/html", 8, null, false,
                    new java.io.ByteArrayInputStream("sign-in!".getBytes(StandardCharsets.US_ASCII)), null);
            assertThrows(IOException.class, () -> relay.publish(html));
            String url = relay.url(relay.publish((range, head) -> head
                    ? new CastRelay.Media(200, "audio/mpeg", 8, null, false, null, null) : html.open(range, false)));
            HttpURLConnection request = (HttpURLConnection) new URL(url).openConnection(Proxy.NO_PROXY);
            try { assertEquals(502, request.getResponseCode()); } finally { request.disconnect(); }
            HttpURLConnection cors = (HttpURLConnection) new URL(url).openConnection(Proxy.NO_PROXY);
            cors.setRequestMethod("OPTIONS");
            try {
                assertEquals(204, cors.getResponseCode());
                assertEquals("*", cors.getHeaderField("Access-Control-Allow-Origin"));
            } finally { cors.disconnect(); }
        }
    }
}
