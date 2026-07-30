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
resources="$app/Contents/Resources"
dmg="squeal-editor-macos-arm64-v$version.dmg"

rm -rf "$app" dist/dmg "$dmg"
mkdir -p "$macos" "$resources" "$app/Contents/Frameworks"

# Only executables may live in Contents/MacOS. codesign treats everything in
# there as nested code, so a data file lands as an unsigned subcomponent and the
# bundle fails `--verify --deep --strict`. resources.neu and neutralino.config.json
# are data, so they go in Contents/Resources instead — the standard home for
# bundle data, which codesign seals as resource hashes rather than nested code.
#
# This means `neu build` must run WITHOUT --embed-resources. Embedding packs
# resources.neu into the binary via postject, which relies on the process
# reading its own Mach-O file back off disk to find the embedded section. That
# self-lookup breaks the instant DYLD_INSERT_LIBRARIES puts a second image in
# front of it — confirmed by inserting a no-op dylib, which reproduces the same
# "resources.neu is missing" fallback as the real window-chrome one. Since the
# window-chrome dylib below is exactly that injection, embedding and the
# titlebar fix cannot coexist; loose files in Resources sidestep the conflict
# because they're opened by path, not by self-inspection.
if [ ! -f dist/squeal-editor/resources.neu ]; then
  echo "resources.neu is missing — neu build ran with --embed-resources; it must run plain for macOS." >&2
  exit 1
fi

cp dist/squeal-editor/squeal-editor-mac_arm64 "$macos/squeal-editor-bin"
cp dist/squeal-editor/resources.neu "$resources/resources.neu"
cp neutralino.config.json "$resources/neutralino.config.json"

# The extension's location is not a choice: commandDarwin resolves
# ${NL_PATH}/extensions/db/squeal-db-ext, and NL_PATH follows the working
# directory (not the executable) — so it has to sit next to resources.neu and
# neutralino.config.json, wherever the launcher below puts the cwd.
cp -R dist/squeal-editor/extensions "$resources/extensions"

# Neutralino locates resources.neu/neutralino.config.json relative to argv[0]'s
# own directory, not the cwd directly — confirmed by the error string it logs
# on failure, which echoes back dirname(argv[0]) verbatim (e.g. "../MacOS/
# resources.neu is missing" when argv[0] was "../MacOS/squeal-editor-bin"). A
# symlink here means the launcher can exec a *relative* "./squeal-editor-bin"
# from within Resources, so dirname(argv[0]) is "." — Resources itself, right
# where the loose files live — while the real Mach-O bytes stay put in MacOS
# and keep their own signature. codesign treats the symlink as a resource
# hash, not nested code, so it does not trip `--verify --deep --strict`.
ln -s ../MacOS/squeal-editor-bin "$resources/squeal-editor-bin"

# A borderless Neutralino window on macOS can never become the key window, so
# it never gets keyboard input (neutralinojs#1197). The dylib restyles the
# window from inside the process — transparent titled titlebar, content under
# it — which is the only place an NSWindow can be touched. Injection survives
# ad-hoc signing precisely because there is no hardened runtime; a Developer ID
# build would need the dyld-environment-variables entitlement.
clang -dynamiclib -fobjc-arc -arch arm64 -mmacosx-version-min=11.0 \
  -framework AppKit \
  -framework WebKit \
  -o "$app/Contents/Frameworks/squeal-window-chrome.dylib" \
  scripts/macos-window-chrome.m

# NL_PATH follows the working directory, not the executable, and Finder launches
# with the working directory set to `/` -- where Neutralino would look for
# /resources.neu, /neutralino.config.json and /extensions/db/squeal-db-ext,
# find nothing, and the app would come up with a dead extension and framework
# defaults. So CFBundleExecutable is this shim rather than the binary: it moves
# into Contents/Resources first, which is the one place NL_PATH must be — right
# next to the loose resources.neu/config/extensions copied in above — then runs
# the real binary out of Contents/MacOS by relative path.
#
# `exec` so the shell is replaced rather than left as a parent. The extension
# heartbeats against the app and the UI suite reaps by process, and both want one
# process, not a shell wrapping one.
# DYLD_INSERT_LIBRARIES must be exported *inside* the shim: dyld deletes DYLD_*
# variables whenever it starts a SIP-protected binary, and /bin/sh is one — a
# value set outside the script would never survive into it. The same rule is
# what keeps the dylib out of the extension: Neutralino spawns extensions
# through /bin/sh, and the variable dies at that boundary.
cat > "$macos/squeal-editor" <<'LAUNCHER'
#!/bin/sh
cd "$(dirname "$0")/../Resources" || exit 1
export DYLD_INSERT_LIBRARIES="$PWD/../Frameworks/squeal-window-chrome.dylib"
exec ./squeal-editor-bin "$@"
LAUNCHER

chmod +x "$macos/squeal-editor" "$macos/squeal-editor-bin" "$resources/extensions/db/squeal-db-ext"

# frontend/public/icon.png is full-bleed — right for a window/exe icon shown at
# native size, but macOS composites its own icons (Dock, Finder) with a ~80%
# content box baked into their artwork, and a full-bleed plate next to them reads
# visibly larger than its neighbors. So icon.icns gets that inset here, by
# shrinking the source to 80% and padding back out to each target size, rather
# than baking it into the committed SVG where every other consumer would inherit
# the dead margin too.
iconset="dist/icon.iconset"
rm -rf "$iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  for name in "icon_${size}x${size}.png:$size" "icon_${size}x${size}@2x.png:$((size * 2))"; do
    file="${name%%:*}"
    px="${name##*:}"
    inner=$((px * 8 / 10))
    sips -z $inner $inner frontend/public/icon.png --out "$iconset/inner.png" >/dev/null
    sips -p $px $px "$iconset/inner.png" --out "$iconset/$file" >/dev/null
  done
done
rm -f "$iconset/inner.png"
iconutil -c icns "$iconset" -o "$resources/icon.icns"

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
codesign --force --sign - --timestamp=none "$resources/extensions/db/squeal-db-ext"
codesign --force --sign - --timestamp=none "$app/Contents/Frameworks/squeal-window-chrome.dylib"
codesign --force --sign - --timestamp=none "$macos/squeal-editor-bin"
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"

# ditto, not cp -R: it preserves the extended attributes a signed bundle carries,
# which cp can drop and thereby invalidate the signature just made.
mkdir -p dist/dmg
ditto "$app" "dist/dmg/Squeal Editor.app"
ln -s /Applications dist/dmg/Applications
hdiutil create -volname "Squeal Editor" -srcfolder dist/dmg -ov -format UDZO "$dmg"
