package com.thex10.tasks;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/** Hosts the X10 Tasks web app (bundled in assets/www) and routes widget taps into it. */
public class MainActivity extends Activity {
    static final int REQ_FILE = 1;
    static final int REQ_NOTIFICATIONS = 2;
    private static final String START_URL = "file:///android_asset/www/index.html";

    private WebView web;
    private boolean loaded;
    private String pendingJs;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.paper));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(this), "X10Native");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (RuntimeException e) {
                    // no app can open this link
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loaded = true;
                if (pendingJs != null) {
                    view.evaluateJavascript(pendingJs, null);
                    pendingJs = null;
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (RuntimeException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.loadUrl(START_URL);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** x10://task/<id>, x10://new, x10://filter/<status> from widgets and notifications. */
    private void handleIntent(Intent intent) {
        Uri d = intent == null ? null : intent.getData();
        if (d == null || !"x10".equals(d.getScheme())) return;
        String host = d.getHost();
        String arg = d.getPath() == null ? "" : Uri.decode(d.getPath().replaceFirst("^/", ""));
        if ("task".equals(host)) run("X10App.openTask(" + JSONObject.quote(arg) + ")");
        else if ("new".equals(host)) run("X10App.newTask()");
        else if ("filter".equals(host)) run("X10App.filter(" + JSONObject.quote(arg) + ")");
    }

    /** Runs JavaScript in the page from any thread (used by the bridge's network replies). */
    void runJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    private void run(String js) {
        String guarded = "window.X10App && " + js;
        if (loaded) web.evaluateJavascript(guarded, null);
        else pendingJs = guarded;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (loaded) run("X10App.resume()");
    }

    @Override
    protected void onPause() {
        super.onPause();
        Widgets.updateAll(this);
    }

    @Override
    public void onBackPressed() {
        if (!loaded) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("window.X10App ? X10App.back() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        if (request == REQ_NOTIFICATIONS) run("X10App.permissionChanged()");
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
