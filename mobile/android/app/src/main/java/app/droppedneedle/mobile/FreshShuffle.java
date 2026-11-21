package app.droppedneedle.mobile;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.function.Function;
import org.json.JSONArray;

/** Fisher-Yates draws over occurrences, with explicit repeats compared by the order listeners hear. */
final class FreshShuffle {
    interface History {
        default Object lock() {
            return this;
        }
        String previous(String group);
        void remember(String group, String order);
    }

    enum Mode { UPCOMING, SELECTION, SERVER_ORDER }

    private static final SecureRandom entropy = new SecureRandom();

    static <T> void draw(List<T> tracks, Function<T, String> fileId, History history) {
        draw(tracks, fileId, history, entropy);
    }

    static <T> void refill(List<T> tracks) {
        Collections.shuffle(tracks, entropy);
    }

    private static String fingerprint(List<String> ids) {
        // JSON array boundaries distinguish identifiers containing punctuation or another identifier.
        return OfflineStore.digest(new JSONArray(ids).toString());
    }

    private static <T> ArrayList<String> ids(List<T> tracks, Function<T, String> fileId) {
        ArrayList<String> result = new ArrayList<>(tracks.size());
        for (T track : tracks) result.add(fileId.apply(track));
        return result;
    }

    static <T> void draw(List<T> tracks, Function<T, String> fileId, History history, Random random) {
        draw(tracks, fileId, history, Mode.UPCOMING, random);
    }

    static ArrayList<Integer> selection(List<String> ids, History history, boolean serverOrder) {
        ArrayList<Integer> indices = new ArrayList<>(ids.size());
        for (int i = 0; i < ids.size(); i++) indices.add(i);
        draw(indices, ids::get, history, serverOrder ? Mode.SERVER_ORDER : Mode.SELECTION, entropy);
        return indices;
    }

    static <T> void draw(List<T> tracks, Function<T, String> fileId, History history, Mode mode, Random random) {
        // Native queue commands and catalogue requests may arrive on different threads, even for the same set.
        synchronized (history == null ? tracks : history.lock()) {
            choose(tracks, fileId, history, mode, random);
        }
    }

    private static <T> void choose(
            List<T> tracks, Function<T, String> fileId, History history, Mode mode, Random random) {
        if (tracks.size() < 2)
            return;
        ArrayList<String> input = ids(tracks, fileId);
        ArrayList<String> membership = new ArrayList<>(input);
        Collections.sort(membership);
        if (membership.get(0).equals(membership.get(membership.size() - 1))) {
            // Every audible order is identical. Individual occurrences still have independent positions.
            if (mode != Mode.SERVER_ORDER)
                Collections.shuffle(tracks, random);
            return;
        }
        String group = fingerprint(membership);
        String forbidden = history == null ? null : history.previous(group);
        if (mode == Mode.SERVER_ORDER) {
            String provided = fingerprint(input);
            if (!provided.equals(forbidden)) {
                if (history != null)
                    history.remember(group, provided);
                return;
            }
        } else if (forbidden == null && mode == Mode.UPCOMING)
            forbidden = fingerprint(input);
        boolean perturb = true;
        while (true) {
            Collections.shuffle(tracks, random);
            ArrayList<String> candidate = ids(tracks, fileId);
            String order = fingerprint(candidate);
            if (!order.equals(forbidden)) {
                if (history != null)
                    history.remember(group, order);
                return;
            }
            // Rejection sampling keeps all other audible orders equally likely, even with duplicates.
            // Vary the starting arrangement after collisions; the next full Fisher-Yates draw is still uniform.
            if (perturb) {
                int different = 1;
                while (candidate.get(0).equals(candidate.get(different))) different++;
                Collections.swap(tracks, 0, different);
            }
            perturb = !perturb;
        }
    }
}
