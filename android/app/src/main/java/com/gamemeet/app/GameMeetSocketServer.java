package com.gamemeet.app;

import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Java/Android port of app.js's combined Socket.IO handler:
 *   io.on('connection', socket => { ... VIDEO MEET + 3D GAME + GAME CHAT ... })
 *
 * IMPORTANT: this speaks a small custom JSON envelope over plain WebSocket -
 *   {"event": "<name>", "data": <payload>}
 * using the exact same event names and payload shapes app.js sends/receives
 * over socket.io (newUser, kick_action, tick, goal, ...). It does NOT
 * implement the real Socket.IO wire protocol. If the client that talks to
 * this server is a stock socket.io-client, it will need to either be changed
 * to speak this envelope format, or you'd need a socket.io-compatible Java
 * client library instead of plain WebSocket on the Android side.
 */
public class GameMeetSocketServer extends WebSocketServer implements GameEngine.SocketBroadcaster {
    private static final String TAG = "GameMeetSocketServer";

    private final Map<WebSocket, ClientSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, WebSocket> idToSocket = new ConcurrentHashMap<>();

    private final RoomManager roomManager = new RoomManager();
    private final GameEngine gameEngine = new GameEngine(this);

    public GameMeetSocketServer(int port) {
        super(new InetSocketAddress(port));
    }

    @Override
    public void onStart() {
        Log.d(TAG, "GameMeet WebSocket Server started successfully on port " + getPort());
        gameEngine.start();
    }

