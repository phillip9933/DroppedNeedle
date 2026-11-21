package app.droppedneedle.mobile;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.junit.Test;

public final class FreshShuffleTest {
    private static final class History implements FreshShuffle.History {
        final Map<String, String> orders = new HashMap<>();
        public String previous(String group) {
            return orders.get(group);
        }
        public void remember(String group, String order) {
            orders.put(group, order);
        }
    }

    // A collision on demand, including repeatedly hitting Fisher-Yates' identity permutation.
    private static final Random identity = new Random() {
        @Override
        public int nextInt(int bound) {
            return bound - 1;
        }
    };

    private static ArrayList<String> draw(History history, Random random, String... songs) {
        ArrayList<String> result = new ArrayList<>(Arrays.asList(songs));
        FreshShuffle.draw(result, id -> id, history, random);
        return result;
    }

    @Test
    public void firstShuffleIsAudiblyDifferentAndTwoOrdersAlternateAcrossRelaunch() {
        History durable = new History();
        assertEquals(Arrays.asList("b", "a"), draw(durable, identity, "a", "b"));
        History restarted = new History();
        restarted.orders.putAll(durable.orders);
        assertEquals(Arrays.asList("a", "b"), draw(restarted, identity, "a", "b"));
        assertEquals(Arrays.asList("b", "a"), draw(restarted, identity, "b", "a"));
        assertEquals(1, restarted.orders.size());
    }

    @Test
    public void duplicatesAndChangedInputOrderStillExcludeTheLastAudibleArrangement() {
        History history = new History();
        List<String> last = Arrays.asList("a", "a", "b", "c");
        Random source = new Random(281);
        List<String> input = new ArrayList<>(last);
        for (int i = 0; i < 200; i++) {
            Collections.rotate(input, 1);
            List<String> result = draw(history, source, input.toArray(new String[0]));
            assertNotEquals(last, result);
            last = result;
            List<String> members = new ArrayList<>(result);
            Collections.sort(members);
            assertEquals(Arrays.asList("a", "a", "b", "c"), members);
        }
        assertEquals(1, history.orders.size());
        draw(history, source, "a", "b", "b", "c");
        assertEquals(2, history.orders.size());
        assertEquals(Arrays.asList("a", "a", "a"), draw(history, identity, "a", "a", "a"));
    }

    @Test
    public void theFirstCollectionShuffleSamplesEveryPermutationIncludingOriginal() {
        Set<List<String>> outcomes = new HashSet<>();
        for (int draw = 0; draw < 6; draw++) {
            int[] choices = {draw / 2, draw % 2};
            Random scripted = new Random() {
                int i;
                @Override
                public int nextInt(int bound) {
                    return choices[i++];
                }
            };
            ArrayList<String> songs = new ArrayList<>(Arrays.asList("x", "y", "z"));
            FreshShuffle.draw(songs, id -> id, new History(), FreshShuffle.Mode.SELECTION, scripted);
            outcomes.add(songs);
        }
        assertEquals(6, outcomes.size());
        assertTrue(outcomes.contains(Arrays.asList("x", "y", "z")));
    }

    @Test
    public void aNewServerOrderIsKeptAndOnlyAnAudibleRepeatIsRedrawn() {
        History history = new History();
        for (String[] fixture : new String[][] {{"a", "a", "b"}, {"a", "b", "a"}}) {
            List<String> ids = Arrays.asList(fixture);
            assertEquals(Arrays.asList(0, 1, 2), FreshShuffle.selection(ids, history, true));
        }
        List<String> repeat = Arrays.asList("a", "b", "a");
        List<Integer> rerolled = FreshShuffle.selection(repeat, history, true);
        List<String> audible = new ArrayList<>();
        for (int i : rerolled) audible.add(repeat.get(i));
        assertNotEquals(repeat, audible);
        assertEquals(new HashSet<>(Arrays.asList(0, 1, 2)), new HashSet<>(rerolled));
    }

    private static final class MoreEntropy extends RuntimeException {}

    @Test
    public void duplicateAudibleOutcomesHaveEqualWeightIncludingCollisionRedraws() {
        Map<List<String>, Integer> result = new HashMap<>();
        int rejectedTwice = 0;
        // Enumerate every possible first and second Fisher-Yates draw for three occurrences.
        for (int first = 0; first < 6; first++)
            for (int second = 0; second < 6; second++) {
                int[] script = {first / 2, first % 2, second / 2, second % 2};
                Random random = new Random() {
                    int position;
                    @Override
                    public int nextInt(int bound) {
                        if (position == script.length)
                            throw new MoreEntropy();
                        return script[position++];
                    }
                };
                try {
                    result.merge(draw(new History(), random, "a", "a", "b"), 1, Integer::sum);
                } catch (MoreEntropy collision) {
                    rejectedTwice++;
                }
            }
        assertEquals(4, rejectedTwice);
        assertEquals(2, result.size());
        assertEquals(Integer.valueOf(16), result.get(Arrays.asList("a", "b", "a")));
        assertEquals(Integer.valueOf(16), result.get(Arrays.asList("b", "a", "a")));
    }

    @Test
    public void distinctOrdersRemainReachableAfterRememberingOnePermutation() {
        History history = new History();
        List<String> prior = draw(history, identity, "a", "b", "c");
        Map<String, String> start = new HashMap<>(history.orders);
        Set<List<String>> outcomes = new HashSet<>();
        Random random = new Random(1394);
        for (int i = 0; i < 500; i++) {
            history.orders.putAll(start);
            outcomes.add(draw(history, random, "a", "b", "c"));
        }
        assertEquals(5, outcomes.size());
        assertFalse(outcomes.contains(prior));
    }
}
