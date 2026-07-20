#!/usr/bin/env bash
#
# Wraps the `neu build` output (dist/squeal-editor) into a real macOS .app
# bundle, ad-hoc signs it, and lays it into a .dmg. The version is passed in by
# CI from the release tag, without its leading `v`.
#
# `neu build --macos-bundle` is not this: it only renames the bare executable to
# `squeal-editor-mac_arm64.app`, which has no Contents/ and no Info.plist, so
# Finder treats it as a plain binary rather than an app.
#
# arm64 only. The extension is compiled by `bun build --compile` on an Apple
# Silicon runner and cannot be anything else, and an app whose shell launches
# while its extension cannot is the hang documented in docs/architecture.md.
#
# There is no Apple Developer account, so the signature is ad-hoc: Gatekeeper
# shows "unidentified developer" on first launch, cleared with right-click-Open.

set -euo pipefail

version="${1:?usage: package-macos.sh <version>}"

app="dist/Squeal Editor.app"
macos="$app/Contents/MacOS"
dmg="squeal-editor-macos-arm64-v$version.dmg"

rm -rf "$app" dist/dmg "$dmg"
mkdir -p "$macos" "$app/Contents/Resources"

# Only executables may live in Contents/MacOS. codesign treats everything in
# there as nested code, so a data file lands as an unsigned subcomponent and the
# bundle fails `--verify --deep --strict`. That is why CI builds macOS with
# `neu build --embed-resources`: resources.neu goes inside the binary via
# postject and there is no data file left to misplace.
#
# The extension cannot follow it in, so it stays a real nested executable and
# gets a real signature below. Its location is not a choice either: commandDarwin
# resolves ${NL_PATH}/extensions/db/squeal-db-ext, and the launcher below is what
# makes NL_PATH land here.
if [ -f dist/squeal-editor/resources.neu ]; then
  echo "resources.neu is still on disk — neu build ran without --embed-resources." >&2
  exit 1
fi

cp dist/squeal-editor/squeal-editor-mac_arm64 "$macos/squeal-editor-bin"
cp -R dist/squeal-editor/extensions "$macos/extensions"

# NL_PATH follows the working directory, not the executable, and Finder launches
# with the working directory set to `/` -- where Neutralino then looks for
# /extensions/db/squeal-db-ext, finds nothing, and the app comes up with a dead
# extension. So CFBundleExecutable is this shim rather than the binary: it moves
# to its own directory first, which is the one place NL_PATH must be.
#
# `exec` so the shell is replaced rather than left as a parent. The extension
# heartbeats against the app and the UI suite reaps by process, and both want one
# process, not a shell wrapping one.
cat > "$macos/squeal-editor" <<'LAUNCHER'
#!/bin/sh
cd "$(dirname "$0")" || exit 1
exec ./squeal-editor-bin "$@"
LAUNCHER

chmod +x "$macos/squeal-editor" "$macos/squeal-editor-bin" "$macos/extensions/db/squeal-db-ext"

iconset="dist/icon.iconset"
rm -rf "$iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size frontend/public/icon.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) frontend/public/icon.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/icon.icns"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Squeal Editor</string>
  <key>CFBundleDisplayName</key><string>Squeal Editor</string>
  <key>CFBundleExecutable</key><string>squeal-editor</string>
  <key>CFBundleIdentifier</key><string>js.squeal.editor</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Inner-out: signing the bundle seals whatever its nested executables already
# carry, so an extension signed afterwards would invalidate the outer signature.
codesign --force --sign - --timestamp=none "$macos/extensions/db/squeal-db-ext"
codesign --force --sign - --timestamp=none "$macos/squeal-editor-bin"
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"

# ditto, not cp -R: it preserves the extended attributes a signed bundle carries,
# which cp can drop and thereby invalidate the signature just made.
mkdir -p dist/dmg
ditto "$app" "dist/dmg/Squeal Editor.app"
ln -s /Applications dist/dmg/Applications
hdiutil create -volname "Squeal Editor" -srcfolder dist/dmg -ov -format UDZO "$dmg"
