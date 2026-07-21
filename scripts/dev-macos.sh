#!/usr/bin/env bash
#
# Run the app locally on macOS with the native title bar.
#
# macOS keeps its own chrome — traffic-light buttons on the left, a native menu
# bar — so borderless must be off.  This flips the config for the run and puts it
# back when the app exits.
set -euo pipefail

cd "$(dirname "$0")/.."

restore() {
  sed -i '' 's/"borderless": false/"borderless": true/' neutralino.config.json
}

sed -i '' 's/"borderless": true/"borderless": false/' neutralino.config.json
trap restore EXIT

bun run build && bun run build:ext && neu run
