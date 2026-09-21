package com.gamemeet.app;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Simple mutable 3D vector. Mirrors the plain {x, y, z} objects used
 * throughout app.js (gameBall.position, player.velocity, etc.) plus its
 * standalone length()/normalise() helper functions.
 */
public class Vec3 {
    public double x, y, z;

    public Vec3() {
        this(0, 0, 0);
    }

    public Vec3(double x, double y, double z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    /** Mirrors length({x, y, z}) in app.js. */
    public double length() {
        return Math.sqrt(x * x + y * y + z * z);
    }

    /** Mirrors normalise(vector) in app.js: scales this vector to unit length in place. */
    public void normalise() {
        double magnitude = length();
        if (magnitude != 0) {
            double scalar = 1 / magnitude;
            x *= scalar;
            y *= scalar;
            z *= scalar;
        }
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("x", x);
        o.put("y", y);
        o.put("z", z);
        return o;
    }

    public static Vec3 fromJson(JSONObject o) {
        if (o == null) return new Vec3();
        return new Vec3(o.optDouble("x", 0), o.optDouble("y", 0), o.optDouble("z", 0));
    }
}
