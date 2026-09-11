# Downloads the latest release's installer and launches it.
#
# Doing that with Invoke-WebRequest rather than a browser is the point of this
# script, not an implementation detail. The installer carries no Authenticode
# signature (only the detached ed25519 signature the auto-updater checks — no
# code-signing cert, see docs/decisions.md), so SmartScreen's "Windows
# protected your PC" flags it on first run. That check only fires against
# files carrying the Zone.Identifier alternate data stream — Mark-of-the-Web —
# which Explorer, Edge and Chrome tag downloads with and command-line tools
# like Invoke-WebRequest and curl.exe deliberately do not. An installer
# fetched this way never carries the stream, so SmartScreen never blocks it.
# This is documented, long-standing Windows behaviour (MOTW is applied by the
# download client, not by NTFS or the shell), not a bug being relied on.
#
# Usage: irm https://raw.githubusercontent.com/Vincent-Lavallee/squeal-editor/dev/scripts/install-windows.ps1 | iex

$ErrorActionPreference = 'Stop'

$repo = 'Vincent-Lavallee/squeal-editor'
$release = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1

if (-not $asset) {
    Write-Error 'Could not find an .exe attached to the latest release.'
    exit 1
}

$installer = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.browser_download_url)"
Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $installer

Write-Host 'Launching installer'
Start-Process -FilePath $installer -Wait
Remove-Item $installer -ErrorAction SilentlyContinue
