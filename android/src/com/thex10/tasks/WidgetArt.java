package com.thex10.tasks;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;

/**
 * Paints the gradient card behind the widgets in the user's app colour — the same look as the app's
 * "today" card: a deep diagonal gradient, warm light in the top corner, soft swell lines along the bottom,
 * and a thin highlight on the top edge so the card reads as a lit slab rather than a flat colour.
 */
final class WidgetArt {
    private static String lastKey;
    private static Bitmap lastBitmap;

    private WidgetArt() {}

    /**
     * @param w,h size in pixels (already capped by the caller)
     * @param radius corner radius in pixels
     * @param roundBottom false for the list widget's header, whose bottom meets the white list
     */
    static synchronized Bitmap card(int w, int h, float radius, int accent, boolean night, boolean roundBottom) {
        String key = w + "x" + h + ":" + radius + ":" + accent + ":" + night + ":" + roundBottom;
        if (key.equals(lastKey) && lastBitmap != null && !lastBitmap.isRecycled()) return lastBitmap;
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        Path clip = new Path();
        float rb = roundBottom ? radius : 0;
        clip.addRoundRect(new RectF(0, 0, w, h), new float[] {radius, radius, radius, radius, rb, rb, rb, rb}, Path.Direction.CW);
        cv.clipPath(clip);

        // 1. the diagonal gradient (same stops as the app: lighter top-left, accent, deeper bottom-right)
        int c1 = night ? mix(accent, Color.BLACK, 0.30f) : mix(accent, Color.WHITE, 0.10f);
        int c2 = night ? mix(accent, Color.BLACK, 0.46f) : accent;
        int c3 = night ? mix(accent, Color.BLACK, 0.60f) : mix(accent, Color.BLACK, 0.25f);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setShader(new LinearGradient(0, 0, w, h, new int[] {c1, c2, c3}, new float[] {0f, 0.55f, 1f}, Shader.TileMode.CLAMP));
        cv.drawRect(0, 0, w, h, p);

        // 2. warm light from the top-right corner
        float glow = Math.max(w, h) * 1.05f;
        p.setShader(new RadialGradient(w, 0, glow, new int[] {Color.argb(night ? 70 : 96, 255, 196, 92), Color.argb(0, 255, 196, 92)}, new float[] {0f, 0.55f}, Shader.TileMode.CLAMP));
        cv.drawRect(0, 0, w, h, p);

        // 3. a cool soft light top-left, for depth
        p.setShader(new RadialGradient(w * 0.08f, h * 0.05f, Math.max(w, h) * 0.6f, new int[] {Color.argb(night ? 22 : 34, 255, 255, 255), Color.argb(0, 255, 255, 255)}, null, Shader.TileMode.CLAMP));
        cv.drawRect(0, 0, w, h, p);

        // 4. swell lines along the bottom (the lagoon outside the window)
        p.setShader(null);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(Math.max(1.5f, radius / 14f));
        p.setColor(Color.argb(night ? 26 : 36, 255, 255, 255));
        float u = Math.max(w, h);
        cv.drawOval(new RectF(w * 0.30f - u * 0.62f, h * 0.78f, w * 0.30f + u * 0.62f, h * 0.78f + u * 0.62f), p);
        cv.drawOval(new RectF(w * 0.78f - u * 0.66f, h * 0.88f, w * 0.78f + u * 0.66f, h * 0.88f + u * 0.66f), p);
        p.setColor(Color.argb(night ? 16 : 22, 255, 255, 255));
        cv.drawOval(new RectF(w * 0.50f - u * 0.80f, h * 1.00f - u * 0.05f, w * 0.50f + u * 0.80f, h * 1.00f + u * 0.80f), p);

        // 5. a little shade at the bottom so the card sits on the wallpaper
        p.setStyle(Paint.Style.FILL);
        p.setShader(new LinearGradient(0, h * 0.55f, 0, h, Color.argb(0, 0, 0, 0), Color.argb(night ? 40 : 28, 0, 0, 0), Shader.TileMode.CLAMP));
        cv.drawRect(0, 0, w, h, p);

        // 6. hairline highlight on the top edge, fading down the sides
        p.setStyle(Paint.Style.STROKE);
        float sw = Math.max(1f, radius / 20f);
        p.setStrokeWidth(sw);
        p.setShader(new LinearGradient(0, 0, 0, Math.min(h, radius * 3), Color.argb(night ? 60 : 90, 255, 255, 255), Color.argb(0, 255, 255, 255), Shader.TileMode.CLAMP));
        Path edge = new Path();
        float inset = sw / 2;
        float ri = Math.max(0, radius - inset);
        float rbi = roundBottom ? ri : 0;
        edge.addRoundRect(new RectF(inset, inset, w - inset, h - inset), new float[] {ri, ri, ri, ri, rbi, rbi, rbi, rbi}, Path.Direction.CW);
        cv.drawPath(edge, p);

        lastKey = key;
        lastBitmap = bmp;
        return bmp;
    }

    /** a → b by t (0..1), alpha kept opaque. */
    static int mix(int a, int b, float t) {
        return Color.rgb(
                Math.round(Color.red(a) + (Color.red(b) - Color.red(a)) * t),
                Math.round(Color.green(a) + (Color.green(b) - Color.green(a)) * t),
                Math.round(Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t));
    }
}
