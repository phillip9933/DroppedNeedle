package app.droppedneedle.mobile;

import com.getcapacitor.JSArray;
import java.io.IOException;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Pattern;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Creates a library-only DN radio plan on the HTTP worker, with cancellable seed lookup and planning. */
final class SimilarMusic {
    private static final String[][] GAIN_FIELDS = {{"replaygain_track_gain", "replayGainTrackDb"},
            {"replaygain_album_gain", "replayGainAlbumDb"}, {"replaygain_track_peak", "replayGainTrackPeak"},
            {"replaygain_album_peak", "replayGainAlbumPeak"}};
    private static final Pattern MBID = Pattern.compile("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}");
    private final OkHttpClient http;
    private final PlaybackService.Access owner;
    private Call call;
    private boolean cancelled;

    SimilarMusic(OkHttpClient http, PlaybackService.Access owner) {
        this.http = http;
        this.owner = owner;
    }

    synchronized void cancel() {
        cancelled = true;
        if (call != null)
            call.cancel();
    }

    private JSONObject request(HttpUrl url, JSONObject body) throws IOException, JSONException {
        Request.Builder builder = new Request.Builder()
                                          .url(url)
                                          .tag(PlaybackService.Access.class, owner)
                                          .header("Authorization", "Bearer " + owner.token);
        if (body != null)
            builder.post(RequestBody.create(body.toString(), MediaType.get("application/json")));
        Call next = http.newCall(builder.build());
        synchronized (this) {
            if (cancelled || !owner.allowsOnlineMedia())
                throw new IOException("Go online to continue with similar music.");
            call = next;
        }
        try (Response response = next.execute()) {
            if (!response.isSuccessful())
                throw new IOException(
                        "DroppedNeedle could not load similar music (HTTP " + response.code() + ").");
            if (response.body() == null || response.body().source().request(LibraryWindow.MAX_BYTES + 1L))
                throw new IOException("Invalid DN radio response.");
            return new JSONObject(response.body().string());
        }
    }

    private static String value(JSONObject item, String field) {
        return item.isNull(field) ? "" : item.optString(field);
    }
    private static String mbid(JSONObject item, String field) {
        String value = value(item, field);
        return MBID.matcher(value).matches() ? value.toLowerCase(java.util.Locale.ROOT) : "";
    }
    private HttpUrl.Builder url(String path) {
        return owner.base.newBuilder().encodedPath(owner.apiPath + path);
    }

    JSArray plan(JSArray tracks, JSONArray history) throws IOException, JSONException {
        int end = tracks.length() - 1;
        JSONObject last = tracks.getJSONObject(end);
        boolean linkedArtist = false;
        for (int i = end; i >= 0 && end - i < 25; i--)
            if (!mbid(tracks.getJSONObject(i), "artistMbid").isEmpty()) {
                linkedArtist = true;
                break;
            }
        if (!linkedArtist && mbid(last, "releaseGroupMbid").isEmpty() && value(last, "genre").isEmpty()) {
            HttpUrl.Builder lookup = url("library/tracks")
                                             .addQueryParameter("q", last.getString("title"))
                                             .addQueryParameter("limit", "100");
            if (!value(last, "albumId").isEmpty())
                lookup.addQueryParameter("album_id", last.getString("albumId"));
            else if (!value(last, "artistId").isEmpty())
                lookup.addQueryParameter("artist_id", last.getString("artistId"));
            JSONObject page = request(lookup.build(), null);
            JSONArray rows = page.getJSONArray("items");
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                if (last.getString("id").equals(row.optString("id"))) {
                    last = LibraryWindow.track(owner.base, owner.apiPath, row);
                    break;
                }
            }
        }
        JSONArray items = new JSONArray();
        Set<String> files = new HashSet<>();
        Set<String> recordings = new LinkedHashSet<>();
        for (int i = end; i >= 0; i--) {
            JSONObject row = i == end ? last : tracks.getJSONObject(i);
            files.add(row.getString("id"));
            String recording = mbid(row, "recordingMbid");
            if (recording.isEmpty())
                recording = mbid(tracks.getJSONObject(i), "recordingMbid");
            if (!recording.isEmpty())
                recordings.add(recording);
            String artist = mbid(row, "artistMbid"), album = mbid(row, "releaseGroupMbid");
            if (end - i < 25 && !artist.isEmpty())
                items.put(new JSONObject()
                                .put("artist_mbid", artist)
                                .put("artist_name", value(row, "artist"))
                                .put("album_mbid", album.isEmpty() ? null : album)
                                .put("album_name", value(row, "album")));
        }
        for (int i = history.length() - 1; i >= 0; i--) {
            JSONObject entry = history.optJSONObject(i);
            if (entry == null)
                continue;
            files.add(entry.optString("id"));
            String recording = mbid(entry, "recordingMbid");
            if (!recording.isEmpty())
                recordings.add(recording);
        }
        JSONArray exclude = new JSONArray();
        for (String id : recordings) {
            if (exclude.length() == 500)
                break;
            exclude.put(id);
        }
        JSONObject body =
                new JSONObject().put("count", 25).put("mode", "library").put("exclude_recording_mbids", exclude);
        String group = mbid(last, "releaseGroupMbid"), genre = value(last, "genre");
        if (items.length() > 0)
            body.put("seed_type", "items").put("items", items);
        else if (!group.isEmpty())
            body.put("seed_type", "album").put("seed_id", group);
        else if (!genre.isEmpty())
            body.put("seed_type", "genre").put("seed_id", genre);
        else
            throw new IOException(
                    "This queue has no artist, album or genre that DroppedNeedle can use for autoplay.");
        JSONArray planned = request(url("discover/radio/plan").build(), body).getJSONArray("tracks");
        JSArray added = new JSArray();
        for (int i = 0; i < planned.length() && added.length() < 25; i++) {
            JSONObject t = planned.getJSONObject(i);
            String id = value(t, "local_file_id"), recording = mbid(t, "recording_mbid"),
                   artist = mbid(t, "artist_mbid"), album = mbid(t, "album_mbid");
            if (!t.optBoolean("in_library") || !OfflineStore.validTrackId(id) || files.contains(id)
                    || (!recording.isEmpty() && recordings.contains(recording)))
                continue;
            JSONObject song =
                    new JSONObject()
                            .put("id", id)
                            .put("title", t.getString("track_name"))
                            .put("artist", t.getString("artist_name"))
                            .put("album", value(t, "album_name"))
                            .put("streamUrl", url("stream/local/").addPathSegment(id).build().toString());
            if (!artist.isEmpty())
                song.put("artistMbid", artist);
            if (!recording.isEmpty()) {
                song.put("recordingMbid", recording);
                recordings.add(recording);
            }
            if (!album.isEmpty())
                song.put("releaseGroupMbid", album)
                        .put("artworkUrl",
                                url("covers/release-group/")
                                        .addPathSegment(album)
                                        .addQueryParameter("size", "500")
                                        .build()
                                        .toString());
            if (!t.isNull("duration_s"))
                song.put("duration", t.getDouble("duration_s"));
            if (!t.isNull("file_format"))
                song.put("format", t.getString("file_format"));
            for (String[] field : GAIN_FIELDS)
                if (!t.isNull(field[0]))
                    song.put(field[1], t.getDouble(field[0]));
            files.add(id);
            added.put(song);
        }
        if (added.length() == 0)
            throw new IOException("DroppedNeedle found no new library tracks for this queue.");
        return added;
    }
}
