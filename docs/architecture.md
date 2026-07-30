# Architecture

## The constraint everything follows from

Neutralino is a webview plus a small native binary. **There is no JS runtime in
it that can open a TCP socket**, so the UI cannot talk to a database — not with
a library, not with a workaround. This is the single fact that shapes the repo.

The answer is Neutralino's *extension* mechanism: a separate process that
Neutralino spawns and talks to over a WebSocket. Ours is a Bun + TypeScript
process that holds the connections and runs the SQL.

```
┌──────────────────────────────────────────┐
│ Neutralino (native binary + WebView2)    │
│  ┌────────────────────────────────────┐  │
│  │ React UI  (resources/, built)      │  │
│  │   bridge.ts ── extensions.dispatch │  │
│  └──────────────┬─────────────────────┘  │
│                 │ WebSocket (localhost)  │
│  ┌──────────────▼─────────────────────┐  │
│  │ extension: squeal-db-ext (compiled)│  │
│  │   connection.ts → drivers.ts       │  │
│  └──────────────┬─────────────────────┘  │
└─────────────────┼────────────────────────┘
                  │ TCP
          ┌───────▼────────┐
          │ MySQL/Postgres │
          └────────────────┘
```

## Layout

```
shared/protocol/      the contract, split by domain; both sides import index.ts
  index.ts            the barrel: the whole contract, re-exported
  config.ts           reaching a server, and filing it: engines, workspaces
  results.ts          rows, the catalog's view of them, and edits going back
  updater.ts          the release check and download progress
  commands.ts         the Commands map: every verb, with its req and res
  events.ts           the channel's own names and reply envelope
frontend/             React + Vite → builds into resources/
  src/App.tsx         the composition root: routing and update banner
  src/Shell.tsx       the connected shell: rail, tabs, editor, results
  src/main.tsx        entry point: bridge init, Redux provider, mount
  src/common/         shared infrastructure, no components live here
    bridge/bridge.ts  request/response layer over the extension channel
    icons/            icon bindings, workspace glyphs, the connection colour palette
    db/               engine definitions, environment list
  src/store/          the slices and the session: what every feature shares
  src/features/       titlebar, connections, explorer, editor, results
  src/styles/         the design system
extensions/db/        the process that makes the calls the webview cannot
  main.ts             transport, registry, command handlers
  connection.ts       one server connection; hides the driver's client type
  drivers.ts          per-engine SQL (mysql2 / pg)
  store.ts            workspaces + saved connections: the SQLite file, the migration, the encryption
  chrome.ts           the window frame's colour, over bun:ffi (Windows-only)
tests/                real-database + real-app suites
resources/            build output (gitignored)
bin/, frontend/public/js/   Neutralino binaries + client (fetched, gitignored)
```

## The bridge

The channel is **fire-and-forget in both directions**. The UI calls
`Neutralino.extensions.dispatch(extId, event, data)`; the extension replies by
broadcasting an event that the UI happens to be listening for. There is no
built-in request/response.

`bridge.ts` builds one: every call is tagged with an incrementing `reqId`, the
extension echoes it back in a `db.response` broadcast, and the bridge matches the
reply to its pending promise. That is the only reason `call()` is await-able.

Wire format:

```jsonc
// UI → extension
{ "event": "db.query", "data": { "reqId": 7, "connectionId": "…", "sql": "…" } }

// extension → UI  (a Neutralino native call, hence the envelope)
{ "id": "<uuid>", "method": "app.broadcast", "accessToken": "<NL_TOKEN>",
  "data": { "event": "db.response", "data": { "reqId": 7, "ok": true, "data": {…} } } }
```

Startup: Neutralino writes `{nlPort, nlToken, nlConnectToken, nlExtensionId}` to
the extension's **stdin** as one JSON line; the extension dials
`ws://localhost:<nlPort>?extensionId=…&connectToken=…`. `nlToken` must be sent as
`accessToken` on every message or Neutralino ignores it.

Because dispatch is fire-and-forget, a call made before the extension has
connected would vanish silently. `bridge.ts` therefore awaits `extensionReady`
(falling back to `extensions.getStats()`) before dispatching anything.

## Type safety across the bridge

`shared/protocol/commands.ts` defines a `Commands` map of command → `{req, res}`.
Both sides import it as types only, so there is no runtime coupling, but:

- `bridge.call('db.query', {...})` infers its payload and return type.
- The extension's `COMMANDS` object is typed `{[K in CommandName]: (req) => Promise<res>}`,
  so a handler that returns the wrong shape fails to compile.

A protocol change that only lands on one side is a compile error, not a
mysterious timeout at runtime.

## Engine-agnostic by construction

The UI knows two engine *names* and nothing else — no quoting, no catalogs, no
dialects. It asks for `db.tables`; the driver decides what that means. Even the
preview SQL (`SELECT * FROM …`) is built in the extension, because quoting is
engine-specific (`` `users` `` vs `"users"`).

