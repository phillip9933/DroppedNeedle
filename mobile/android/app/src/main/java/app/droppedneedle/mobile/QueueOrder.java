package app.droppedneedle.mobile;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import org.json.JSONArray;

/** Tracks occurrences by their local tag, since two queue entries can point at the same recording. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class QueueOrder {
    private ArrayList<MediaItem> original;

    boolean shuffled() {
        return original != null;
    }
    void clear() {
        original = null;
    }

    private static Object key(MediaItem item) {
        return item.localConfiguration.tag;
    }

    private int originalIndex(MediaItem item) {
        Object tag = key(item);
        for (int i = 0; i < original.size(); i++)
            if (key(original.get(i)) == tag)
                return i;
        return -1;
    }

    void toggle(Player player, FreshShuffle.History history) {
        int current = player.getCurrentMediaItemIndex(), count = player.getMediaItemCount();
        if (original != null) {
            int normal = originalIndex(player.getCurrentMediaItem());
            if (normal >= 0) {
                // Retain the playing occurrence on the Media3 timeline, including its decoder and seek position.
                player.replaceMediaItems(current + 1, count, original.subList(normal + 1, original.size()));
                player.replaceMediaItems(0, current, original.subList(0, normal));
            }
            clear();
        } else if (count - current > 2) {
            original = new ArrayList<>();
            for (int i = 0; i < count; i++) original.add(player.getMediaItemAt(i));
            List<MediaItem> suffix = original.subList(current + 1, count);
            ArrayList<MediaItem> upcoming = new ArrayList<>(suffix);
            FreshShuffle.draw(upcoming, item -> item.mediaId, history);
            player.replaceMediaItems(current + 1, count, upcoming);
        }
    }

    void insert(List<MediaItem> added, MediaItem after) {
        if (original != null)
            original.addAll(after == null ? original.size() : originalIndex(after) + 1, added);
    }

    void remove(Player player, int from, int to) {
        if (original == null || from == to)
            return;
        IdentityHashMap<Object, Boolean> removed = new IdentityHashMap<>();
        for (int i = from; i < to; i++) removed.put(key(player.getMediaItemAt(i)), true);
        original.removeIf(item -> removed.containsKey(key(item)));
    }

    JSONArray save(Player player) {
        if (original == null || original.size() != player.getMediaItemCount())
            return null;
        IdentityHashMap<Object, Integer> ranks = new IdentityHashMap<>();
        for (int i = 0; i < original.size(); i++) ranks.put(key(original.get(i)), i);
        JSONArray saved = new JSONArray();
        for (int i = 0; i < original.size(); i++) {
            Integer rank = ranks.get(key(player.getMediaItemAt(i)));
            if (rank == null)
                return null;
            saved.put(rank.intValue());
        }
        return saved;
    }

    void restore(List<MediaItem> tracks, JSONArray ranks) {
        clear();
        if (ranks == null || ranks.length() != tracks.size())
            return;
        ArrayList<MediaItem> restored = new ArrayList<>(Collections.nCopies(tracks.size(), null));
        for (int i = 0; i < tracks.size(); i++) {
            int rank = ranks.optInt(i, -1);
            if (rank < 0 || rank >= tracks.size() || restored.set(rank, tracks.get(i)) != null)
                return;
        }
        original = restored;
    }
}
