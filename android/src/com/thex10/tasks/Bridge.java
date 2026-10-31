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

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

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

    /**
     * HTTP for talking to other apps' APIs from the phone itself, so their CORS rules do not apply.
     * The answer comes back through X10App.httpResult(id, {status, contentType, body} or {error}).
     */
    @JavascriptInterface
    public void httpRequest(final String id, final String method, final String url, final String headersJson, final String body) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                HttpURLConnection conn = null;
                try {
                    if (!url.startsWith("https://") && !url.startsWith("http://")) throw new IOException("URL must start with http:// or https://");
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    String m = method == null ? "GET" : method.toUpperCase();
                    if (!m.matches("GET|POST|PUT|PATCH|DELETE")) m = "GET";
                    conn.setRequestMethod(m); // Android's HttpURLConnection accepts PATCH
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(15000);
                    conn.setInstanceFollowRedirects(true);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    Iterator<String> keys = h.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        conn.setRequestProperty(k, h.optString(k));
                    }
                    if ((m.equals("POST") || m.equals("PUT") || m.equals("PATCH")) && body != null && !body.isEmpty()) {
                        conn.setDoOutput(true);
                        OutputStream os = conn.getOutputStream();
                        os.write(body.getBytes("UTF-8"));
                        os.close();
                    }
                    int status = conn.getResponseCode();
                    InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    if (in != null) {
                        byte[] chunk = new byte[8192];
                        int n;
                        while ((n = in.read(chunk)) > 0 && buf.size() < 2 * 1024 * 1024) buf.write(chunk, 0, n);
                        in.close();
                    }
                    out.put("status", status);
                    out.put("contentType", conn.getContentType() == null ? "" : conn.getContentType());
                    out.put("body", buf.toString("UTF-8"));
                } catch (Exception e) {
                    try {
                        out.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                    } catch (JSONException ignored) {
                        // cannot happen with a string value
                    }
                } finally {
                    if (conn != null) conn.disconnect();
                }
                activity.runJs("window.X10App && X10App.httpResult(" + JSONObject.quote(id) + "," + JSONObject.quote(out.toString()) + ")");
            }
        }).start();
    }

    @JavascriptInterface
    public String platform() {
        return "android " + Build.VERSION.SDK_INT;
    }

    private SharedPreferences prefs() {
        return app.getSharedPreferences("x10_app", Context.MODE_PRIVATE);
    }
}
