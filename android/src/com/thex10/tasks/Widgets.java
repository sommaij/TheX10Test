package com.thex10.tasks;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Calendar;
import java.util.List;

/** Builds the home-screen widgets and their tap targets. */
final class Widgets {
    static final String ACTION_DONE = "com.thex10.tasks.DONE";
    static final String ACTION_REFRESH = "com.thex10.tasks.REFRESH";
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final String[] WD = {"อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."};
    private static final String[] MON = {"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."};

    private Widgets() {}

    /** Re-draws every placed widget from the stored data. */
    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, SummaryWidget.class))) {
            m.updateAppWidget(id, summary(c, m.getAppWidgetOptions(id)));
        }
        for (int id : m.getAppWidgetIds(new ComponentName(c, ListWidget.class))) {
            m.updateAppWidget(id, list(c, m.getAppWidgetOptions(id)));
        }
    }

    /** {accent, ink on accent, soft} for the current light/dark mode, or null to keep the built-in colours. */
    private static int[] accent(Context c, WidgetData d) {
        boolean night = (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        return night ? d.accentDark : d.accentLight;
    }

    /** Tints a view's rounded background. Remote tinting needs Android 12; older phones keep the default colour. */
    private static void tintBackground(RemoteViews v, int id, int color) {
        if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(id, "setBackgroundTintList", ColorStateList.valueOf(color));
    }

    private static void applyAccent(RemoteViews v, int[] a, int addButton) {
        if (a == null || Build.VERSION.SDK_INT < 31) return;
        tintBackground(v, addButton, a[0]);
        v.setInt(addButton, "setColorFilter", a[1]);
    }

    static RemoteViews summary(Context c, Bundle options) {
        String today = WidgetData.today();
        WidgetData data = WidgetData.load(c);
        WidgetData.Buckets b = data.buckets(today);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_summary);
        int[] a = accent(c, data);
        if (a != null) {
            v.setTextColor(R.id.brand, a[0]);
            v.setTextColor(R.id.num_today, a[0]);
            tintBackground(v, R.id.tile_today, a[2]);
        }
        applyAccent(v, a, R.id.btn_add);

        int dueToday = b.today.size() + b.doneToday;
        for (WidgetData.Task t : b.doing) if (today.equals(t.due)) dueToday++;
        v.setTextViewText(R.id.date, dateLabel());
        v.setTextViewText(R.id.brand, "X10 Tasks · เสร็จ " + b.doneToday + "/" + dueToday);
        v.setTextViewText(R.id.num_overdue, String.valueOf(b.overdue.size()));
        v.setTextViewText(R.id.num_today, String.valueOf(b.today.size()));
        v.setTextViewText(R.id.num_doing, String.valueOf(b.doing.size()));
        v.setTextViewText(R.id.num_done, String.valueOf(b.doneToday));
        int ink3 = c.getColor(R.color.ink3);
        if (b.overdue.isEmpty()) v.setTextColor(R.id.num_overdue, ink3);
        if (b.today.isEmpty()) v.setTextColor(R.id.num_today, ink3);
        if (b.doing.isEmpty()) v.setTextColor(R.id.num_doing, ink3);
        if (b.doneToday == 0) v.setTextColor(R.id.num_done, ink3);

        WidgetData.Task next = b.next();
        if (next == null) {
            v.setTextViewText(R.id.next_label, "");
            v.setTextViewText(R.id.next_title, c.getString(R.string.empty));
        } else {
            String label = "doing".equals(next.status) ? "กำลังทำ" : "ถัดไป";
            if (next.time != null) label += " " + next.time;
            v.setTextViewText(R.id.next_label, label);
            v.setTextColor(R.id.next_label, "doing".equals(next.status) ? c.getColor(R.color.doing) : a != null ? a[0] : c.getColor(R.color.accent));
            v.setTextViewText(R.id.next_title, next.title);
            v.setOnClickPendingIntent(R.id.next_row, open(c, "task/" + Uri.encode(next.id)));
            WidgetData.Step step = next.currentStep();
            if (step != null) {
                v.setViewVisibility(R.id.step_row, View.VISIBLE);
                v.setTextViewText(R.id.next_step, "ขั้น " + next.currentIndex() + "/" + next.steps.size() + " · " + step.title);
                v.setProgressBar(R.id.next_progress, 100, next.stepsDone() * 100 / next.steps.size(), false);
                v.setOnClickPendingIntent(R.id.step_row, open(c, "task/" + Uri.encode(next.id)));
            }
        }

        // Small widget: drop the next-task line, and the tile labels when narrow.
        int h = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int w = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        if (h > 0 && h < 100) {
            v.setViewVisibility(R.id.next_row, View.GONE);
            v.setViewVisibility(R.id.step_row, View.GONE);
        } else if (h > 0 && h < 130) {
            v.setViewVisibility(R.id.step_row, View.GONE);
        }
        int labels = w > 0 && w < 210 ? View.GONE : View.VISIBLE;
        v.setViewVisibility(R.id.label_overdue, labels);
        v.setViewVisibility(R.id.label_today, labels);
        v.setViewVisibility(R.id.label_doing, labels);
        v.setViewVisibility(R.id.label_done, labels);

        v.setOnClickPendingIntent(R.id.root, open(c, "home"));
        v.setOnClickPendingIntent(R.id.tile_overdue, open(c, "filter/overdue"));
        v.setOnClickPendingIntent(R.id.tile_today, open(c, "filter/today"));
        v.setOnClickPendingIntent(R.id.tile_doing, open(c, "filter/doing"));
        v.setOnClickPendingIntent(R.id.tile_done, open(c, "filter/done"));
        v.setOnClickPendingIntent(R.id.btn_add, open(c, "new"));
        v.setOnClickPendingIntent(R.id.btn_refresh, broadcast(c, ACTION_REFRESH, "refresh"));
        return v;
    }

    static RemoteViews list(Context c, Bundle options) {
        String today = WidgetData.today();
        WidgetData data = WidgetData.load(c);
        WidgetData.Buckets b = data.buckets(today);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_list);
        int[] a = accent(c, data);
        if (a != null) {
            v.setTextColor(R.id.count_today, a[0]);
            tintBackground(v, R.id.count_today, a[2]);
        }
        applyAccent(v, a, R.id.btn_add);
        v.setTextViewText(R.id.count_overdue, "เลย " + b.overdue.size());
        v.setTextViewText(R.id.count_today, "วันนี้ " + b.today.size());
        v.setTextViewText(R.id.count_doing, "ทำอยู่ " + b.doing.size());

        int h = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        int max = h > 0 ? Math.max(2, Math.min(8, (h - 80) / 44)) : 4;
        List<WidgetData.Task> rows = b.urgent();
        v.removeAllViews(R.id.rows);
        for (int i = 0; i < Math.min(max, rows.size()); i++) v.addView(R.id.rows, row(c, rows.get(i), today, i == 0));
        v.setViewVisibility(R.id.empty, rows.isEmpty() ? View.VISIBLE : View.GONE);
        if (rows.size() > max) {
            v.setTextViewText(R.id.more, "อีก " + (rows.size() - max) + " งาน · แตะเพื่อเปิดแอป");
            v.setViewVisibility(R.id.more, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.more, View.GONE);
        }
        v.setOnClickPendingIntent(R.id.root, open(c, "home"));
        v.setOnClickPendingIntent(R.id.more, open(c, "home"));
        v.setOnClickPendingIntent(R.id.btn_add, open(c, "new"));
        v.setOnClickPendingIntent(R.id.btn_refresh, broadcast(c, ACTION_REFRESH, "refresh"));
        return v;
    }

    private static RemoteViews row(Context c, WidgetData.Task t, String today, boolean first) {
        RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_row);
        boolean doing = "doing".equals(t.status);
        r.setViewVisibility(R.id.row_divider, first ? View.GONE : View.VISIBLE);
        r.setTextViewText(R.id.row_title, t.title);
        r.setTextViewText(R.id.row_meta, meta(c, t, today));
        r.setImageViewResource(R.id.row_check, doing ? R.drawable.check_doing : R.drawable.check_ring);
        r.setInt(R.id.row_check, "setColorFilter", doing ? c.getColor(R.color.doing) : t.color);
        if (t.priority > 0) {
            r.setViewVisibility(R.id.row_flag, View.VISIBLE);
            r.setInt(R.id.row_flag, "setColorFilter", c.getColor(t.priority > 1 ? R.color.overdue : R.color.warn));
        }
        WidgetData.Step step = t.currentStep();
        if (step != null) {
            r.setViewVisibility(R.id.row_progress, View.VISIBLE);
            r.setProgressBar(R.id.row_progress, 100, t.stepsDone() * 100 / t.steps.size(), false);
        }
        // With steps, the tick finishes the current step; the last step finishes the task.
        r.setOnClickPendingIntent(R.id.row_check, step != null
                ? broadcast(c, ACTION_DONE, "step/" + Uri.encode(t.id) + "/" + Uri.encode(step.id))
                : broadcast(c, ACTION_DONE, "done/" + Uri.encode(t.id)));
        r.setOnClickPendingIntent(R.id.row_body, open(c, "task/" + Uri.encode(t.id)));
        return r;
    }

    /** "กำลังทำ · พรุ่งนี้ · 13:30 · งาน" with the status word coloured. */
    private static CharSequence meta(Context c, WidgetData.Task t, String today) {
        SpannableStringBuilder s = new SpannableStringBuilder();
        if ("doing".equals(t.status)) status(s, "กำลังทำ", c.getColor(R.color.doing));
        else if (t.due != null && t.due.compareTo(today) < 0) status(s, "เลยกำหนด", c.getColor(R.color.overdue));
        WidgetData.Step step = t.currentStep();
        if (step != null) part(s, "ขั้น " + t.currentIndex() + "/" + t.steps.size() + " " + step.title);
        if (t.due != null && !t.due.equals(today)) part(s, dayLabel(t.due, today));
        if (t.time != null) part(s, t.time);
        if (!t.category.isEmpty()) part(s, t.category);
        return s;
    }

    private static void status(SpannableStringBuilder s, String text, int color) {
        int start = s.length();
        s.append(text);
        s.setSpan(new ForegroundColorSpan(color), start, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        s.setSpan(new StyleSpan(Typeface.BOLD), start, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private static void part(SpannableStringBuilder s, String text) {
        if (s.length() > 0) s.append(" · ");
        s.append(text);
    }

    static String dateLabel() {
        Calendar k = Calendar.getInstance();
        return WD[k.get(Calendar.DAY_OF_WEEK) - 1] + " " + k.get(Calendar.DAY_OF_MONTH) + " " + MON[k.get(Calendar.MONTH)];
    }

    private static String dayLabel(String due, String today) {
        try {
            Calendar k = Calendar.getInstance();
            k.set(Integer.parseInt(due.substring(0, 4)), Integer.parseInt(due.substring(5, 7)) - 1, Integer.parseInt(due.substring(8, 10)), 12, 0, 0);
            Calendar t = Calendar.getInstance();
            t.set(Integer.parseInt(today.substring(0, 4)), Integer.parseInt(today.substring(5, 7)) - 1, Integer.parseInt(today.substring(8, 10)), 12, 0, 0);
            long days = Math.round((k.getTimeInMillis() - t.getTimeInMillis()) / 86400000.0);
            if (days == 1) return "พรุ่งนี้";
            if (days == -1) return "เมื่อวาน";
            return WD[k.get(Calendar.DAY_OF_WEEK) - 1] + " " + k.get(Calendar.DAY_OF_MONTH) + " " + MON[k.get(Calendar.MONTH)];
        } catch (RuntimeException e) {
            return due;
        }
    }

    /** Opens the app at x10://<what> (home, new, task/<id>, filter/<status>). */
    static PendingIntent open(Context c, String what) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("x10://" + what))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, i, FLAGS);
    }

    private static PendingIntent broadcast(Context c, String action, String what) {
        Intent i = new Intent(c, WidgetActionReceiver.class).setAction(action).setData(Uri.parse("x10://" + what));
        return PendingIntent.getBroadcast(c, 0, i, FLAGS);
    }
}
