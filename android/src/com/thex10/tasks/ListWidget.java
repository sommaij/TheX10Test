package com.thex10.tasks;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Resizable list of the most urgent tasks, each with a tick button. */
public class ListWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, Widgets.list(c, m.getAppWidgetOptions(id)));
        ServerSync.refreshInBackground(this, c);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle options) {
        m.updateAppWidget(id, Widgets.list(c, options));
    }
}
