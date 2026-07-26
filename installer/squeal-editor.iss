; Inno Setup script for the Windows installer.
;
; Wraps the `neu build` output (dist/squeal-editor) into an installer: per-user
; install, Start Menu + optional desktop shortcut, an uninstaller. It's the
; only Windows download the release carries — see docs/decisions.md for why
; the portable zip that used to sit beside it is gone — so the output name
; deliberately carries no "setup" of its own, just the app name and version.
; The version is passed in by CI from the release tag — `iscc /DAppVersion=X.Y.Z`.
;
; Only the Windows binary, the resources bundle, and the compiled extension are
; shipped; the mac/Linux binaries neu also emits into the same folder are
; excluded so the installer holds only what this platform runs.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Squeal Editor"
#define AppExe "squeal-editor-win_x64.exe"

[Setup]
AppId={{7B2F9E14-3C6A-4D2E-9F1B-5A0C8D3E4F21}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Vincent Lavallee
; Without this, Inno Setup's default (admin) makes {autopf} resolve to the
; real Program Files regardless, which is read-only to the unelevated process
; that runs on every launch — see docs/decisions.md, "The installer needs
; PrivilegesRequired=lowest, and close needs a deadline".
PrivilegesRequired=lowest
DefaultDirName={autopf}\Squeal Editor
DefaultGroupName=Squeal Editor
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExe}
; The script lives in installer/, but the build output it packages is at the repo
; root — resolve both the sources and the output there, whatever ISCC's CWD is.
SourceDir={#SourcePath}\..
OutputDir=installer
OutputBaseFilename=squeal-editor-v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; The app is 64-bit only; install into the real Program Files, not the WOW node.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "dist\squeal-editor\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\squeal-editor\resources.neu"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\squeal-editor\extensions\*"; DestDir: "{app}\extensions"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Squeal Editor"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\Squeal Editor"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch Squeal Editor"; Flags: nowait postinstall skipifsilent
