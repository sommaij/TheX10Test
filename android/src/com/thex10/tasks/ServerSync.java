package com.thex10.tasks;

import android.content.BroadcastReceiver;
import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Talks to the X10 server so widgets stay current while the app is closed. */
final class ServerSync {
    private ServerSync() {}

    /** Fetches /api/v1/widget and redraws, without blocking the caller. */
    static void refreshInBackground(BroadcastReceiver receiver, final Context c) {
        if (WidgetData.server(c) == null) return;
        final BroadcastReceiver.PendingResult pending = receiver.goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (refresh(c)) Widgets.updateAll(c);
                } finally {
                    pending.finish();
                }
            }
        }).start();
    }

    static boolean refresh(Context c) {
        String body = request(c, "GET", "/api/v1/widget");
        if (body == null) return false;
        WidgetData.saveServerPayload(c, body);
        return true;
    }

    static boolean complete(Context c, String id) {
        return request(c, "POST", "/api/v1/tasks/" + android.net.Uri.encode(id) + "/complete") != null;
    }

    private static String request(Context c, String method, String path) {
        String[] server = WidgetData.server(c);
        if (server == null) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(server[0] + path).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("Authorization", "Bearer " + server[1]);
            conn.setRequestProperty("Accept", "application/json");
            if ("POST".equals(method)) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                OutputStream out = conn.getOutputStream();
                out.write("{}".getBytes("UTF-8"));
                out.close();
            }
            if (conn.getResponseCode() / 100 != 2) return null;
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            in.close();
            return buf.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
