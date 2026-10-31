package com.thex10.tasks;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Puts reminders back after a restart or an app update, and redraws the widgets. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        Reminders.restore(c);
        Widgets.updateAll(c);
    }
}
