package com.gamemeet.app;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Java port of the "3D MULTIPLAYER FOOTBALL GAME ENGINE & STATE" section of
 * app.js: GAME_GRAVITY/GRASS_E/SIDE_E, gameBall, gamePlayers, gameTeams,
 * gameScore, gameTimeLeft, resetGameBall(), startGameEngine(), scoreGoal(),
 * isCloseToBall(), handlePlayerPlayerCollisions(), handleSmoothDribbling(),
 * handlePortalTeleportation(), updateGamePhysics(), and the kick_action /
 * shoot_hit / jump / input / peer_register socket handlers.
 *
 * Runs its own physics tick (16ms, matching setInterval(updateGamePhysics, 16))
 * and match-clock tick (1000ms), broadcasting the same event names app.js
 * emits over socket.io, through the SocketBroadcaster callback.
 */
public class GameEngine {
    private static final String TAG = "GameEngine";

    /** Abstraction over "who to send this event to", implemented by the WebSocket server. */
    public interface SocketBroadcaster {
        void sendToAll(String event, Object data);
        void sendToAllExcept(String exceptClientId, String event, Object data);
        void sendToClient(String clientId, String event, Object data);
    }

    private static final double GAME_GRAVITY = -10;
    private static final double GRASS_E = 0.5;
    private static final double SIDE_E = 0.85;
    private static final double DT = 0.016; // matches app.js's fixed 16ms step

    private final SocketBroadcaster broadcaster;
    private final Map<String, GamePlayerState> players = new ConcurrentHashMap<>();

    @SuppressWarnings("unchecked")
    private final Set<String>[] teams = new Set[]{
            Collections.synchronizedSet(new HashSet<String>()),
            Collections.synchronizedSet(new HashSet<String>())
    };
    private final int[] score = {0, 0};

    private volatile GameBallState ball = new GameBallState(GAME_GRAVITY);
    private volatile boolean goalScored = false;
    private volatile String lastKick = null;
    private volatile int timeLeft = 300;

    private ScheduledExecutorService scheduler;

