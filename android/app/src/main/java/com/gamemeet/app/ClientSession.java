package com.gamemeet.app;

import java.util.UUID;

/**
 * Per-connection state. In app.js these are properties attached directly to
 * the socket.io `socket` object (socket.roomId, socket.peerId, socket.nickname,
 * socket.role). Here they live in a small session object keyed by the
 * underlying WebSocket connection.
 *
 * `id` plays the role of socket.io's socket.id - a stable identifier for this
 * connection used as the key into the game engine's player map and the
 * "player joined" / "player left" / "tick" payloads.
 */
public class ClientSession {
    public final String id = UUID.randomUUID().toString();

    // Video Meet state (set by the "newUser" event)
    public String roomId;
    public String peerId;
    public String nickname;
    public String role;
}
