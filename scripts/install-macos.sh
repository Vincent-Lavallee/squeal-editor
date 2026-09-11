#!/usr/bin/env bash
#
# Downloads the latest release's .dmg and installs the app straight into
# /Applications.
#
# Doing that with curl rather than a browser is the point of this script, not
# an implementation detail. There is no Apple Developer account, so the app is
# ad-hoc signed, not notarized, and Gatekeeper's "unidentified developer" block
# only fires on files carrying the com.apple.quarantine extended attribute —
# the flag Safari/Chrome/Mail set on anything they download and curl
# deliberately does not. A .dmg fetched this way, and the .app copied out of
# it, never carry that flag, so Gatekeeper never blocks the first launch. This
# is documented, long-standing Apple behaviour (curl and scp are exempt on
# purpose), not a bug being relied on — see docs/decisions.md.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/Vincent-Lavallee/squeal-editor/dev/scripts/install-macos.sh | bash

set -euo pipefail

repo="Vincent-Lavallee/squeal-editor"
dmg_url=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" |
  grep -o '"browser_download_url": *"[^"]*\.dmg"' |
  grep -o 'https://[^"]*')

if [ -z "$dmg_url" ]; then
  echo "Could not find a .dmg attached to the latest release." >&2
  exit 1
fi

workdir=$(mktemp -d)
dmg="$workdir/squeal-editor.dmg"
mountpoint=""

cleanup() {
  [ -n "$mountpoint" ] && hdiutil detach "$mountpoint" -quiet 2>/dev/null || true
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "Downloading $dmg_url"
curl -fsSL -o "$dmg" "$dmg_url"

mountpoint=$(hdiutil attach "$dmg" -nobrowse -readonly | tail -1 | awk -F '\t' '{print $NF}')

rm -rf "/Applications/Squeal Editor.app"
ditto "$mountpoint/Squeal Editor.app" "/Applications/Squeal Editor.app"

echo "Installed to /Applications/Squeal Editor.app"
open "/Applications/Squeal Editor.app"