The editor's highlighting is the shape this takes when the UI *does* need to
know something engine-specific: the driver reports a `SqlDialect` and the UI
passes it to Monaco without reading it. Carrying a value is not knowing it —
what would break the rule is a table up there mapping `mysql` to a grammar.

Consequence: adding an engine touches `drivers.ts` and `EngineType`, plus one
entry in the UI's engine dropdown. Nothing else.

## Process lifecycle

`neu run` starts the native binary, which spawns the compiled extension
(`extensions/db/squeal-db-ext`; see Packaging for why it is compiled, not
`bun main.ts`).

The extension **must not outlive the app**, or it sits holding open database
connections forever. Closing the socket is not a reliable signal — WebView2
child processes inherit the listening handle, so the connection can stay
ESTABLISHED after the app dies. The extension therefore pings the app and exits
when it stops answering. See `docs/decisions.md`.

## The window

`modes.window.borderless` in `neutralino.config.json` is half of a pair. It
removes the native titlebar so `<Titlebar />` can be the real one; it also
removes `WS_THICKFRAME`, and the frontend's `useWindowChrome` puts that back at
startup so Aero Snap and edge resize survive. **Change one and you must change
the other** — drop the config flag and the app renders its own titlebar under
Windows' titlebar; drop the code and the window silently stops snapping.

Keeping the frame means Windows paints 7px of it above the titlebar, which the
webview cannot reach, so the UI asks the extension to recolour it (`window.matchFrame`).
That is the second reason the extension exists at all: it makes the native calls
the webview cannot — a TCP socket is one, `dwmapi` is another.

On macOS the extension cannot play that role — an NSWindow is untouchable from
another process — and a borderless Neutralino window can never become the key
window, so it never receives keyboard input. The packaged `.app` therefore
injects `scripts/macos-window-chrome.m` (a dylib, via `DYLD_INSERT_LIBRARIES`
in the launcher shim) which restyles the window in-process into a titled window
with a transparent, hidden titlebar: keyboard focus and native edge resize come
back, and `<TitlebarMacos />` stays the visible bar. Dev runs on a Mac have no
injection and keep the broken borderless behaviour.

See `docs/decisions.md`; every part of this cost real digging.

## The icon

`modes.window.icon` is `/resources/icon.png`, and it feeds two different things
from that one line: Neutralino loads it for the window at runtime, and `neu build`
patches it into the Windows `.exe` (converting it to a multi-size `.ico` on the
way). The drawing itself is `docs/design-system.md`'s business.

Two traps, both silent:

- **It must be a PNG.** `neu`'s exe patcher ignores a non-PNG window icon and
  falls back to Neutralino's stock icon without a word. Point this at the SVG and
  the window looks right while every packaged build ships the default.
- **It is a build output.** `resources/` is emptied and refilled by
  `bun run build`, so the path only resolves after the frontend has been built.
  The committed source is `frontend/public/icon.{svg,png}`.

## Packaging and releases

The extension is **compiled to a self-contained native binary** with `bun build
--compile` (`bun run build:ext` → `extensions/db/squeal-db-ext`), folding the Bun
runtime and every dependency — `ws`, `mysql2`, `pg`, `bun:sqlite`, `bun:ffi` —
into one file. `neutralino.config.json` points its extension `command` at that
binary rather than at `bun main.ts`. So a packaged app needs neither Bun on the
user's PATH nor a `node_modules` beside it: shipping the raw TypeScript did both,
and its symlinked `node_modules` did not survive the copy into the bundle, which
is exactly why a packaged app used to launch and then hang with the extension
dead. `bun start`/`dev` compile the binary first, so dev runs the same artifact
it ships.

**The Windows `command` must use backslashes** —
`${NL_PATH}\extensions\db\squeal-db-ext.exe`. A forward-slash *absolute* exe path
never spawns: Neutralino runs, the extension process never appears, and the app
sits on the 15s `extensionReady` timeout. (The old `bun.exe ${NL_PATH}/…/main.ts`
got away with forward slashes because the program was `bun.exe` on PATH and the
slashes were just an argument it tolerates.)

Because the binary is self-contained, the build **slims** `extensions/db` down to
just that binary before `neu build`. That drops the raw source and the symlinked
`node_modules` — and copying those symlinks was the `EPERM: operation not
permitted, symlink` that used to force `neu build` to run in an admin or
Developer-Mode shell. It now packages without elevation.

