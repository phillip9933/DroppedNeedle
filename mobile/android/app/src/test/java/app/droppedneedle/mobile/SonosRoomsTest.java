package app.droppedneedle.mobile;

import static org.junit.Assert.*;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.junit.Test;

public final class SonosRoomsTest {
    private final String living = "RINCON_00112233445501400", kitchen = "RINCON_11223344556601400";
    private String member(String id, String room) {
        // Locations supplied by a topology response must never be followed.
        return "<ZoneGroupMember UUID='" + id + "' ZoneName='" + room + "' Location='http://127.0.0.2:7777/unused'/>";
    }
    private String groups(boolean joined) {
        String a = member(living, "Living room"), b = member(kitchen, "Kitchen");
        return "<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator='" + living + "'>" + a + (joined ? b : "")
                + "<ZoneGroupMember UUID='RINCON_99999999' Invisible='1'/></ZoneGroup>"
                + (joined ? "" : "<ZoneGroup Coordinator='" + kitchen + "'>" + b + "</ZoneGroup>")
                + "</ZoneGroups></ZoneGroupState>";
    }
    @Test
    public void twoRoomsGroupAtTheCoordinatorAndVolumeRemainsPerRoom() throws Exception {
        try (SyntheticSpeaker a = new SyntheticSpeaker(living); SyntheticSpeaker b = new SyntheticSpeaker(kitchen)) {
            a.groups = b.groups = groups(false);
            DlnaRenderer left = a.describe(), right = b.describe();
            Map<String, DlnaRenderer> devices = new LinkedHashMap<>();
            devices.put("1", left);
            devices.put("2", right);
            assertTrue(left.hasGroups() && right.hasGroups());
            assertEquals(2, SonosRooms.list(devices).length());
            SonosRooms.group(right, left);
            assertEquals("x-rincon:" + living, b.uri);
            a.groups = b.groups = groups(true);
            assertSame(left, SonosRooms.route(devices, right));
            JSONArray rooms = SonosRooms.list(devices);
            assertEquals(2, rooms.getJSONObject(0).getInt("members"));
            assertEquals("1", rooms.getJSONObject(1).getString("coordinator"));
            right.setVolume(41);
            assertEquals(41, right.volume());
            assertEquals(27, left.volume());
            assertThrows(IOException.class, () -> right.setVolume(101));
            assertThrows(IOException.class, () -> SonosRooms.group(left, null));
            SonosRooms.group(right, null);
            assertEquals("", b.uri);
            devices.remove("1");
            assertThrows(IOException.class, () -> SonosRooms.route(devices, right));
        }
    }
}
