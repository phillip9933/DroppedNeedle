package app.droppedneedle.mobile;

import java.io.BufferedInputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** A selected renderer can read the one track currently published to it from this interface. */
final class CastRelay implements Closeable {
    interface Source {
        Media open(String range, boolean head) throws IOException;
    }
    static final class Media implements Closeable {
        final int status;
        final String mime, contentRange;
        final long length;
        final boolean ranges;
        final InputStream input;
        final Closeable close;
        Runnable cancel;
        Media(int status, String mime, long length, String contentRange, boolean ranges,
              InputStream input, Closeable close) {
            this.status = status;
            this.mime = mime != null && mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")
                    ? mime.toLowerCase(java.util.Locale.ROOT) : "";
            this.length = length;
            this.contentRange = contentRange != null && contentRange.matches("bytes (\\d+-\\d+|\\*)/(\\d+|\\*)") ? contentRange : null;
            this.ranges = ranges;
            this.input = input;
            this.close = close;
        }
        @Override public void close() throws IOException { if (close != null) close.close(); }
        boolean audio() {
            return mime.startsWith("audio/") || mime.equals("application/octet-stream")
                    || mime.equals("application/ogg") || mime.equals("application/flac");
        }
    }

    static Source fromDn(OkHttpClient authenticated, String url, String token) {
        return (range, head) -> {
            Request.Builder req = new Request.Builder().url(url).header("Authorization", "Bearer " + token);
            if (range != null) req.header("Range", range);
            if (head) req.head();
            Call call = authenticated.newCall(req.build());
            Response res = call.execute();
            long length = res.body() == null ? -1 : res.body().contentLength();
            if (head && res.header("Content-Length") != null) {
                try { length = Long.parseLong(res.header("Content-Length")); }
                catch (NumberFormatException ignored) { length = -1; }
            }
            Media media = new Media(res.code(), res.header("Content-Type", "").split(";", 2)[0], length,
                    res.header("Content-Range"), "bytes".equalsIgnoreCase(res.header("Accept-Ranges"))
                    || res.code() == 206, head || res.body() == null ? null : res.body().byteStream(), res);
            media.cancel = call::cancel;
            return media;
        };
    }

    static Source fromFile(File file, String mime) {
        return (range, head) -> {
            FileInputStream in = new FileInputStream(file);
            try {
                long total = in.getChannel().size();
                long start = 0, end = total - 1;
                if (range != null) {
                    String[] ends = range.substring(6).split("-", -1);
                    if (ends[0].isEmpty()) start = Math.max(0, total - Long.parseLong(ends[1]));
                    else {
                        start = Long.parseLong(ends[0]);
                        if (!ends[1].isEmpty()) end = Math.min(end, Long.parseLong(ends[1]));
                    }
                    if (start > end || start >= total)
                        return new Media(416, mime, 0, "bytes */" + total, true, null, in);
                }
                in.getChannel().position(start);
                return new Media(range == null ? 200 : 206, mime, end - start + 1,
                        range == null ? null : "bytes " + start + "-" + end + "/" + total, true, head ? null : in, in);
            } catch (NumberFormatException e) {
                in.close();
                return new Media(416, mime, 0, null, true, null, null);
            } catch (IOException e) { in.close(); throw e; }
        };
    }

    static String audioType(File file) throws IOException {
        byte[] header = new byte[12];
        try (FileInputStream stream = new FileInputStream(file)) {
            if (stream.read(header) < 4) return "application/octet-stream";
        }
        String magic = new String(header, StandardCharsets.ISO_8859_1);
        if (magic.startsWith("fLaC")) return "audio/flac";
        if (magic.startsWith("OggS")) return "audio/ogg";
        if (magic.startsWith("RIFF") && magic.endsWith("WAVE")) return "audio/wav";
        if (magic.startsWith("ftyp", 4)) return "audio/mp4";
        if ((header[0] & 0xff) == 0xff && (header[1] & 0xf6) == 0xf0) return "audio/aac";
        if (magic.startsWith("ID3") || ((header[0] & 0xff) == 0xff && (header[1] & 0xe0) == 0xe0)) return "audio/mpeg";
        return "application/octet-stream";
    }

    static final class Publication {
        final String path;
        final Source source;
        final String mime;
        Publication(String path, Source source, String mime) {
            this.path = path; this.source = source; this.mime = mime;
        }
    }
    private final ServerSocket server = new ServerSocket();
    private final InetAddress peer;
    private final ThreadPoolExecutor handlers = new ThreadPoolExecutor(4, 4, 20, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(2), new ThreadPoolExecutor.AbortPolicy());
    private final Set<Socket> clients = new HashSet<>();
    private final Set<Media> streams = new HashSet<>();
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile Publication current;
    private static final String CORS = "\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS"
            + "\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges"
            + "\r\nAccess-Control-Allow-Private-Network: true";