    public GameEngine(SocketBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    public void start() {
        resetBall();
        scheduler = Executors.newScheduledThreadPool(2);
        scheduler.scheduleAtFixedRate(this::tickClock, 1000, 1000, TimeUnit.MILLISECONDS);
        scheduler.scheduleAtFixedRate(this::updateGamePhysics, 16, 16, TimeUnit.MILLISECONDS);
    }

    public void stop() {
        if (scheduler != null) scheduler.shutdownNow();
    }

    /** Mirrors resetGameBall() in app.js. */
    private void resetBall() {
        ball = new GameBallState(GAME_GRAVITY);
        ball.position = new Vec3(0, 4, 0);
        goalScored = false;
    }

    private void tickClock() {
        timeLeft -= 1;
        if (timeLeft <= 0) {
            timeLeft = 300;
            score[0] = 0;
            score[1] = 0;
        }
        broadcaster.sendToAll("update clock", timeLeft);
    }

    // ---------------------------------------------------------------
    // Connection lifecycle (mirrors the io.on('connection', ...) join/leave logic)
    // ---------------------------------------------------------------

    public void registerPlayer(String clientId) {
        int team = teams[0].size() > teams[1].size() ? 1 : 0;
        teams[team].add(clientId);

        GamePlayerState state = new GamePlayerState();
        state.team = team;
        players.put(clientId, state);

        try {
            JSONObject statePayload = new JSONObject();
            statePayload.put("position", state.position.toJson());
            statePayload.put("velocity", state.velocity.toJson());
            statePayload.put("looking", state.looking.toJson());

            JSONObject joinedPayload = new JSONObject();
            joinedPayload.put("id", clientId);
            joinedPayload.put("state", statePayload);
            joinedPayload.put("team", team);
            joinedPayload.put("score", scoreJson());
            broadcaster.sendToAllExcept(clientId, "player joined", joinedPayload);

            JSONObject startPayload = new JSONObject();
            startPayload.put("id", clientId);
            startPayload.put("players", playersJson());
            startPayload.put("team", team);
            startPayload.put("score", scoreJson());
            broadcaster.sendToClient(clientId, "start", startPayload);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build join/start payload", e);
        }
    }

    public void unregisterPlayer(String clientId) {
        broadcaster.sendToAll("player left", clientId);
        teams[0].remove(clientId);
        teams[1].remove(clientId);
        players.remove(clientId);
    }

    // ---------------------------------------------------------------
    // Client -> server events
    // ---------------------------------------------------------------

    /** Mirrors the "peer_register" handler (in-game PeerJS voice chat signaling). */
    public void peerRegister(String clientId, String peerId, String username, String roomId) {
        GamePlayerState state = players.get(clientId);
        if (state == null) return;
        state.gamePeerId = peerId;
        state.gameRoomId = (roomId == null || roomId.isEmpty()) ? "saha-1" : roomId;

        try {
            JSONArray existingPeers = new JSONArray();
            for (Map.Entry<String, GamePlayerState> entry : players.entrySet()) {
                String otherId = entry.getKey();
                GamePlayerState other = entry.getValue();
                if (otherId.equals(clientId)) continue;
                if (other.gamePeerId == null) continue;
                if (!state.gameRoomId.equals(other.gameRoomId)) continue;

                JSONObject peer = new JSONObject();
                peer.put("peerId", other.gamePeerId);
                peer.put("socketId", otherId);
                existingPeers.put(peer);
            }
            broadcaster.sendToClient(clientId, "game_peer_list", existingPeers);

            JSONObject joinedPayload = new JSONObject();
            joinedPayload.put("peerId", peerId);
            joinedPayload.put("socketId", clientId);
            for (Map.Entry<String, GamePlayerState> entry : players.entrySet()) {
                String otherId = entry.getKey();
                if (otherId.equals(clientId)) continue;
                if (!state.gameRoomId.equals(entry.getValue().gameRoomId)) continue;
                broadcaster.sendToClient(otherId, "game_peer_joined", joinedPayload);
            }
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build peer_register payload", e);
        }
    }

    public void setUsername(String clientId, String username) {
        GamePlayerState state = players.get(clientId);
        if (state == null) return;
        state.username = (username == null || username.isEmpty()) ? "Oyuncu" : username;

        try {
            JSONObject statePayload = new JSONObject();
            statePayload.put("position", state.position.toJson());
            statePayload.put("velocity", state.velocity.toJson());
            statePayload.put("looking", state.looking.toJson());
            statePayload.put("username", state.username);

            JSONObject payload = new JSONObject();
            payload.put("id", clientId);
            payload.put("state", statePayload);
            payload.put("team", state.team);
            payload.put("score", scoreJson());
            broadcaster.sendToAllExcept(clientId, "player joined", payload);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build set-username payload", e);
        }
    }

    public void setSpeaking(String clientId, boolean speaking) {
        GamePlayerState state = players.get(clientId);
        if (state == null) return;
        state.isSpeaking = speaking;
        try {
            JSONObject payload = new JSONObject();
            payload.put("id", clientId);
            payload.put("isSpeaking", speaking);
            broadcaster.sendToAll("speaking_update", payload);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build speaking_update payload", e);
        }
    }

    public void inputDown(String clientId, String input) {
        GamePlayerState state = players.get(clientId);
        if (state != null) state.input.add(input);
    }

    public void inputUp(String clientId, String input) {
        GamePlayerState state = players.get(clientId);
        if (state != null) state.input.remove(input);
    }

    public void setLooking(String clientId, Quat looking) {
        GamePlayerState state = players.get(clientId);
        if (state != null) state.looking = looking;
    }

    public void jump(String clientId) {
        GamePlayerState state = players.get(clientId);
        if (state != null && state.position.y == 0) {
            state.velocity.y = 5;
        }
    }

    public void shootHit(String shooterId, String targetId) {
        GamePlayerState shooter = players.get(shooterId);
        GamePlayerState target = players.get(targetId);
        if (shooter == null || target == null) return;

        if (shooter.position.z <= -50 && target.position.z <= -50) {
            target.health = Math.max(0, target.health - 4);

            if (target.health == 0) {
                target.health = 100;
                target.position.x = 0;
                target.position.y = 0;
                target.position.z = -100;
            }

            try {
                JSONObject payload = new JSONObject();
                payload.put("id", targetId);
                payload.put("health", target.health);
                broadcaster.sendToAll("health_update", payload);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to build health_update payload", e);
            }
        }
    }

    /** Mirrors the "kick_action" handler. */
    public void kickAction(String clientId, String type, double power, double curve) {
        if (!isCloseToBall(clientId)) return;
        GamePlayerState player = players.get(clientId);
        if (player == null) return;

        lastKick = clientId;
        double normPower = Math.max(10, Math.min(100, power)) / 100.0;

        Vec3 direction = new Vec3(0, 0, -1);
        player.looking.apply(direction);

        if ("tap".equals(type)) {
            double speed = 6 + normPower * 10;
            direction.y = 0;
            direction.normalise();
            ball.velocity.x = direction.x * speed;
            ball.velocity.y = 1.2;
            ball.velocity.z = direction.z * speed;
        } else if ("through_pass".equals(type)) {
            double speed = 8 + normPower * 12;
            direction.y = 0;
            direction.normalise();
            ball.velocity.x = direction.x * speed;
            ball.velocity.y = 0.8;
            ball.velocity.z = direction.z * speed;
        } else if ("cross".equals(type)) {
            double speed = 10 + normPower * 14;
            direction.normalise();
            ball.velocity.x = direction.x * speed;
            ball.velocity.y = 7 + normPower * 8;
            ball.velocity.z = direction.z * speed;
        } else {
            double speed = 16 + normPower * 24;
            direction.normalise();
            ball.velocity.x = direction.x * speed;
            ball.velocity.y = (direction.y + 0.3) * speed * 0.55;
            ball.velocity.z = direction.z * speed;
        }

        if (curve != 0) {
            ball.spin.y = curve * 18;
        }

        try {
            JSONObject payload = new JSONObject();
            payload.put("id", clientId);
            payload.put("type", type);
            payload.put("power", power);
            broadcaster.sendToAll("action", payload);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build action payload", e);
        }
    }

    private boolean isCloseToBall(String clientId) {
        GamePlayerState p = players.get(clientId);
        if (p == null) return false;
        double dx = ball.position.x - p.position.x;
        double dz = ball.position.z - p.position.z;
        return Math.hypot(dx, dz) < 3.8;
    }

    private void scoreGoal(int team) {
        goalScored = true;
        score[team] += 1;
        Log.d(TAG, "[3D Game] GOAL! " + score[0] + "-" + score[1] + " team=" + team + " scorer=" + lastKick);

        try {
            JSONObject payload = new JSONObject();
            payload.put("score", scoreJson());
            payload.put("team", team);
            payload.put("scorer", lastKick);
            broadcaster.sendToAll("goal", payload);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build goal payload", e);
        }

        scheduler.schedule(this::resetBall, 3000, TimeUnit.MILLISECONDS);
    }

    // ---------------------------------------------------------------
    // Physics loop - mirrors updateGamePhysics() in app.js
    // ---------------------------------------------------------------

    private void updateGamePhysics() {
        for (GamePlayerState state : players.values()) {
            Vec3 direction = new Vec3(0, 0, 0);
            double speed = 6.5;

            Set<String> input = state.input;
            if (input.contains("forward")) direction.z -= 1;
            if (input.contains("backward")) direction.z += 1;
            if (input.contains("right")) direction.x += 1;
            if (input.contains("left")) direction.x -= 1;
            if (input.contains("sprint") && input.contains("forward")) speed = 9.0;

            state.looking.apply(direction);
            direction.y = 0;
            direction.normalise();

            state.velocity.x = direction.x * speed;
            state.velocity.y += GAME_GRAVITY * DT;
            state.velocity.z = direction.z * speed;

            state.position.x += state.velocity.x * DT;
            state.position.y += state.velocity.y * DT;
            if (state.position.y <= 0) {
                state.position.y = 0;
                state.velocity.y = 0;
            }
            state.position.z += state.velocity.z * DT;

            boolean isGoalArea = (state.position.z > 19.0 || state.position.z < -19.0)
                    && (state.position.x > -4.0 && state.position.x < 4.0);

            if (!isGoalArea) {
                state.position.x = clamp(state.position.x, -14.8, 14.8);
                state.position.z = clamp(state.position.z, -19.8, 19.8);
            } else {
                state.position.x = clamp(state.position.x, -3.8, 3.8);
                state.position.z = clamp(state.position.z, -21.5, 21.5);
            }
        }

        handlePlayerPlayerCollisions();
        handleSmoothDribbling();
        handlePortalTeleportation();

        if (Math.abs(ball.spin.y) > 0.01) {
            double curveAcceleration = ball.spin.y * 0.35;
            ball.velocity.x += curveAcceleration * DT * Math.signum(ball.velocity.z != 0 ? ball.velocity.z : 1);
            ball.velocity.z -= curveAcceleration * DT * Math.signum(ball.velocity.x != 0 ? ball.velocity.x : 1);
            ball.spin.y *= 0.95;
        }

        ball.acceleration.x = -0.45 * ball.velocity.x;
        ball.acceleration.z = -0.45 * ball.velocity.z;

        ball.velocity.x += ball.acceleration.x * DT;
        ball.velocity.y += ball.acceleration.y * DT;
        ball.velocity.z += ball.acceleration.z * DT;

        final double RADIUS = 0.2;

        ball.position.x += ball.velocity.x * DT;
        ball.position.y += ball.velocity.y * DT;

        if (ball.position.y <= RADIUS) {
            ball.position.y = RADIUS;
            ball.velocity.y = -GRASS_E * ball.velocity.y;
            ball.velocity.x *= 0.93;
            ball.velocity.z *= 0.93;
        }

        ball.position.z += ball.velocity.z * DT;

        if (ball.position.z + RADIUS > 20) {
            if (ball.position.x - RADIUS > -3.75 && ball.position.x + RADIUS < 3.75 && ball.position.y < 5.8) {
                if (!goalScored) scoreGoal(1);
            } else {
                ball.position.z = 20 - RADIUS;
                ball.velocity.z = -SIDE_E * ball.velocity.z;
            }
        } else if (ball.position.z - RADIUS < -20) {
            if (ball.position.x - RADIUS > -3.75 && ball.position.x + RADIUS < 3.75 && ball.position.y < 5.8) {
                if (!goalScored) scoreGoal(0);
            } else {
                ball.position.z = -20 + RADIUS;
                ball.velocity.z = -SIDE_E * ball.velocity.z;
            }
        } else if (ball.position.x + RADIUS <= -15) {
            ball.position.x = -15 + RADIUS;
            ball.velocity.x = -SIDE_E * ball.velocity.x;
        } else if (ball.position.x - RADIUS >= 15) {
            ball.position.x = 15 - RADIUS;
            ball.velocity.x = -SIDE_E * ball.velocity.x;
        }

        try {
            JSONObject payload = new JSONObject();
            payload.put("players", playersJson());
            payload.put("ball", ball.toJson());
            broadcaster.sendToAll("tick", payload);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build tick payload", e);
        }
    }

    private void handlePlayerPlayerCollisions() {
        String[] ids = players.keySet().toArray(new String[0]);
        final double minDist = 0.95;

        for (int i = 0; i < ids.length; i++) {
            for (int j = i + 1; j < ids.length; j++) {
                GamePlayerState p1 = players.get(ids[i]);
                GamePlayerState p2 = players.get(ids[j]);
                if (p1 == null || p2 == null) continue;

                double dx = p1.position.x - p2.position.x;
                double dz = p1.position.z - p2.position.z;
                double dist = Math.hypot(dx, dz);

                if (dist < minDist && dist > 0.001) {
                    double overlap = (minDist - dist) / 2;
                    double nx = dx / dist;
                    double nz = dz / dist;
                    p1.position.x += nx * overlap;
                    p1.position.z += nz * overlap;
                    p2.position.x -= nx * overlap;
                    p2.position.z -= nz * overlap;
                }
            }
        }
    }

    private void handleSmoothDribbling() {
        final double DRIBBLE_DIST = 1.35;
        for (GamePlayerState player : players.values()) {
            double dx = ball.position.x - player.position.x;
            double dz = ball.position.z - player.position.z;
            double dist = Math.hypot(dx, dz);

            if (dist < DRIBBLE_DIST && ball.position.y < 2.0) {
                double ballSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
                if (ballSpeed < 10.0) {
                    Vec3 dir = new Vec3(0, 0, -1);
                    player.looking.apply(dir);
                    dir.y = 0;
                    dir.normalise();

                    ball.velocity.x = player.velocity.x * 1.1 + dir.x * 4.0;
                    ball.velocity.z = player.velocity.z * 1.1 + dir.z * 4.0;
                }
            }
        }
    }

    private void handlePortalTeleportation() {
        for (GamePlayerState player : players.values()) {
            double distToBluePortal = Math.hypot(player.position.x - 0, player.position.z - (-28.0));
            if (distToBluePortal < 3.5) {
                player.position.x = 0;
                player.position.y = 0;
                player.position.z = -100.0;
                continue;
            }

            double distToPinkPortal = Math.hypot(player.position.x - 0, player.position.z - (-105.0));
            if (distToPinkPortal < 3.5) {
                player.position.x = 0;
                player.position.y = 0;
                player.position.z = -25.0;
                continue;
            }

            if (player.position.z < -26.0 && player.position.z > -95.0) {
                if (player.position.z > -60.0) {
                    player.position.z = -25.5;
                } else {
                    player.position.z = -95.5;
                }
            }
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private static double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }

    private JSONArray scoreJson() {
        JSONArray arr = new JSONArray();
        arr.put(score[0]);
        arr.put(score[1]);
        return arr;
    }

    private JSONObject playersJson() throws JSONException {
        JSONObject obj = new JSONObject();
        for (Map.Entry<String, GamePlayerState> entry : players.entrySet()) {
            obj.put(entry.getKey(), entry.getValue().toJson());
        }
        return obj;
    }
}
