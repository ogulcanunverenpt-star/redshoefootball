package com.gamemeet.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.IOException;

public class GameMeetService extends Service {
    private static final String TAG = "GameMeetService";
    private static final String CHANNEL_ID = "GameMeetServiceChannel";
    private static final int NOTIFICATION_ID = 2002;
    private GameMeetServer gameMeetServer;
    private GameMeetSocketServer socketServer;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        
        // Start HTTP Static Server on port 5000
        try {
            gameMeetServer = new GameMeetServer(this, 5000);
            gameMeetServer.start();
        } catch (IOException e) {
            Log.e(TAG, "Failed to start NanoHTTPD server", e);
        }

        // Start WebSocket Real-time Server on port 5001
        try {
            socketServer = new GameMeetSocketServer(5001);
            socketServer.start();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start WebSocket server", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("GameMeet Server & Socket Aktif")
                .setContentText("Java HTTP (5000) & WebSocket (5001) çalışıyor")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .build();

        startForeground(NOTIFICATION_ID, notification);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (gameMeetServer != null) {
            gameMeetServer.stop();
        }
        if (socketServer != null) {
            try {
                socketServer.stop();
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "GameMeet Service Channel",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
