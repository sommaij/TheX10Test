#!/usr/bin/env bash
# Builds android/build/x10-tasks.apk without Android Studio or Gradle.
#
# Needs (Ubuntu/Debian):  sudo apt-get install aapt android-sdk-platform-23 dalvik-exchange zipalign apksigner openjdk-17-jdk
# Java classes compile against the Android 14 framework jar from Maven Central (downloaded once, ~130 MB).
# The APK is signed with a local key in ~/.android/x10-tasks.keystore (created on first run).
# Keep that file: updates must be signed with the same key, or Android asks to uninstall first.
set -euo pipefail
cd "$(dirname "$0")"

PLATFORM_JAR=${PLATFORM_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
ANDROID_ALL_VERSION=14-robolectric-10818077
ANDROID_ALL_JAR=${ANDROID_ALL_JAR:-$HOME/.cache/x10-tasks/android-all-$ANDROID_ALL_VERSION.jar}
KEYSTORE=${KEYSTORE:-$HOME/.android/x10-tasks.keystore}
KEYSTORE_PASS=${KEYSTORE_PASS:-x10tasks}
DX=$(command -v dalvik-exchange || command -v dx)
OUT=build

for tool in aapt javac zipalign apksigner keytool "$DX"; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool (see the top of this file)"; exit 1; }
done
[ -f "$PLATFORM_JAR" ] || { echo "missing $PLATFORM_JAR (apt-get install android-sdk-platform-23)"; exit 1; }
if [ ! -f "$ANDROID_ALL_JAR" ]; then
  echo "Downloading Android framework classes…"
  mkdir -p "$(dirname "$ANDROID_ALL_JAR")"
  curl -fL --retry 4 -o "$ANDROID_ALL_JAR.part" \
    "https://repo1.maven.org/maven2/org/robolectric/android-all/$ANDROID_ALL_VERSION/android-all-$ANDROID_ALL_VERSION.jar"
  mv "$ANDROID_ALL_JAR.part" "$ANDROID_ALL_JAR"
fi

rm -rf "$OUT" assets
mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/dex" assets/www

# 1. The web app, bundled so the app works offline.
cp -r ../public/index.html ../public/css ../public/js ../public/icons ../public/manifest.webmanifest assets/www/

# 2. Resources → R.java
aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$PLATFORM_JAR"

# 3. Java → classes → classes.dex
javac -encoding UTF-8 --release 8 -nowarn \
  -classpath "$ANDROID_ALL_JAR" -d "$OUT/obj" $(find src "$OUT/gen" -name '*.java')
"$DX" --dex --min-sdk-version=24 --output="$OUT/dex/classes.dex" "$OUT/obj"

# 4. Package, align, sign. resources.arsc must stay uncompressed for Android 11+.
aapt package -f -M AndroidManifest.xml -S res -A assets -I "$PLATFORM_JAR" -0 arsc -F "$OUT/unaligned.apk"
(cd "$OUT/dex" && aapt add -0 dex ../unaligned.apk classes.dex >/dev/null)
zipalign -f -p 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" -alias x10 \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=X10 Tasks, O=The X10, C=TH" >/dev/null
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --ks-key-alias x10 --out "$OUT/x10-tasks.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/x10-tasks.apk"
rm -rf assets
echo "Built $OUT/x10-tasks.apk ($(du -h "$OUT/x10-tasks.apk" | cut -f1))"
