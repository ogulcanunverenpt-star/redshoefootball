package com.cundai.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.pedro.common.AudioCodec;
import com.pedro.common.ConnectChecker;
import com.pedro.library.rtsp.RtspDisplay;

public class ScreenShareService extends Service implements ConnectChecker {

    private static final String TAG = "ScreenShareService";
    private static final String CHANNEL_ID = "ScreenShareChannel";
    private static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "ACTION_START";
    public static final String ACTION_STOP = "ACTION_STOP";
    public static final String EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE";
    public static final String EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA";
    public static final String EXTRA_RTSP_URL = "EXTRA_RTSP_URL";

    private RtspDisplay rtspDisplay;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        rtspDisplay = new RtspDisplay(this, false, this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent resultData = getResultDataExtra(intent);
            String rtspUrl = intent.getStringExtra(EXTRA_RTSP_URL);

            if (rtspUrl != null && resultData != null) {
                startForegroundServiceWithNotification();
                startStreaming(resultCode, resultData, rtspUrl);
            }
        } else if (ACTION_STOP.equals(action)) {
            stopStreaming();
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private Intent getResultDataExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            return intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
    }

    private void startForegroundServiceWithNotification() {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Ekran ve Ses Paylaşımı")
                .setContentText("Ekranınız ve mikrofon sesiniz yayınlanıyor...")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int foregroundType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                foregroundType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }
            startForeground(NOTIFICATION_ID, notification, foregroundType);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Screen Share Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void startStreaming(int resultCode, Intent resultData, String rtspUrl) {
        if (rtspDisplay == null) return;

        int width = 1280;
        int height = 720;
        int fps = 15;
        int bitrate = 1500 * 1024;
        int rotation = 0;
        int dpi = getResources().getDisplayMetrics().densityDpi;

        rtspDisplay.setIntentResult(resultCode, resultData);

        try {
            rtspDisplay.setAudioCodec(AudioCodec.OPUS);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set OPUS audio codec", e);
        }

        boolean audioPrepared = false;
        try {
            audioPrepared = rtspDisplay.prepareAudio(MediaRecorder.AudioSource.MIC, 128 * 1024, 48000, true, true, true);
        } catch (Exception e) {
            Log.w(TAG, "Failed 48kHz stereo audio prep, trying mono...", e);
        }

        if (!audioPrepared) {
            try {
                audioPrepared = rtspDisplay.prepareAudio(MediaRecorder.AudioSource.MIC, 64 * 1024, 48000, false, true, true);
            } catch (Exception e) {
                Log.w(TAG, "Failed 48kHz mono audio prep, trying VOICE_COMMUNICATION...", e);
            }
        }

        if (!audioPrepared) {
            try {
                audioPrepared = rtspDisplay.prepareAudio(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 64 * 1024, 48000, false, true, true);
            } catch (Exception e) {
                Log.e(TAG, "All audio prepare attempts failed", e);
            }
        }

        boolean videoPrepared = rtspDisplay.prepareVideo(width, height, fps, bitrate, rotation, dpi);

        if (videoPrepared || audioPrepared) {
            rtspDisplay.startStream(rtspUrl);
            Log.d(TAG, "Streaming started (Video: " + videoPrepared + ", Audio (OPUS): " + audioPrepared + ") to: " + rtspUrl);
        } else {
            Log.e(TAG, "Failed to prepare RTSP stream.");
        }
    }

    private void stopStreaming() {
        if (rtspDisplay != null && rtspDisplay.isStreaming()) {
            rtspDisplay.stopStream();
            Log.d(TAG, "Streaming stopped.");
        }
    }

    @Override
    public void onDestroy() {
        stopStreaming();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onConnectionStarted(@NonNull String url) {
        Log.d(TAG, "RTSP Connection started: " + url);
    }

    @Override
    public void onConnectionSuccess() {
        Log.d(TAG, "RTSP Connection success!");
    }

    @Override
    public void onConnectionFailed(@NonNull String reason) {
        Log.e(TAG, "RTSP Connection failed: " + reason);
        stopStreaming();
        stopSelf();
    }

    @Override
    public void onDisconnect() {
        Log.d(TAG, "RTSP Disconnected.");
    }

    @Override
    public void onAuthError() {
        Log.e(TAG, "RTSP Auth error.");
    }

    @Override
    public void onAuthSuccess() {
        Log.d(TAG, "RTSP Auth success.");
    }

    @Override
    public void onNewBitrate(long bitrate) {
        Log.d(TAG, "New bitrate: " + bitrate);
    }
}