    CastRelay(InetAddress local, InetAddress peer) throws IOException {
        this.peer = peer;
        server.bind(new InetSocketAddress(local, 0), 4);
        Thread listener = new Thread(this::listen, "dn-cast-listener");
        listener.setDaemon(true);
        listener.start();
    }
    String url(Publication item) {
        return "http://" + server.getInetAddress().getHostAddress() + ":" + server.getLocalPort() + item.path;
    }
    Publication publish(Source source) throws IOException {
        String mime;
        try (Media meta = source.open(null, true)) {
            if (meta.status < 200 || meta.status >= 300 || !meta.audio()) throw new IOException("DN could not read the song.");
            mime = meta.mime;
        }
        String ext = mime.equals("audio/mpeg") ? ".mp3" : mime.equals("audio/mp4") ? ".m4a"
                : mime.equals("audio/flac") ? ".flac" : mime.equals("audio/ogg") ? ".ogg"
                : mime.equals("audio/wav") ? ".wav" : "";
        synchronized (this) {
            if (closed.get()) throw new IOException("Casting ended.");
            revoke();
            current = new Publication("/audio/" + UUID.randomUUID() + ext, source, mime);
            return current;
        }
    }
    synchronized void revoke() {
        current = null;
        for (Socket s : clients) quietly(s);
        for (Media stream : streams) if (stream.cancel != null) stream.cancel.run();
    }
    private static void quietly(Closeable resource) {
        try { resource.close(); } catch (IOException ignored) { }
    }

    private void listen() {
        while (!closed.get()) {
            try {
                Socket socket = server.accept();
                synchronized (this) {
                    if (closed.get() || !peer.equals(socket.getInetAddress())) { quietly(socket); continue; }
                    clients.add(socket);
                }
                try { handlers.execute(() -> serve(socket)); }
                catch (java.util.concurrent.RejectedExecutionException e) {
                    synchronized (this) { clients.remove(socket); }
                    quietly(socket);
                }
            } catch (IOException e) { close(); }
        }
    }

    private void serve(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(5000);
            BufferedInputStream in = new BufferedInputStream(client.getInputStream());
            OutputStream out = client.getOutputStream();
            String[] request = DlnaRenderer.line(in).split(" ", 3);
            Publication item = current;
            if (item == null || request.length != 3 || !item.path.equals(request[1])
                    || !(request[0].equals("GET") || request[0].equals("HEAD") || request[0].equals("OPTIONS"))) {
                reject(out, 404);
                return;
            }
            String range = null;
            for (int n = 0; ; n++) {
                String h = DlnaRenderer.line(in);
                if (h.isEmpty()) break;
                if (n >= 48) { reject(out, 400); return; }
                if (h.regionMatches(true, 0, "Range:", 0, 6)) {
                    if (range != null) { reject(out, 416); return; }
                    range = h.substring(6).trim();
                    if (!range.matches("bytes=(\\d{1,18}-\\d{0,18}|-\\d{1,18})")) { reject(out, 416); return; }
                }
            }
            if (request[0].equals("OPTIONS")) {
                out.write(("HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0" + CORS + "\r\n\r\n")
                        .getBytes(StandardCharsets.US_ASCII));
                return;
            }
            boolean head = request[0].equals("HEAD");
            try (Media data = item.source.open(range, head)) {
                synchronized (this) {
                    if (item != current || closed.get()) return;
                    streams.add(data);
                }
                try {
                    if ((data.status != 200 && data.status != 206 && data.status != 416)
                            || (data.status != 416 && !data.audio())) { reject(out, 502); return; }
                    String headers = "HTTP/1.1 " + data.status + (data.status == 200 ? " OK" : data.status == 206 ? " Partial Content" : " Range Not Satisfiable")
                            + "\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: " + (data.status == 416 ? item.mime : data.mime)
                            + (data.length >= 0 ? "\r\nContent-Length: " + data.length : "")
                            + (data.contentRange != null ? "\r\nContent-Range: " + data.contentRange : "")
                            + (data.ranges ? "\r\nAccept-Ranges: bytes" : "")
                            + CORS + "\r\ntransferMode.dlna.org: Streaming\r\n\r\n";
                    out.write(headers.getBytes(StandardCharsets.US_ASCII));
                    if (!head && data.status != 416 && data.input != null) {
                        byte[] buf = new byte[32768];
                        long left = data.length;
                        while (current == item && left != 0) {
                            int n = data.input.read(buf, 0, left < 0 ? buf.length : (int) Math.min(buf.length, left));
                            if (n < 0) break;
                            out.write(buf, 0, n);
                            if (left > 0) left -= n;
                        }
                    }
                    out.flush();
                } finally { synchronized (this) { streams.remove(data); } }
            }
        } catch (IOException ignored) {
            // Seeking, changing songs and disconnecting all close in-flight receiver reads.
        } finally { synchronized (this) { clients.remove(socket); } }
    }

    private static void reject(OutputStream out, int code) throws IOException {
        out.write(("HTTP/1.1 " + code + " Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
    }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        quietly(server);
        revoke();
        handlers.shutdownNow();
    }
}
