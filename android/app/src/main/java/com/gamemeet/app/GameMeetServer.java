package com.gamemeet.app;

import android.content.Context;
import android.util.Log;
import fi.iki.elonen.NanoHTTPD;

import java.io.IOException;
import java.io.InputStream;

public class GameMeetServer extends NanoHTTPD {
    private static final String TAG = "GameMeetServer";
    private final Context context;

    public GameMeetServer(Context context, int port) {
        super(port);
        this.context = context;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        if (uri.equals("/")) {
            uri = "/index.html";
        }
        String assetPath = "public" + uri;

        try {
            InputStream is = context.getAssets().open(assetPath);
            String mimeType = getMimeTypeForFile(uri);
            return newFixedLengthResponse(Response.Status.OK, mimeType, is, is.available());
        } catch (IOException e) {
            try {
                InputStream is = context.getAssets().open("public/index.html");
                return newFixedLengthResponse(Response.Status.OK, "text/html", is, is.available());
            } catch (IOException ex) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404 Not Found");
            }
        }
    }
}
