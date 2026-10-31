package com.thex10.tasks;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String id = i.getStringExtra("id");
        if (id == null) return;
        Reminders.notify(c, id, i.getStringExtra("title"), i.getStringExtra("body"));
        Widgets.updateAll(c);
    }
}
