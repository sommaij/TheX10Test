package com.thex10.tasks;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Task reminders as Android notifications, so they ring even when the app is closed. */
final class Reminders {
    private static final String PREFS = "x10_reminders";
    static final String CHANNEL = "reminders";
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    private Reminders() {}

    /** Replaces all scheduled reminders with [{id, at, title, body}]. */
    static synchronized void schedule(Context c, String json) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        try {
            JSONArray old = new JSONArray(p.getString("items", "[]"));
            for (int i = 0; i < old.length(); i++) {
                PendingIntent pi = PendingIntent.getBroadcast(c, 0, intent(c, old.getJSONObject(i)), PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                if (pi != null) {
                    am.cancel(pi);
                    pi.cancel();
                }
            }
            JSONArray items = new JSONArray(json);
            long now = System.currentTimeMillis();
            JSONArray kept = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject r = items.getJSONObject(i);
                if (r.optLong("at") <= now) continue;
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.optLong("at"), PendingIntent.getBroadcast(c, 0, intent(c, r), FLAGS));
                kept.put(r);
            }
            p.edit().putString("items", kept.toString()).apply();
        } catch (JSONException e) {
            // keep previous alarms when the list is unreadable
        }
    }

    /** After a reboot or app update, alarms are gone; set them again. */
    static void restore(Context c) {
        schedule(c, c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("items", "[]"));
    }

    private static Intent intent(Context c, JSONObject r) {
        return new Intent(c, ReminderReceiver.class)
                .setData(Uri.parse("x10://remind/" + Uri.encode(r.optString("id")) + "/" + r.optLong("at")))
                .putExtra("id", r.optString("id"))
                .putExtra("title", r.optString("title"))
                .putExtra("body", r.optString("body"));
    }

    static void notify(Context c, String id, String title, String body) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH));
            b = new Notification.Builder(c, CHANNEL);
        } else {
            b = new Notification.Builder(c).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }
        b.setSmallIcon(R.drawable.ic_notify)
                .setColor(c.getColor(R.color.accent))
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(Widgets.open(c, "task/" + Uri.encode(id)));
        try {
            nm.notify(id.hashCode(), b.build());
        } catch (SecurityException e) {
            // notifications not allowed
        }
    }
}
