package com.gamemeet.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collection;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Mirrors app.js's video-meet room state:
 *   const roomsMap = new Map(); // roomId -> Map(socketId -> participant)
 *   function getActiveRooms() { ... }
 */
public class RoomManager {

    /** Mirrors one entry of a room's participants map in app.js. */
    public static class Participant {
        public final String socketId;
        public String peerId;
        public String nickname;
        public String role; // "speaker" | "listener"
        public String roomId;

        public Participant(String socketId, String peerId, String nickname, String role, String roomId) {
            this.socketId = socketId;
            this.peerId = peerId;
            this.nickname = nickname;
            this.role = role;
            this.roomId = roomId;
        }

        public JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("nickname", nickname);
            o.put("role", role);
            o.put("peerId", peerId);
            return o;
        }
    }

    private final Map<String, Map<String, Participant>> roomsMap = new ConcurrentHashMap<>();

    public void addParticipant(String roomId, String socketId, Participant participant) {
        roomsMap.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>()).put(socketId, participant);
    }

    public void removeParticipant(String roomId, String socketId) {
        Map<String, Participant> room = roomsMap.get(roomId);
        if (room == null) return;
        room.remove(socketId);
        if (room.isEmpty()) {
            roomsMap.remove(roomId);
        }
    }

    public boolean roomExists(String roomId) {
        return roomsMap.containsKey(roomId);
    }

    public Collection<Participant> getParticipants(String roomId) {
        Map<String, Participant> room = roomsMap.get(roomId);
        return room == null ? Collections.emptyList() : room.values();
    }

    public JSONArray participantsJson(String roomId) throws JSONException {
        JSONArray arr = new JSONArray();
        for (Participant p : getParticipants(roomId)) arr.put(p.toJson());
        return arr;
    }

    /** Mirrors getActiveRooms() in app.js. */
    public JSONArray getActiveRoomsJson() throws JSONException {
        JSONArray activeRooms = new JSONArray();
        for (Map.Entry<String, Map<String, Participant>> entry : roomsMap.entrySet()) {
            Map<String, Participant> participants = entry.getValue();
            if (participants.isEmpty()) continue;

            int speakersCount = 0, listenersCount = 0;
            JSONArray participantsJson = new JSONArray();
            for (Participant u : participants.values()) {
                if ("speaker".equals(u.role)) speakersCount++;
                else if ("listener".equals(u.role)) listenersCount++;
                participantsJson.put(u.toJson());
            }

            JSONObject roomObj = new JSONObject();
            roomObj.put("roomId", entry.getKey());
            roomObj.put("participantCount", participants.size());
            roomObj.put("speakersCount", speakersCount);
            roomObj.put("listenersCount", listenersCount);
            roomObj.put("participants", participantsJson);
            activeRooms.put(roomObj);
        }
        return activeRooms;
    }
}
