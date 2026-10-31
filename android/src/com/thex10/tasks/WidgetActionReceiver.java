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
        if (Widgets.ACTION_DONE.equals(action) && data != null && data.getPathSegments().size() > 0) {
            // x10://done/<task>  or  x10://step/<task>/<step>
            final String id = data.getPathSegments().get(0);
            final String stepId = "step".equals(data.getHost()) && data.getPathSegments().size() > 1 ? data.getPathSegments().get(1) : null;
            if (stepId != null) WidgetData.markStep(c, id, stepId);
            else WidgetData.markDone(c, id);
            Widgets.updateAll(c);
            if (WidgetData.server(c) != null) {
                final PendingResult pending = goAsync();
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            if (stepId != null) ServerSync.completeStep(c, id, stepId);
                            else ServerSync.complete(c, id);
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
