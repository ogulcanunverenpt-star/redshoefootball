package com.gamemeet.app;

import org.json.JSONException;
import org.json.JSONObject;

/** Mirrors the gameBall object in app.js: { position, velocity, acceleration, spin }. */
public class GameBallState {
    public Vec3 position;
    public Vec3 velocity;
    public Vec3 acceleration;
    public Vec3 spin;

    public GameBallState(double gravity) {
        position = new Vec3(0, 4, -4);
        velocity = new Vec3(0, 0, 0);
        acceleration = new Vec3(0, gravity, 0);
        spin = new Vec3(0, 0, 0);
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("position", position.toJson());
        o.put("velocity", velocity.toJson());
        o.put("acceleration", acceleration.toJson());
        o.put("spin", spin.toJson());
        return o;
    }
}
