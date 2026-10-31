package com.thex10.tasks;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
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
    private static final String[] WD_FULL = {"วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"};
    private static final String[] MON_FULL = {"มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"};
    private static final int DEFAULT_ACCENT = 0xFF0A7A70;
    // status colours that read well on the dark gradient card
    private static final int ON_CARD_OVERDUE = 0xFFFFA594;
    private static final int ON_CARD_TODAY = 0xFFFFFFFF;
    private static final int ON_CARD_DOING = 0xFFFFC65C;
    private static final int ON_CARD_DONE = 0xFF8FE3B4;
    private static final int ON_CARD_MUTED = 0x8CFFFFFF;

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

    private static boolean night(Context c) {
        return (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The colour the card is painted in: the user's app colour (light variant), or the default lagoon. */
    private static int cardColor(WidgetData d) {
        return d.accentLight != null ? d.accentLight[0] : DEFAULT_ACCENT;
    }

    /**
     * Paints the gradient card into an ImageView. Size comes from the widget's options (portrait: min width × max
     * height), capped so the bitmap stays small. fixedHeightDp > 0 paints a header strip of that height instead.
     */
    private static void paintCard(Context c, RemoteViews v, int imageId, int rootId, Bundle o, int defW, int defH, int fixedHeightDp, boolean roundBottom, int color) {
        try {
            float density = c.getResources().getDisplayMetrics().density;
            int wdp = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int hdp = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            if (wdp <= 0) wdp = defW;
            if (hdp <= 0) hdp = defH;
            if (fixedHeightDp > 0) hdp = fixedHeightDp;
            float scale = Math.min(density, 900f / Math.max(wdp, hdp));
            Bitmap bmp = WidgetArt.card(Math.round(wdp * scale), Math.round(hdp * scale), 24 * scale, color, night(c), roundBottom);
            v.setImageViewBitmap(imageId, bmp);
            v.setInt(rootId, "setBackgroundResource", 0);
        } catch (RuntimeException | OutOfMemoryError e) {
            // keep the plain gradient background from the layout
        }
    }

    private static void ring(RemoteViews v, int done, int total) {
        v.setProgressBar(R.id.ring, 100, total == 0 ? 0 : done * 100 / total, false);
        v.setTextViewText(R.id.ring_text, done + "/" + total);
    }

    private static void tile(RemoteViews v, int num, int dot, int count, int color) {
        v.setTextViewText(num, String.valueOf(count));
        v.setTextColor(num, count == 0 ? ON_CARD_MUTED : 0xFFFFFFFF);
        v.setInt(dot, "setColorFilter", count == 0 ? ON_CARD_MUTED : color);
    }

    static RemoteViews summary(Context c, Bundle options) {
        String today = WidgetData.today();
        WidgetData data = WidgetData.load(c);
        WidgetData.Buckets b = data.buckets(today);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_summary);
        int color = cardColor(data);
        paintCard(c, v, R.id.bg, R.id.root, options, 320, 160, 0, true, color);
        v.setInt(R.id.btn_add, "setColorFilter", color);

        int dueToday = b.today.size() + b.doneToday;
        for (WidgetData.Task t : b.doing) if (today.equals(t.due)) dueToday++;
        Calendar k = Calendar.getInstance();
        v.setTextViewText(R.id.date_num, String.valueOf(k.get(Calendar.DAY_OF_MONTH)));
        v.setTextViewText(R.id.date_wd, WD_FULL[k.get(Calendar.DAY_OF_WEEK) - 1]);
        v.setTextViewText(R.id.date_my, MON_FULL[k.get(Calendar.MONTH)] + " " + (k.get(Calendar.YEAR) + 543));
        ring(v, b.doneToday, dueToday);
        tile(v, R.id.num_overdue, R.id.dot_overdue, b.overdue.size(), ON_CARD_OVERDUE);
        tile(v, R.id.num_today, R.id.dot_today, b.today.size(), ON_CARD_TODAY);
        tile(v, R.id.num_doing, R.id.dot_doing, b.doing.size(), ON_CARD_DOING);
        tile(v, R.id.num_done, R.id.dot_done, b.doneToday, ON_CARD_DONE);

        WidgetData.Task next = b.next();
        if (next == null) {
            v.setTextViewText(R.id.next_label, "");
            v.setTextViewText(R.id.next_title, c.getString(R.string.empty));
        } else {
            String label = "doing".equals(next.status) ? "กำลังทำ" : "ถัดไป";
            if (next.time != null) label += " " + next.time;
            v.setTextViewText(R.id.next_label, label);
            v.setTextColor(R.id.next_label, "doing".equals(next.status) ? ON_CARD_DOING : 0xD9FFFFFF);
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
        if (w > 0 && w < 280) v.setViewVisibility(R.id.btn_refresh, View.GONE);
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
        int color = cardColor(data);
        paintCard(c, v, R.id.head_bg, R.id.head, options, 320, 250, 70, false, color);
        v.setInt(R.id.btn_add, "setColorFilter", color);
        int dueToday = b.today.size() + b.doneToday;
        for (WidgetData.Task t : b.doing) if (today.equals(t.due)) dueToday++;
        ring(v, b.doneToday, dueToday);
        int w = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        if (w > 0 && w < 280) v.setViewVisibility(R.id.btn_refresh, View.GONE);
        v.setTextViewText(R.id.count_overdue, "เลย " + b.overdue.size());
        v.setTextViewText(R.id.count_today, "วันนี้ " + b.today.size());
        v.setTextViewText(R.id.count_doing, "ทำอยู่ " + b.doing.size());

        int h = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        int max = h > 0 ? Math.max(2, Math.min(8, (h - 96) / 48)) : 4;
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
