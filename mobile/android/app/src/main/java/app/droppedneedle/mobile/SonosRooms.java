package app.droppedneedle.mobile;

import java.io.IOException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/** Group reports describe membership. Only receivers independently discovered on this network can get commands. */
final class SonosRooms {
    static final class Room {
        final String id, name, coordinator;
        int members;
        Room(String id, String name, String coordinator) {
            this.id = id;
            this.name = name;
            this.coordinator = coordinator;
        }
    }
    static Map<String, Room> topology(Document doc) throws IOException {
        Map<String, Room> rooms = new LinkedHashMap<>();
        NodeList groups = doc.getElementsByTagNameNS("*", "ZoneGroup");
        if (groups.getLength() == 0)
            throw new IOException("Sonos groups are unavailable.");
        for (int i = 0; i < groups.getLength(); i++) {
            Element group = (Element) groups.item(i);
            String coordinator = group.getAttribute("Coordinator");
            Map<String, Room> visible = new LinkedHashMap<>();
            for (Node n = group.getFirstChild(); n != null; n = n.getNextSibling()) {
                if (!(n instanceof Element e) || !"ZoneGroupMember".equals(e.getLocalName())
                        || "1".equals(e.getAttribute("Invisible")) || "1".equals(e.getAttribute("IsZoneBridge")))
                    continue;
                String id = e.getAttribute("UUID");
                if (!id.matches("RINCON_[A-Za-z0-9]{8,48}"))
                    continue;
                visible.put(id, new Room(id, e.getAttribute("ZoneName"), coordinator));
            }
            for (Room room : visible.values()) {
                room.members = visible.size();
                if (rooms.put(room.id, room) != null)
                    throw new IOException("Sonos group membership changed. Refresh the rooms.");
            }
        }
        return rooms;
    }
    static JSONArray list(Map<String, DlnaRenderer> devices) throws IOException, JSONException {
        Map<String, Room> rooms = new LinkedHashMap<>();
        Map<String, String> ids = new HashMap<>();
        Map<String, Map<String, Room>> households = new HashMap<>();
        for (Map.Entry<String, DlnaRenderer> e : devices.entrySet()) {
            DlnaRenderer device = e.getValue();
            if (!device.hasGroups())
                continue;
            ids.put(device.sonosId, e.getKey());
            if (!rooms.containsKey(device.sonosId)) {
                try {
                    Map<String, Room> household = topology(device.topology());
                    rooms.putAll(household);
                    for (String id : household.keySet()) households.put(id, household);
                } catch (IOException unreachable) { /* Another room can answer for the same household. */
                }
            }
        }
        if (!ids.isEmpty() && rooms.isEmpty())
            throw new IOException("Unable to read Sonos room groups. Refresh the speakers.");
        JSONArray result = new JSONArray();
        for (Room room : rooms.values()) {
            String id = ids.get(room.id);
            if (id == null)
                continue;
            Room leader = rooms.get(room.coordinator);
            JSONObject entry = new JSONObject()
                                       .put("id", id)
                                       .put("name", room.name)
                                       .put("coordinator", ids.get(room.coordinator))
                                       .put("groupName", leader == null ? room.name : leader.name)
                                       .put("members", room.members);
            JSONArray leaders = new JSONArray();
            for (Room candidate : households.get(room.id).values()) {
                if (candidate.id.equals(candidate.coordinator) && ids.containsKey(candidate.id))
                    leaders.put(ids.get(candidate.id));
            }
            entry.put("leaders", leaders);
            try {
                int volume = devices.get(id).volume();
                if (volume >= 0)
                    entry.put("volume", volume);
            } catch (IOException unavailable) { /* Room controls still work. */
            }
            result.put(entry);
        }
        return result;
    }
    static DlnaRenderer route(Map<String, DlnaRenderer> devices, DlnaRenderer room) throws IOException {
        if (!room.hasGroups())
            return room;
        Room state = topology(room.topology()).get(room.sonosId);
        if (state != null)
            for (DlnaRenderer device : devices.values())
                if (device.sonosId.equals(state.coordinator))
                    return device;
        throw new IOException("Find the Sonos group coordinator on this network before casting.");
    }
    static void group(DlnaRenderer device, DlnaRenderer target) throws IOException {
        if (!device.hasGroups())
            throw new IOException("Choose a Sonos room.");
        Map<String, Room> group = topology(device.topology());
        Room room = group.get(device.sonosId);
        if (room == null)
            throw new IOException("Refresh Sonos rooms before changing a group.");
        if (target == null) {
            if (!room.id.equals(room.coordinator))
                device.ungroup();
            else if (room.members > 1)
                throw new IOException("Ungroup the other rooms to make this coordinator independent.");
            return;
        }
        Room leader = group.get(target.sonosId);
        if (leader == null || !leader.id.equals(leader.coordinator))
            throw new IOException("Choose a coordinator in the same Sonos household.");
        if (room.coordinator.equals(leader.id))
            return;
        if (room.members > 1 && room.id.equals(room.coordinator))
            throw new IOException("Ungroup the other rooms before moving this coordinator.");
        device.join(leader.id);
    }
}
