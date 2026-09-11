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

- **Tab context menu mixes closing with everything else** — The tab right-click
  menu (Rename, Save, Duplicate, Close, Close others, Close Tabs to the Right,
  Close All) is one flat list with actions before closes. Closing is what gets
  used most, so split it into two groups with a plain visual divider (no text
  subheaders): closing behaviors on top, tab actions below. Within the closing
  group, order by actual usage — Close others and Close Tabs to the Right ahead
  of plain Close and Close All.

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

- **A manually-typed SQLite path fails in some cases** — Typing a database file
  path by hand rather than using Browse misbehaves, with spaces in the path the
  suspected trigger; the exact symptom is not yet pinned down and needs
  reproducing before the fix.

- **The connection color picker misbehaves when several swatches are clicked** —
  Reported by a Windows 11 user (a screenshot), the connection screen's color
  picker goes wrong when multiple swatches are clicked in a row; it has not been
  reproduced locally on Linux or Windows yet, so the exact failure is still to
  be pinned down.

- **Closing the old process during an update is sometimes very slow** — When
  applying an update, shutting down the current process before relaunching is
  fast most of the time but occasionally very slow. Likely the background
  extension process rather than the app itself, but unconfirmed, and the
  trigger for the slow case isn't known yet either.

- **The error card's actions sit on top of the error text** — The "Diagnose with
  AI" and copy buttons are absolutely positioned in the error card's top corner,
  so they float over the message's first line instead of beside it. Put them in
  the card's normal flow next to the text, where they cannot cover it.

- **Fonts fall back to whatever the OS has installed, not what's designed** —
  The app names a chrome font and a monospace font (used throughout: the SQL
  editor, the results grid, diagrams, the assistant) but never ships them as
  files, so each OS silently substitutes its own default sans-serif and
  monospace instead — nothing is actually standardized. Bundle both fonts
  locally so they render identically on Windows, macOS, and Linux, independent
  of what happens to be installed on the machine.

## Features

Things that do not exist yet.

- **Export a table** — Getting a table out of the app means selecting rows by
  hand or writing the dump query yourself. Add an export that streams a whole
  table — all rows, paged from the server so a large one never has to land in the
  grid first — to a file chosen by a native save dialog, as CSV or as SQL. The
  SQL form is INSERT statements, with the table's `CREATE TABLE` offered as an
  optional preamble that reuses the definition work from the context menu. The
  extension produces the rows, since the UI cannot read a database, and every
  value is emitted exactly as the server sent it, quoted per engine — never
  reformatted through a JS `Date` or `Number`.

- **Hide and show grid columns** — There is no way to hide a column in the
  results grid at all today. Add a right-click "Hide column" entry on column
  headers, plus a toolbar affordance listing every column with a checkbox so a
  hidden one (which has no header left to right-click) can be brought back.
  Deliberately session-only, the same way column order was in-memory before
  it gained per-table persistence: hidden columns reappear once the tab is
  closed or the app restarts, with nothing written to the settings store.

- **French and English UI** — Every string is English, written where it is used,
  so there is no seam to translate at. Add one, with French beside it and the
  language picked from settings. The rule that has to survive it: chrome is
  translated, data never is. Locale-aware date and number formatting is the
  headline feature of every i18n library and the one thing this app has promised
  not to do — a shifted date and a rounded BIGINT are far worse than an
  untranslated column header.

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

- **Unify selection and the context menu across the results grid** — Selecting
  a whole column, or everything in a result set, has no gesture at all today —
  only the row-number gutter and data cells have a right-click menu, and
  selecting more than one row means dragging or shift-clicking by hand, which
  is painful on a large result set. Column headers and the corner cell (between
  the row-number column and the header row) currently do nothing. Applies to
  both browsed table grids and ad-hoc query results. Add: clicking the corner
  cell (plus a keyboard shortcut) selects everything; clicking a column header
  selects every value in that column; and one standardized context menu that
  reads whatever is currently selected — a cell, a row, a column, or
  everything — instead of the fixed, click-target-specific menu there is now.
  As part of that menu, "Copy as SQL" stops being gated on browse mode or a
  known primary key (today it only shows up when browsing a table) and is
  always offered, rendering the current selection as a SQL statement even when
  there's no PK to key an INSERT or UPDATE off of. When the selection includes
  a cell, the menu also offers copying that cell's column name.

- **Auto-fit a result column's width to its content** — Column resize is
  drag-only; there is no quick way to size a column to fit what's actually in
  it. Double-clicking a column's resize handle should size it to its largest
  currently visible value, the way spreadsheets do.

- **Lazy total row count on a browsed table** — The results bar for a browsed
  table shows only the loaded range ("rows 1–50"), never how many rows the
  table actually has, because running `COUNT(*)` on every browse could be slow
  on a huge table. Add a click-to-reveal affordance next to the row range that
  runs the count on demand and shows it (e.g. "of 1,204,000") once fetched.
  Ad-hoc query results are unaffected — they're deliberately unpaged already.

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

- **Strip what-comments** — The codebase carries comments that narrate what the
  code already says, against the standing rule that a comment explains why and
  never what. Do a pass that removes the noise, leaving only the why-comments the
  rule keeps. Can you also update the claude md so that it's more respected

