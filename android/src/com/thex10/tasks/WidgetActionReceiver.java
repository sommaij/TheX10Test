package com.thex10.tasks;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/** Tick and refresh buttons on the widgets. */
public class WidgetActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context c, Intent intent) {
        String action = intent.getAction();
        Uri data = intent.getData();
        if (Widgets.ACTION_DONE.equals(action) && data != null && data.getPath() != null) {
            final String id = Uri.decode(data.getPath().replaceFirst("^/", ""));
            WidgetData.markDone(c, id);
            Widgets.updateAll(c);
            if (WidgetData.server(c) != null) {
                final PendingResult pending = goAsync();
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            ServerSync.complete(c, id);
                            ServerSync.refresh(c);
                            Widgets.updateAll(c);
                        } finally {
                            pending.finish();
                        }
                    }
                }).start();
            }
        } else if (Widgets.ACTION_REFRESH.equals(action)) {
            Widgets.updateAll(c);
            ServerSync.refreshInBackground(this, c);
        }
    }
}