    @Override
    public void stop() throws InterruptedException {
        gameEngine.stop();
        super.stop();
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        ClientSession session = new ClientSession();
        sessions.put(conn, session);
        idToSocket.put(session.id, conn);
        Log.d(TAG, "New WebSocket connection: " + conn.getRemoteSocketAddress() + " -> id=" + session.id);

        try {
            sendRaw(conn, "activeRoomsUpdate", roomManager.getActiveRoomsJson());
        } catch (JSONException e) {
            Log.e(TAG, "Failed to send initial activeRoomsUpdate", e);
        }

        gameEngine.registerPlayer(session.id);
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        ClientSession session = sessions.remove(conn);
        if (session == null) return;
        idToSocket.remove(session.id);

        try {
            if (session.roomId != null && roomManager.roomExists(session.roomId)) {
                String roomId = session.roomId;
                roomManager.removeParticipant(roomId, session.id);

                JSONObject payload = new JSONObject();
                payload.put("peerId", session.peerId);
                payload.put("nickname", session.nickname);
                sendToRoom(roomId, "userDisconnect", payload);

                if (roomManager.roomExists(roomId)) {
                    sendToRoom(roomId, "roomParticipants", roomManager.participantsJson(roomId));
                }
                sendToAll("activeRoomsUpdate", roomManager.getActiveRoomsJson());
            }
        } catch (JSONException e) {
            Log.e(TAG, "Error during room disconnect cleanup", e);
        }

        gameEngine.unregisterPlayer(session.id);
        Log.d(TAG, "WebSocket connection closed: " + reason);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        ClientSession session = sessions.get(conn);
        if (session == null) return;

        try {
            JSONObject msg = new JSONObject(message);
            String event = msg.optString("event", "");
            Object data = msg.isNull("data") ? null : msg.opt("data");
            handleEvent(conn, session, event, data);
        } catch (JSONException e) {
            Log.e(TAG, "Invalid message JSON: " + message, e);
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        Log.e(TAG, "WebSocket error", ex);
    }

    // ---------------------------------------------------------------
    // Event dispatch - mirrors each socket.on(...) registered inside
    // io.on('connection', socket => { ... }) in app.js
    // ---------------------------------------------------------------

    private void handleEvent(WebSocket conn, ClientSession session, String event, Object data) throws JSONException {
        switch (event) {
            case "game_chat_message": {
                JSONObject d = asObject(data);
                String username = (d != null && d.has("username")) ? d.optString("username") : "Oyuncu";
                String text = d != null ? d.optString("text", "") : "";
                if (text.isEmpty()) return;
                Log.d(TAG, "[Game Chat] " + username + ": " + text);
                JSONObject payload = new JSONObject();
                payload.put("username", username);
                payload.put("text", text);
                sendToAllExcept(session.id, "game_chat_message", payload);
                break;
            }
            case "getRooms":
                sendRaw(conn, "activeRoomsUpdate", roomManager.getActiveRoomsJson());
                break;
            case "newUser":
                handleNewUser(session, data);
                break;
            case "peer_register": {
                JSONObject d = asObject(data);
                String peerId = d != null ? d.optString("peerId", null) : null;
                String username = d != null ? d.optString("username", null) : null;
                String roomId = (d != null && d.has("roomId")) ? d.optString("roomId") : null;
                gameEngine.peerRegister(session.id, peerId, username, roomId);
                break;
            }
            case "set username":
                gameEngine.setUsername(session.id, data != null ? String.valueOf(data) : null);
                break;
            case "speaking": {
                boolean speaking = (data instanceof Boolean)
                        ? (Boolean) data
                        : Boolean.parseBoolean(String.valueOf(data));
                gameEngine.setSpeaking(session.id, speaking);
                break;
            }
            case "input down":
                gameEngine.inputDown(session.id, String.valueOf(data));
                break;
            case "input up":
                gameEngine.inputUp(session.id, String.valueOf(data));
                break;
            case "set looking":
                gameEngine.setLooking(session.id, Quat.fromJson(asObject(data)));
                break;
            case "jump":
                gameEngine.jump(session.id);
                break;
            case "shoot_hit":
                gameEngine.shootHit(session.id, String.valueOf(data));
                break;
            case "kick_action": {
                JSONObject d = asObject(data);
                String type = d != null ? d.optString("type", "boot") : "boot";
                double power = d != null ? d.optDouble("power", 50) : 50;
                double curve = d != null ? d.optDouble("curve", 0) : 0;
                gameEngine.kickAction(session.id, type, power, curve);
                break;
            }
            default:
                Log.w(TAG, "Unknown event: " + event);
        }
    }

    /**
     * Mirrors the "newUser" handler. Note: app.js also supports a legacy
     * two-argument call style (peerId, roomId) for older clients - that form
     * relies on socket.io's multi-argument events and has no equivalent in
     * this single-payload JSON envelope, so only the object form
     * { peerId, roomId, nickname, role } is supported here.
     */
    private void handleNewUser(ClientSession session, Object data) throws JSONException {
        String peerId = "", roomId = "", nickname = "Kullanıcı", role = "speaker";
        JSONObject d = asObject(data);
        if (d != null) {
            peerId = d.optString("peerId", "");
            roomId = d.has("roomId") ? String.valueOf(d.opt("roomId")).trim() : "";
            nickname = d.optString("nickname", "Kullanıcı");
            role = d.optString("role", "speaker");
        } else if (data != null) {
            peerId = String.valueOf(data);
        }

        if (roomId.isEmpty()) return;

        if (session.roomId != null && !session.roomId.equals(roomId) && roomManager.roomExists(session.roomId)) {
            roomManager.removeParticipant(session.roomId, session.id);
        }

        session.roomId = roomId;
        session.peerId = peerId;
        session.nickname = nickname;
        session.role = role;

        roomManager.addParticipant(roomId, session.id,
                new RoomManager.Participant(session.id, peerId, nickname, role, roomId));

        Log.d(TAG, "[Active Room] " + nickname + " (" + role + ") registered in room \"" + roomId
                + "\" (peer: " + peerId + ")");

        if (!peerId.isEmpty()) {
            JSONObject payload = new JSONObject();
            payload.put("peerId", peerId);
            payload.put("nickname", nickname);
            payload.put("role", role);
            sendToRoomExcept(roomId, session.id, "userJoined", payload);
        }

        sendToRoom(roomId, "roomParticipants", roomManager.participantsJson(roomId));
        sendToAll("activeRoomsUpdate", roomManager.getActiveRoomsJson());
    }

    // ---------------------------------------------------------------
    // GameEngine.SocketBroadcaster implementation
    // ---------------------------------------------------------------

    @Override
    public void sendToAll(String event, Object data) {
        for (WebSocket ws : sessions.keySet()) {
            sendRaw(ws, event, data);
        }
    }

    @Override
    public void sendToAllExcept(String exceptClientId, String event, Object data) {
        for (Map.Entry<WebSocket, ClientSession> entry : sessions.entrySet()) {
            if (entry.getValue().id.equals(exceptClientId)) continue;
            sendRaw(entry.getKey(), event, data);
        }
    }

    @Override
    public void sendToClient(String clientId, String event, Object data) {
        WebSocket ws = idToSocket.get(clientId);
        if (ws != null) sendRaw(ws, event, data);
    }

    // ---------------------------------------------------------------
    // Video-meet room broadcast helpers (mirrors socket.to(roomId)/io.to(roomId))
    // ---------------------------------------------------------------

    private void sendToRoom(String roomId, String event, Object data) {
        for (RoomManager.Participant p : roomManager.getParticipants(roomId)) {
            WebSocket ws = idToSocket.get(p.socketId);
            if (ws != null) sendRaw(ws, event, data);
        }
    }

    private void sendToRoomExcept(String roomId, String exceptClientId, String event, Object data) {
        for (RoomManager.Participant p : roomManager.getParticipants(roomId)) {
            if (p.socketId.equals(exceptClientId)) continue;
            WebSocket ws = idToSocket.get(p.socketId);
            if (ws != null) sendRaw(ws, event, data);
        }
    }

    // ---------------------------------------------------------------
    // Low-level send / parse helpers
    // ---------------------------------------------------------------

    private void sendRaw(WebSocket conn, String event, Object data) {
        try {
            JSONObject envelope = new JSONObject();
            envelope.put("event", event);
            envelope.put("data", data == null ? JSONObject.NULL : data);
            if (conn.isOpen()) conn.send(envelope.toString());
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build message for event " + event, e);
        }
    }

    private JSONObject asObject(Object data) {
        return (data instanceof JSONObject) ? (JSONObject) data : null;
    }
}
