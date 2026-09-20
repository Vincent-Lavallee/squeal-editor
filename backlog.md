# Backlog

Added via the `backlog` skill, which grills the idea first — so everything here
is work that survived questioning, not everything anyone thought of.

Four sections, always these four, in this order.

Items name features, never files or functions. Files move; the feature doesn't.

---

## Improvements

Things that already work, but not well enough.

- **Open a table on single click, pin it on double click** — Clicking a table in
  the tree opens it into a tab, and there is no way to look at several in turn
  without minting a tab for each. Make single-click open a table in a reusable
  preview tab (the next single-click replaces it) and double-click pin it into
  its own permanent tab, the way VSCode's explorer does.

- **The JSON cell drawer doesn't format on open** — The drawer already has a
  manual Format button (Monaco's `formatDocument`, wired in `JsonCellDrawer`),
  but a cell holding minified or raw JSON shows it exactly as stored until the
  user clicks it themselves. Run it automatically when the drawer opens, so
  the common case of "read this JSON" doesn't need a click first.

- **The JSON cell drawer can't be resized** — It renders through the shared
  `<Drawer>` component at a fixed 520px width, so a large JSON document is
  stuck scrolling sideways and vertically in a box that never grows. Let it
  be widened (dragging the leading edge) to actually use the room a bigger
  document needs.

- **Chrome text is highlightable like a web page** — Dragging anywhere in the
  UI — resizing a panel, dragging a tab, a stray shift-click — can select text
  the way it would on a web page, which reads as weird and un-native for a
  desktop app. Make chrome text (labels, buttons, tabs, sidebar, menus) not
  highlightable, everywhere except the results grid, the Monaco editor, and
  form inputs — all places people select text in on purpose.

## Bugs

Things that are wrong.

- **Closing a grid tab discards its staged edits silently** — A browsed grid can
  hold cell edits and row deletes that have not been saved yet, and closing the
  tab throws them away with no warning — while closing an editor tab holding
  unsaved text now asks first. Same loss, same gesture, different answer. The
  reason it was left out is where the staging lives: `ResultsContext`, a feature
  context, where the close is decided in the composition root, so counting them
  means carrying that state across the boundary the feature split exists to keep.
  Whatever the shape, the confirm has to end up one dialog for the whole gesture,
  not one per tab kind.

- **Update ignores custom install path on Windows** — The Windows installer
  lets you choose an install location, but a later update reinstalls to the
  default path instead of the one originally chosen, effectively relocating
  or duplicating the install. The updater needs to read back and respect
  wherever the app is actually installed. The restart after an update now
  reopens the app from wherever it really is, which sharpens this rather than
  softening it: if the install lands somewhere else, the relaunch brings back
  the copy that was not replaced, on the old version, looking like an update
  that silently did nothing.

- **Windows build launches maximized instead of at its last size** — The app
  opens maximized on Windows every launch rather than restoring the size it
  was left at. Suspected leftover from an old workaround that forced this to
  paper over a rendering/border bug before the native window-chrome fix
  (`scripts/windows-window-chrome.c`) existed to fix it properly — not
  confirmed, and whether it reproduces every launch or only sometimes isn't
  pinned down yet either.

- **Cancelling the assistant right after sending can silently do nothing** —
  Clicking Cancel while still on the "Thinking…" state (before any answer text
  has streamed in) sometimes lets the full answer arrive anyway, as if nothing
  had been cancelled, with the thinking indicator spinning the whole time. The
  turn's abort handle is only registered once the credential lookup finishes,
  a beat after the cancel button becomes clickable, so a cancel landing in
  that gap finds nothing yet to abort.

- **A manually-typed SQLite path fails in some cases** — Typing a database file
  path by hand rather than using Browse misbehaves, with spaces in the path the
  suspected trigger; the exact symptom is not yet pinned down and needs
  reproducing before the fix.


- **Selecting all in the results grid scrolls it to the last row** — Clicking
  the grid's corner cell selects every cell, but that selection puts focus on
  the very last row/column, and the grid always scrolls whatever row is
  focused into view — including this synthetic jump, not just the keyboard
  and click moves that logic was written for, where the target is already on
  screen. The grid should stay put; only the selection needs to change.

- **Closing the old process during an update is sometimes very slow** — When
  applying an update, shutting down the current process before relaunching is
  fast most of the time but occasionally very slow. Likely the background
  extension process rather than the app itself, but unconfirmed, and the
  trigger for the slow case isn't known yet either.

- **The assistant tab's database drifts from the split pane** — There is no way
  to point the assistant at a specific database, and there shouldn't need to
  be: it should always answer for whatever database the split pane is showing.
  Instead, once the assistant tab itself becomes the active tab, it falls back
  to the connection's default database rather than the editor tab you were
  just looking at, so the assistant can reason about — and tell the model
  it's targeting — the wrong database.

- **The error card's actions sit on top of the error text** — The "Diagnose with
  AI" and copy buttons are absolutely positioned in the error card's top corner,
  so they float over the message's first line instead of beside it. Put them in
  the card's normal flow next to the text, where they cannot cover it.

## Features

Things that do not exist yet.

- **Hide and show grid columns** — There is no way to hide a column in the
  results grid at all today. Add a right-click "Hide column" entry on column
  headers, plus a toolbar affordance listing every column with a checkbox so a
  hidden one (which has no header left to right-click) can be brought back.
  Deliberately session-only, the same way column order was in-memory before
  it gained per-table persistence: hidden columns reappear once the tab is
  closed or the app restarts, with nothing written to the settings store.


- **Recent connections** — Show the last 3 connections you actually connected to at the bottom of the connections screen, most recent first. Clicking one connects immediately with the saved credentials.

- **Create a SQLite database** — Connecting to an existing `.db` file works, but
  making a new one still means reaching for another tool first. Add a create path
  to the connect screen: a native save dialog chooses the location, the extension
  opens it with SQLite's create flag, and the connection lands on an empty tree
  that says so rather than looking like a failed load. It is separate from
  connecting because the refusal there is deliberate — a missing file is a failed
  _Connect_ naming it, never a silently conjured empty database — so creating one
  has to be something the user asked for by name.

- **GitHub sync** — Authenticate via browser-based OAuth (no hosted backend) and sync workspaces, connections, and user settings to a private gist automatically on change. Connection passwords are never included in the synced data.

- **Turn off the update banner** — The launch check is silent when it finds
  nothing, but when it finds something the strip is back at every launch and
  dismissing it only lasts the run. Add a remembered preference that stops the
  app raising it on its own. It is about being told, not about the lookup:
  "Check for updates" in the About menu keeps working with the setting off,
  because asking for a check is still asking, and a switch that removed it too
  would leave no way to update at all. The Settings screen exists now (theme
  lives there); this is the first preference in it that is not a theme or a
  language.

- **Opening a tab from the assistant tab buries the conversation** — Tab
  placement has no special case for the assistant tab today: opening a new
  tab (from the tree, a "+", or the assistant's own `openTab` tool call) while
  an assistant tab is the active tab in its pane lands the new tab in that
  same pane, switching it away and taking the conversation out of view. It
  should go to the other pane instead — splitting the editor first if there
  is no split yet — so the conversation stays visible alongside whatever was
  just opened.

- **Command palette** — Every action is reachable exactly one way: a menu, a
  button, or a keybinding you already have to know. Put the common ones behind a
  palette — run, format, switch connection or database, toggle read-only,
  settings, a new tab — along with jumping to a table by name, which is the part
  that earns it a keybinding once a connection holds more tables than a tree is
  pleasant to scroll. Monaco ships its own palette, editor-scoped and live
  today; it is now a registry row on `F1`, so turning it off is unbinding that
  row rather than reaching into Monaco — do that, so there is one. The
  composition root owns it and hands it the commands, because a palette that
  imports every feature is exactly the hub the feature split exists to prevent,
  and whatever key it takes has to be rebound inside the editor too — the way
  running already is — or Monaco eats it first.

- **Linux AppImage release** — Linux ships no release download at all right now
  — the raw zip it used to carry had no desktop integration (no icon in the
  launcher, no .desktop entry, nothing), which was worse than nothing, so it
  was dropped. Wrap the Neutralino binary output in an AppImage with a
  .desktop file and the app icon, so Linux users get the same download-and-run
  experience as the other platforms. AppImage only for now; deb and other
  formats can follow once the format is proven to work.

- **Copyable values in the assistant's tool-call detail** — The "Sent"/"Received"
  blocks under an expanded assistant tool call (e.g. a query result carrying row
  ids) render as plain preformatted text — there's no way to copy a single value
  like an id out of the JSON without dragging a manual selection across it. Give
  each value its own inline copy affordance the way a JSON viewer would, rather
  than leaving it to manual text selection.

- **Auto-fit a result column's width to its content** — Column resize is
  drag-only; there is no quick way to size a column to fit what's actually in
  it. Double-clicking a column's resize handle should size it to its largest
  currently visible value, the way spreadsheets do.

- **Workspace-scoped assistant identity** — The assistant's provider, model, and
  API key are one global choice for the whole app (a single credential lives in
  the OS keychain under one fixed name, and `model` is a single value in
  `assistantSlice`), and saved conversations are one flat list with no workspace
  column at all — so a workspace meant to separate a client's environment from
  a personal project still shares one assistant identity and one shared chat
  history across both. Move provider, model, and key to per-workspace state
  (each workspace remembers its own), and scope saved conversations to the
  workspace they were started in. A workspace with no key configured shows the
  assistant as unavailable rather than silently falling back to another
  workspace's credential. On upgrade, today's single key/provider/model and the
  existing conversation list become the seeded Default workspace's, so nothing
  appears to move for a user who never made a second workspace.

- **Add SQL Server driver support** — There is no SQL Server engine at all today
  (only SQLite, MySQL, and Postgres), so a SQL Server database cannot be
  connected to. Add it at full parity with the existing engines: connect,
  browse and edit the grid, table/trigger/function DDL, and the relationship
  diagram — the whole surface `Driver` already declares, not a connect-only
  first pass.

- **Add MariaDB as its own engine choice** — MariaDB already connects today,
  silently, through the MySQL driver, since it speaks the same wire protocol
  — but it has no identity of its own anywhere: the connect form and
  connection list only ever offer MySQL. Make MariaDB a distinct, selectable
  engine (own label, own icon) reusing the MySQL driver underneath, and give
  the test setup a real MariaDB container alongside MySQL and Postgres rather
  than assuming mysql2 behaves identically against both servers.

- **Use the installed Claude CLI instead of an API key** — The Claude provider
  asks for a pasted API key even when the developer's own signed-in `claude` CLI
  is already on the machine, so the assistant costs a key that was never needed.
  Re-scoped rather than built, because the CLI is not a model endpoint to point
  at: it is the full agent harness, it will not take this app's tool definitions
  over stdin (custom tools reach it only through MCP), and it always executes
  tools itself — there is no "hand back a `tool_use`, I run it" mode, which is
  what the Messages API does and what the webview-hosted loop depends on. Nine of
  the fifteen tools answer from tab/editor/result state the CLI's own process
  cannot see, so backing the loop with the CLI means one of two things, each a
  cost this has not paid: a chat-only assistant with no tools at all, or an MCP
  bridge plus the reverse-RPC into the webview that `docs/decisions.md` already
  rejected as the largest new machinery the feature could have had. Parked until
  one of those is chosen; the API-key path stays the tool-capable one.

- **Open a `.sql` file from outside the app** — A `.sql` file on disk can only
  reach the editor by pasting its text in; there is no way to double-click one,
  "Open with" Squeal, or drop it onto the window. Register Squeal as a
  selectable default app for `.sql` on install, on all three platforms (each
  its own mechanism — the Windows installer's registry association, macOS's
  `Info.plist`/`LSHandlerRank`, a Linux `.desktop` MIME association), so
  double-clicking or "Open with" launches it into a new tab. Drag-and-drop of a
  `.sql` file onto the window opens it the same way — the same underlying need,
  asked for together. A huge file opens exactly as any file does today, through
  Monaco, which has its own large-file mode (past roughly 50MB it drops syntax
  highlighting and similar niceties rather than choking) — true virtualization
  or streaming of a huge file's *content* is a real, much bigger investigation
  Monaco does not offer for free, and is not assumed solved by this item.

## Tech debts

Things that should be improved on code wise

- **macOS UI test suite** — The UI suite drives the app through WebView2's CDP,
  which exists only on Windows, so on macOS — a supported target — nothing
  exercises the running app and a regression that shows only in the mac webview
  ships unseen. Add a suite that drives the macOS webview the way the Windows one
  drives WebView2, so both platforms the app targets are covered.

- **Contributing guide** — A new contributor has no single place for how the
  project works: the conventions live in the agent working-agreement, the
  architecture in the docs barrel, the testing rules in another doc. Write a
  contributing guide that gives a human one entry point — coding conventions
  (naming, self-describing code, why-not-what comments), the docs-routing
  discipline, how to add an engine, the non-negotiables, and the real-database
  testing requirement.

- **Split the oversized test files by feature** — The UI suite, the saved-items
  suite, and the extension suite have each grown into one huge file (the UI
  suite alone is over five thousand lines), which makes finding or scrolling to
  the right test real effort. Each already groups its tests into feature-shaped
  blocks — the UI suite's postgres browsing, mysql browsing, the relationship
  diagram, the titlebar, saved connections, saved queries, workspaces, multiple
  connections, and so on. Split along those existing boundaries, one file per
  feature area, instead of inventing a new grouping.

- **Strip what-comments** — The codebase carries comments that narrate what the
  code already says, against the standing rule that a comment explains why and
  never what. Do a pass that removes the noise, leaving only the why-comments the
  rule keeps. Can you also update the claude md so that it's more respected

