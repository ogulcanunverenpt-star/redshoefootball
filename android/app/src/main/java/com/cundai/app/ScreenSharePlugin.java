package com.cundai.app;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenShare")
public class ScreenSharePlugin extends Plugin {

    private static final int SCREEN_SHARE_REQUEST_CODE = 1001;
    private String savedRtspUrl = "rtsp://localhost:8554/live";
    private PluginCall savedCall;

    @PluginMethod
    public void startScreenShare(PluginCall call) {
        savedCall = call;
        savedRtspUrl = call.getString("rtspUrl", "rtsp://localhost:8554/live");

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            call.reject("Screen sharing requires Android 5.0 (API 21) or higher.");
            return;
        }

        MediaProjectionManager projectionManager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (projectionManager != null) {
            Intent intent = projectionManager.createScreenCaptureIntent();
            startActivityForResult(call, intent, SCREEN_SHARE_REQUEST_CODE);
        } else {
            call.reject("MediaProjectionManager not available.");
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode == SCREEN_SHARE_REQUEST_CODE) {
            if (savedCall == null) return;

            if (resultCode == Activity.RESULT_OK && data != null) {
                Intent serviceIntent = new Intent(getContext(), ScreenShareService.class);
                serviceIntent.setAction(ScreenShareService.ACTION_START);
                serviceIntent.putExtra(ScreenShareService.EXTRA_RESULT_CODE, resultCode);
                serviceIntent.putExtra(ScreenShareService.EXTRA_RESULT_DATA, data);
                serviceIntent.putExtra(ScreenShareService.EXTRA_RTSP_URL, savedRtspUrl);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(serviceIntent);
                } else {
                    getContext().startService(serviceIntent);
                }

                savedCall.resolve();
            } else {
                savedCall.reject("Screen share permission denied by user.");
            }
            savedCall = null;
        }
    }

    @PluginMethod
    public void stopScreenShare(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ScreenShareService.class);
        serviceIntent.setAction(ScreenShareService.ACTION_STOP);
        getContext().startService(serviceIntent);
        call.resolve();
    }
}
