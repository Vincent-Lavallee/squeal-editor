#!/usr/bin/env bash
#
# Wraps the `neu build` output (dist/squeal-editor) into an AppImage. The version
# is passed in by CI from the release tag, without its leading `v`.
#
# arm64 only: the extension is compiled by `bun build --compile` on the runner
# that runs this, so it can only be that runner's architecture.
#
# The AppImage does not carry WebKitGTK. Neutralino loads it at runtime from the
# host (libwebkit2gtk-4.0 or -4.1), and bundling a whole browser engine is the
# fragile route. A machine without it gets Neutralino's own "please install
# libwebkit2gtk" message.

set -euo pipefail

version="${1:?usage: package-linux.sh <version>}"

appimagetool_version="1.9.0"
appimagetool_sha256="04f45ea45b5aa07bb2b071aed9dbf7a5185d3953b11b47358c1311f11ea94a96"
appimagetool_url="https://github.com/AppImage/appimagetool/releases/download/$appimagetool_version/appimagetool-aarch64.AppImage"

appdir="dist/Squeal-Editor.AppDir"
payload="$appdir/usr/lib/squeal-editor"
appimage="squeal-editor-linux-aarch64-v$version.AppImage"
appimagetool="dist/appimagetool-$appimagetool_version.AppImage"

if [ ! -f dist/squeal-editor/resources.neu ]; then
  echo "resources.neu is missing — neu build ran with --embed-resources; it must run plain for Linux." >&2
  exit 1
fi

rm -rf "$appdir" "$appimage"
mkdir -p "$payload/extensions/db" "$appdir/usr/share/icons/hicolor/256x256/apps"

# Copied one by one rather than the whole dist folder: neu writes a binary per
# platform into it, and the extension folder only holds the compiled binary once
# the release workflow has slimmed it.
cp dist/squeal-editor/squeal-editor-linux_arm64 "$payload/squeal-editor"
cp dist/squeal-editor/resources.neu "$payload/resources.neu"
cp extensions/db/squeal-db-ext "$payload/extensions/db/squeal-db-ext"
chmod +x "$payload/squeal-editor" "$payload/extensions/db/squeal-db-ext"

# NL_PATH follows the working directory, not the executable, and the extension is
# resolved from it (${NL_PATH}/extensions/db/squeal-db-ext). A launcher started
# from a menu has whatever cwd the desktop gave it, so AppRun moves into the
# payload first. `exec` so no shell is left as a parent: the extension heartbeats
# against the app.
cat > "$appdir/AppRun" <<'APPRUN'
#!/bin/sh
cd "$APPDIR/usr/lib/squeal-editor" || exit 1
exec ./squeal-editor "$@"
APPRUN
chmod +x "$appdir/AppRun"

cp frontend/public/icon.png "$appdir/squeal-editor.png"
cp frontend/public/icon.png "$appdir/usr/share/icons/hicolor/256x256/apps/squeal-editor.png"

cat > "$appdir/squeal-editor.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Squeal Editor
Comment=A stupid simple multi-database SQL editor
Exec=AppRun
Icon=squeal-editor
Categories=Development;Database;
Terminal=false
DESKTOP

if [ ! -f "$appimagetool" ]; then
  curl -fsSL -o "$appimagetool" "$appimagetool_url"
fi
echo "$appimagetool_sha256  $appimagetool" | sha256sum -c -
chmod +x "$appimagetool"

# --appimage-extract-and-run because the runner has no FUSE to mount the tool
# itself. The AppImage it writes still mounts normally on the user's machine.
ARCH=aarch64 "$appimagetool" --appimage-extract-and-run "$appdir" "$appimage"
