package com.gamemeet.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Per-player state inside the 3D football game, mirroring the gameState
 * object app.js stores in gamePlayers[socket.id]:
 *   { position, velocity, looking, team, input, health, username, isSpeaking }
 * plus socket.gamePeerId / socket.gameRoomId, used for the in-game voice
 * chat peer signaling (peer_register / game_peer_list / game_peer_joined).
 */
public class GamePlayerState {
    public Vec3 position = new Vec3(0, 0, 0);
    public Vec3 velocity = new Vec3(0, 0, 0);
    public Quat looking = new Quat(0, 0, 0, 1);
    public int team;
    public final Set<String> input = Collections.synchronizedSet(new HashSet<String>());
    public int health = 100;
    public String username = "Oyuncu";
    public boolean isSpeaking = false;

    // Mirrors socket.gamePeerId / socket.gameRoomId from the peer_register handler.
    public String gamePeerId;
    public String gameRoomId = "saha-1";

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("position", position.toJson());
        o.put("velocity", velocity.toJson());
        o.put("looking", looking.toJson());
        o.put("team", team);
        o.put("health", health);
        o.put("username", username);
        o.put("isSpeaking", isSpeaking);

        JSONArray inputArr = new JSONArray();
        synchronized (input) {
            for (String s : input) inputArr.put(s);
        }
        o.put("input", inputArr);
        return o;
    }
}
