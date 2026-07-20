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

# NL_PATH is the directory holding the executable, and that is where Neutralino
# looks for resources.neu and resolves ${NL_PATH}/extensions/db/squeal-db-ext
# from. So the payload sits beside the binary in MacOS/, not in Resources/,
# which is only reachable by an app that knows to look there.
cp dist/squeal-editor/squeal-editor-mac_arm64 "$macos/squeal-editor"
cp dist/squeal-editor/resources.neu "$macos/resources.neu"
cp -R dist/squeal-editor/extensions "$macos/extensions"
chmod +x "$macos/squeal-editor" "$macos/extensions/db/squeal-db-ext"

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
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"

mkdir -p dist/dmg
cp -R "$app" dist/dmg/
ln -s /Applications dist/dmg/Applications
hdiutil create -volname "Squeal Editor" -srcfolder dist/dmg -ov -format UDZO "$dmg"
