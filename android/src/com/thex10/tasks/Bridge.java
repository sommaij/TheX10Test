package com.thex10.tasks;

import android.app.NotificationManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/** window.X10Native — what the web app can ask of the Android app. */
final class Bridge {
    private static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private final MainActivity activity;
    private final Context app;

    Bridge(MainActivity activity) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
    }

    /** Full app state, mirrored outside the WebView so it survives cache clears. */
    @JavascriptInterface
    public void saveState(String json) {
        File tmp = new File(app.getFilesDir(), "state.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes("UTF-8"));
        } catch (IOException e) {
            return;
        }
        tmp.renameTo(new File(app.getFilesDir(), "state.json"));
    }

    @JavascriptInterface
    public String loadState() {
        File f = new File(app.getFilesDir(), "state.json");
        if (!f.exists()) return "";
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int read = 0;
            while (read < buf.length) {
                int n = in.read(buf, read, buf.length - read);
                if (n < 0) break;
                read += n;
            }
            return new String(buf, 0, read, "UTF-8");
        } catch (IOException e) {
            return "";
        }
    }

    @JavascriptInterface
    public void updateWidgets(String payload) {
        WidgetData.savePayload(app, payload);
        Widgets.updateAll(app);
    }

    @JavascriptInterface
    public void scheduleReminders(String json) {
        Reminders.schedule(app, json);
    }

    @JavascriptInterface
    public String takeWidgetActions() {
        return WidgetData.takeActions(app);
    }

    @JavascriptInterface
    public void setServer(String url, String key) {
        WidgetData.setServer(app, url, key);
    }

    @JavascriptInterface
    public boolean canPinWidget() {
        return Build.VERSION.SDK_INT >= 26 && app.getSystemService(AppWidgetManager.class).isRequestPinAppWidgetSupported();
    }

    @JavascriptInterface
    public boolean pinWidget(String kind) {
        if (!canPinWidget()) return false;
        Class<?> cls = "list".equals(kind) ? ListWidget.class : SummaryWidget.class;
        return app.getSystemService(AppWidgetManager.class).requestPinAppWidget(new ComponentName(app, cls), null, null);
    }

    @JavascriptInterface
    public String notificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (app.checkSelfPermission(POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return "granted";
            boolean asked = prefs().getBoolean("asked_notifications", false);
            if (!asked || activity.shouldShowRequestPermissionRationale(POST_NOTIFICATIONS)) return "default";
            return "denied";
        }
        return ((NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled() ? "granted" : "denied";
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && "default".equals(notificationPermission())) {
            prefs().edit().putBoolean("asked_notifications", true).apply();
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    activity.requestPermissions(new String[] {POST_NOTIFICATIONS}, MainActivity.REQ_NOTIFICATIONS);
                }
            });
        } else {
            Intent i = Build.VERSION.SDK_INT >= 26
                    ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app.getPackageName())
                    : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + app.getPackageName()));
            try {
                app.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (RuntimeException e) {
                // no settings screen to open
            }
        }
    }

    @JavascriptInterface
    public void openUrl(String url) {
        try {
            app.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException e) {
            // no app can open this link
        }
    }

    @JavascriptInterface
    public String platform() {
        return "android " + Build.VERSION.SDK_INT;
    }

    private SharedPreferences prefs() {
        return app.getSharedPreferences("x10_app", Context.MODE_PRIVATE);
    }
}
