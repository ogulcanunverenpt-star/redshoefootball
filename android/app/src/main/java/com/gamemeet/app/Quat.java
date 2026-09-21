package com.gamemeet.app;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Simple quaternion {x, y, z, w}, mirroring the "looking" objects in app.js
 * and its standalone applyQuaternion(v, q) helper.
 */
public class Quat {
    public double x, y, z, w;

    public Quat() {
        this(0, 0, 0, 1);
    }

    public Quat(double x, double y, double z, double w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    /**
     * Mirrors applyQuaternion(v, q) in app.js: rotates the given vector
     * in place by this quaternion.
     */
    public void apply(Vec3 v) {
        double ix = w * v.x + y * v.z - z * v.y;
        double iy = w * v.y + z * v.x - x * v.z;
        double iz = w * v.z + x * v.y - y * v.x;
        double iw = -x * v.x - y * v.y - z * v.z;

        double nx = ix * w + iw * -x + iy * -z - iz * -y;
        double ny = iy * w + iw * -y + iz * -x - ix * -z;
        double nz = iz * w + iw * -z + ix * -y - iy * -x;

        v.x = nx;
        v.y = ny;
        v.z = nz;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("x", x);
        o.put("y", y);
        o.put("z", z);
        o.put("w", w);
        return o;
    }

    public static Quat fromJson(JSONObject o) {
        if (o == null) return new Quat();
        return new Quat(
                o.optDouble("x", 0),
                o.optDouble("y", 0),
                o.optDouble("z", 0),
                o.optDouble("w", 1)
        );
    }
}
