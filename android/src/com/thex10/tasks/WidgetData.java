package com.thex10.tasks;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Task data shown on the home-screen widgets. The web app (or the server) sends a compact
 * payload; buckets are recomputed here with the phone's current date so they stay right after midnight.
 */
final class WidgetData {
    private static final String PREFS = "x10_widget";

    static final class Task {
        String id, title, due, time, status, category, subtasks;
        int priority, color;
    }

    static final class Buckets {
        final List<Task> doing = new ArrayList<>();
        final List<Task> overdue = new ArrayList<>();
        final List<Task> today = new ArrayList<>();
        final List<Task> upcoming = new ArrayList<>();
        final List<Task> nodate = new ArrayList<>();
        int doneToday;

        /** Most urgent first: in progress, overdue, today, then the next few days. */
        List<Task> urgent() {
            List<Task> out = new ArrayList<>(doing);
            out.addAll(overdue);
            out.addAll(today);
            out.addAll(upcoming.subList(0, Math.min(4, upcoming.size())));
            out.addAll(nodate.subList(0, Math.min(2, nodate.size())));
            return out;
        }

        Task next() {
            if (!doing.isEmpty()) return doing.get(0);
            if (!overdue.isEmpty()) return overdue.get(0);
            for (Task t : today) if (t.time != null) return t;
            return today.isEmpty() ? null : today.get(0);
        }
    }

    final List<Task> tasks = new ArrayList<>();
    JSONObject doneDays = new JSONObject();

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    static WidgetData load(Context c) {
        return parse(prefs(c).getString("payload", null));
    }

    static WidgetData parse(String raw) {
        WidgetData d = new WidgetData();
        if (raw == null) return d;
        try {
            JSONObject o = new JSONObject(raw);
            JSONArray arr = o.optJSONArray("tasks");
            for (int i = 0; arr != null && i < arr.length(); i++) {
                JSONObject j = arr.getJSONObject(i);
                Task t = new Task();
                t.id = j.optString("id");
                t.title = j.optString("title");
                t.due = str(j, "due");
                t.time = str(j, "time");
                t.status = j.optString("status", "todo");
                t.category = j.optString("category", "");
                t.subtasks = j.optString("subtasks", "");
                t.priority = j.optInt("priority", 0);
                t.color = parseColor(j.optString("color"), 0xFF6F8592);
                d.tasks.add(t);
            }
            JSONObject dd = o.optJSONObject("doneDays");
            if (dd != null) d.doneDays = dd;
        } catch (JSONException e) {
            // keep whatever parsed; a bad payload must never crash the launcher
        }
        return d;
    }

    Buckets buckets(String today) {
        Buckets b = new Buckets();
        for (Task t : tasks) {
            if ("doing".equals(t.status)) b.doing.add(t);
            else if (t.due == null) b.nodate.add(t);
            else if (t.due.compareTo(today) < 0) b.overdue.add(t);
            else if (t.due.equals(today)) b.today.add(t);
            else b.upcoming.add(t);
        }
        Comparator<Task> order = new Comparator<Task>() {
            @Override
            public int compare(Task a, Task z) {
                int c = nz(a.due, "9999").compareTo(nz(z.due, "9999"));
                if (c == 0) c = nz(a.time, "99:99").compareTo(nz(z.time, "99:99"));
                if (c == 0) c = z.priority - a.priority;
                return c;
            }
        };
        Collections.sort(b.doing, order);
        Collections.sort(b.overdue, order);
        Collections.sort(b.today, order);
        Collections.sort(b.upcoming, order);
        b.doneToday = doneDays.optInt(today, 0);
        return b;
    }

    // ---------- storage ----------

    static void savePayload(Context c, String json) {
        prefs(c).edit().putString("payload", json).apply();
    }

    /** Ticked on the widget: hide it now, count it as done today, and tell the app next time it opens. */
    static synchronized void markDone(Context c, String id) {
        SharedPreferences p = prefs(c);
        try {
            JSONObject o = new JSONObject(p.getString("payload", "{}"));
            JSONArray arr = o.optJSONArray("tasks");
            JSONArray kept = new JSONArray();
            boolean removed = false;
            for (int i = 0; arr != null && i < arr.length(); i++) {
                JSONObject j = arr.getJSONObject(i);
                if (id.equals(j.optString("id"))) removed = true;
                else kept.put(j);
            }
            o.put("tasks", kept);
            if (removed) {
                JSONObject dd = o.optJSONObject("doneDays");
                if (dd == null) dd = new JSONObject();
                String day = today();
                dd.put(day, dd.optInt(day, 0) + 1);
                o.put("doneDays", dd);
            }
            JSONArray actions = new JSONArray(p.getString("actions", "[]"));
            actions.put(new JSONObject().put("type", "done").put("id", id).put("at", System.currentTimeMillis()));
            p.edit().putString("payload", o.toString()).putString("actions", actions.toString()).apply();
        } catch (JSONException e) {
            // ignore: the tap is lost rather than corrupting stored data
        }
    }

    /** Server data replaces ours, except tasks the user just ticked here and the server has not seen yet. */
    static synchronized void saveServerPayload(Context c, String json) {
        try {
            JSONObject o = new JSONObject(json);
            JSONArray pending = new JSONArray(prefs(c).getString("actions", "[]"));
            if (pending.length() > 0) {
                List<String> ids = new ArrayList<>();
                for (int i = 0; i < pending.length(); i++) ids.add(pending.getJSONObject(i).optString("id"));
                JSONArray arr = o.optJSONArray("tasks");
                JSONArray kept = new JSONArray();
                for (int i = 0; arr != null && i < arr.length(); i++) {
                    if (!ids.contains(arr.getJSONObject(i).optString("id"))) kept.put(arr.getJSONObject(i));
                }
                o.put("tasks", kept);
            }
            savePayload(c, o.toString());
        } catch (JSONException e) {
            // not JSON: keep the old data
        }
    }

    static synchronized String takeActions(Context c) {
        SharedPreferences p = prefs(c);
        String a = p.getString("actions", "[]");
        p.edit().putString("actions", "[]").apply();
        return a;
    }

    static void setServer(Context c, String url, String key) {
        SharedPreferences.Editor e = prefs(c).edit();
        if (url == null || url.isEmpty() || key == null || key.isEmpty()) e.remove("server_url").remove("server_key");
        else e.putString("server_url", url.replaceAll("/+$", "")).putString("server_key", key);
        e.apply();
    }

    /** {url, key} or null when the app is not connected to an X10 server. */
    static String[] server(Context c) {
        SharedPreferences p = prefs(c);
        String url = p.getString("server_url", null);
        String key = p.getString("server_key", null);
        return url == null || key == null ? null : new String[] {url, key};
    }

    // ---------- helpers ----------

    private static String str(JSONObject j, String k) {
        return j.isNull(k) ? null : j.optString(k, null);
    }

    private static String nz(String s, String d) {
        return s == null ? d : s;
    }

    static int parseColor(String hex, int fallback) {
        try {
            if (hex != null && hex.matches("#[0-9a-fA-F]{6}")) return 0xFF000000 | Integer.parseInt(hex.substring(1), 16);
        } catch (NumberFormatException e) {
            // fall through
        }
        return fallback;
    }
}