Both Windows binaries carry the app's name and icon in their version resource, so
every row Task Manager draws for the app reads "Squeal Editor" rather than "A
Neutralinojs application" and "Bun". They stay separate rows — Task Manager
groups by executable image and this app is two of them, see
`docs/decisions.md`. The extension is named where it is compiled
(`scripts/build-extension.ts`, via `bun build --compile`'s `--windows-*` flags);
the shell binary is named by `scripts/stamp-version-info.ts`, which must run
**after `neu build` and before the installer** — `neu build` rewrites that file,
and the installer reads it. See `docs/decisions.md`.

Releases are automated in `.github/workflows/release.yml`, two jobs:

- **release-please** runs on every push to `dev`. Conventional-commit messages
  (`feat:`, `fix:`, …) tell it the bump; it maintains a release PR that, on
  merge, moves `package.json` and `neutralino.config.json` in lockstep (the two
  files that used to drift), updates `CHANGELOG.md`, tags `vX.Y.Z`, and cuts a
  GitHub Release. Its config is `release-please-config.json` +
  `.release-please-manifest.json` at the repo root; the Neutralino version is
  moved by an `extra-files` JSON updater on `$.version`.
- **build** runs only on the run where that release was created, *in the same
  workflow* — a Release cut by the default `GITHUB_TOKEN` does not trigger a
  separate `on: release` workflow. On Windows, macOS and Linux (`fail-fast:
  false`) it compiles the extension for that OS, slims and packages. Windows
  builds an Inno Setup installer (`installer/squeal-editor.iss`) and attaches
  that as its only download — no portable zip beside it, see
  `docs/decisions.md`. macOS attaches a `.dmg` instead of a zip. Linux builds
  and packages the same as the other two, for verification, but ships nothing
  to the release — a raw zip with no desktop integration was worse than no
  download at all; see `docs/decisions.md` and the Linux AppImage backlog item.
  Windows is verified to launch and connect; mac/Linux still ship unverified —
  they have never been launched — a known, accepted state, not a claim they work.

`scripts/package-macos.sh` builds the macOS `.app`, because `neu build
--macos-bundle` does not: it only renames the bare executable to `….app`, with no
`Contents/` and no `Info.plist`. The script writes the bundle itself, generates
`icon.icns` from `frontend/public/icon.png` with `sips` + `iconutil`, ad-hoc
signs, and lays the result into a `.dmg` beside an `/Applications` symlink.

**`icon.icns` gets an 80% inset that nothing else does.** `frontend/public/icon.png`
is full-bleed, right for a window/exe icon shown at native size. macOS composites
its own icons (Dock, Finder) with a ~80% content box baked into their artwork, so
a full-bleed plate placed among them reads visibly larger than its neighbors. The
script shrinks the source to 80% and pads it back out to each target size before
handing it to `iconutil`, rather than baking the inset into the committed SVG,
which would leave Windows — the platform that shows the icon at native size —
with dead margin around it.

**`CFBundleExecutable` is a shell launcher, not the Neutralino binary.** On macOS
`NL_PATH` follows the **working directory**, not the executable — and Finder
launches an app with the working directory set to `/`, so Neutralino resolves
`commandDarwin` to `/extensions/db/squeal-db-ext`, finds nothing, and the app
comes up with a dead extension and the 15s `extensionReady` timeout. The launcher
`cd`s to its own directory and `exec`s `squeal-editor-bin` beside it. It `exec`s
rather than spawns so the app stays one process: the heartbeat and the UI suite's
reaper both work on processes, and a shell left wrapping the binary would be a
second one.

This is only reachable from a `.app` — `bun start` and CI run from the repo root,
where the working directory already is `NL_PATH`.

**macOS is also the one platform built with `neu build --embed-resources`**, so
`resources.neu` goes inside the binary instead of beside it. That one is forced
by signing: a loose `resources.neu` could only sit in `Contents/MacOS/`, and
`codesign` reads every file there as nested code, failing the bundle with *"code
object is not signed at all — in subcomponent: resources.neu"*. Embedding deletes
the file, and the conflict with it. The script fails loudly if `resources.neu` is
still on disk, since that means the build ran without the flag.

So `Contents/MacOS/` holds the launcher, `squeal-editor-bin`, and
`extensions/db/squeal-db-ext` — which cannot be embedded and stays a genuinely
nested executable with its own signature. `Resources/` holds just the `.icns`,
the one file found by bundle convention rather than by `NL_PATH`.

Note the two interact: embedding the resources means a wrong `NL_PATH` no longer
shows as a blank window, because the UI loads either way. The extension is the
only thing still reading `NL_PATH`, so it is now the only symptom.

Signing goes **inner-out**: the extension binary is signed first, then the bundle
around it, because signing a bundle seals the nested executables as they stand
and a later signature on one of them invalidates the outer seal.

The `.dmg` is **arm64 only**, and ad-hoc signed. See `docs/decisions.md` for both.

Each Windows release also carries what the in-app updater needs to trust it: a
detached ed25519 signature over the installer (`squeal-editor-vX.Y.Z.exe.sig`) and a
`SHA256SUMS`, signed in CI by `scripts/sign-release.ts` with a key held only as
the `UPDATE_SIGNING_KEY` secret. The app checks for a newer release on launch and,
if the user agrees, downloads the installer, verifies the checksum then the
signature, and launches it to swap the whole install and relaunch — the reason the
installer exists. The updater is Windows-only and lives in the extension
(`updater.ts`); see `docs/extension.md` and `docs/decisions.md`. The running
version it compares against is injected into the frontend at build time
(`__APP_VERSION__`), because the compiled extension carries no config to read one
from.
