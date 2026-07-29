# Backlog

Added via the `backlog` skill, which grills the idea first — so everything here
is work that survived questioning, not everything anyone thought of.

Four sections, always these four, in this order.

Items name features, never files or functions. Files move; the feature doesn't.

---

## Improvements

Things that already work, but not well enough.

- **Order the tree by object type, not purely alphabetically** — Tables, views,
  and functions are interleaved alphabetically in the tree today. Order by
  type instead, with no visual section header: all tables first, then all
  views, then all functions — alphabetical within each group.

- **Retain result grid scroll position per tab** — Switching away from a tab
  and back resets its result grid's scroll position (both horizontal and
  vertical) to top-left, for both query tabs and table-browse tabs opened
  from the tree. Each tab should remember and restore its own scroll position
  on return — reset only when the tab's query is re-run, since a fresh run's
  rows may no longer match the old position.

## Bugs

Things that are wrong.

- **Windows icon is too small** — The icon SVG was scaled to 80% to satisfy macOS
  Dock compositing, but Windows shows the icon at native size and the padding
  makes it read as shrunken in the taskbar. Restore the full-bleed SVG and move
  the 80% downscale into the macOS packaging script that already generates the
  .icns, so each platform gets the artwork it needs from the same source.

- **Unbounded table listing** — `listTables` fetches every table in the database
  with no limit, so a database with thousands of tables is slow to query,
  renders an unusable tree, and chokes autocomplete. Cap the result at a fixed
  limit (e.g., 250) with a note in the tree that more exist — the filter bar
  still searches the full set on the server side. Autocomplete respects the
  same cap.

- **Update ignores custom install path on Windows** — The Windows installer
  lets you choose an install location, but a later update reinstalls to the
  default path instead of the one originally chosen, effectively relocating
  or duplicating the install. The updater needs to read back and respect
  wherever the app is actually installed.

- **Unquoted mixed-case identifiers in Postgres autocomplete** — Autocomplete
  suggests Postgres column and table names as-is, so accepting a suggestion for
  a mixed-case identifier like `createdAt` inserts it unquoted. Postgres folds
  unquoted identifiers to lowercase, so the resulting query fails with
  `column "createdat" does not exist` even though the name came straight from
  the tree. Quote an identifier on insertion whenever it needs quoting to
  preserve its case. Postgres-only: MySQL column lookups are case-insensitive
  regardless of quoting, and SQLite is lenient about ASCII case, so neither
  reproduces this.

## Features

Things that do not exist yet.

- **Export and import connections** — Moving connections to another machine means
  retyping every one of them. Export all workspaces and their connections from the
  File menu to a file chosen by a native save dialog, and import one back, merging
  into the store rather than replacing it — an exported file nothing can read back is
  not a feature, so both halves are this item. Passwords are excluded by default,
  because they are sealed with a key from the OS keychain that does not travel;
  including them is a deliberate opt-in checkbox in the export dialog, which states
  outright that they leave the encrypted store and land in the file as plaintext.
  Import asks for whatever the file does not carry. This stays separate from GitHub
  sync: that one is continuous, personal and needs an account, this one is a file you
  can hand over or keep as a backup with no network at all.

- **Export a table** — Getting a table out of the app means selecting rows by
  hand or writing the dump query yourself. Add an export that streams a whole
  table — all rows, paged from the server so a large one never has to land in the
  grid first — to a file chosen by a native save dialog, as CSV or as SQL. The
  SQL form is INSERT statements, with the table's `CREATE TABLE` offered as an
  optional preamble that reuses the definition work from the context menu. The
  extension produces the rows, since the UI cannot read a database, and every
  value is emitted exactly as the server sent it, quoted per engine — never
  reformatted through a JS `Date` or `Number`.

- **Light theme** — The design system is Radix dark and nothing else: no token
  has a light value, so the app is dark or it is broken. Give every token a light
  counterpart and somewhere to choose — theme is the first user setting, so it
  brings that screen with it. Three things have to follow the switch, and each
  will otherwise be found by noticing it looks wrong: the editor's theme is built
  once by reading the tokens, the OS window frame is painted `--bg` by the
  extension because Windows draws 7px above the titlebar that no webview can
  reach, and the app icon has the dark plate deliberately baked in.

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

- **LLM assistant** — A side chat panel (like VS Code) for generating SQL from natural language, explaining queries, fixing errors, and suggesting optimizations. Users bring their own API key for Claude, OpenAI, or DeepSeek, pasted into settings — no hosted backend.

- **GitHub sync** — Authenticate via browser-based OAuth (no hosted backend) and sync workspaces, connections, and user settings to a private gist automatically on change. Connection passwords are never included in the synced data.

- **Preferences menu** — Add a Preferences menu next to About in the title bar with two items: Settings (a shell screen with placeholders that Light theme and French/English UI populate later) and Keyboard shortcuts (a visual editor for remapping keys).

- **Saved queries** — Save the current editor content as a named query with Ctrl+S, then reopen any saved query into a new tab from a button at the right of the tab bar. Queries are global, not scoped to any connection.

- **Split the editor** — Working two queries means constantly switching tabs and
  losing your place, whether comparing two results, referencing one query while
  writing another, or copying between them. Let a tab be dragged to the side to
  dock it into a second pane beside the current one — two tabs of the same
  connection, each with its own editor and result grid. Session-only state, same
  as today's sidebar/results resizing; closing either pane's tab collapses back
  to a single view.

- **Command palette** — Every action is reachable exactly one way: a menu, a
  button, or a keybinding you already have to know. Put the common ones behind a
  palette — run, format, switch connection or database, toggle read-only,
  settings, a new tab — along with jumping to a table by name, which is the part
  that earns it a keybinding once a connection holds more tables than a tree is
  pleasant to scroll. Monaco ships its own palette, editor-scoped and live today;
  turn it off so there is one. The composition root owns it and hands it the
  commands, because a palette that imports every feature is exactly the hub the
  feature split exists to prevent, and whatever key it takes has to be rebound
  inside the editor too — the way running already is — or Monaco eats it first.

- **Relationship diagram** — Understanding how tables relate means reading DDL
  or reaching for another tool, because nothing in the app shows foreign keys
  at all — the tree only marks primary keys. Add a diagram, opened from a new
  top-level menu item, laying out every table in the current database with
  their columns and primary/foreign keys marked, connected by lines for each
  FK. Clicking a table node opens that table the same way clicking it in the
  tree does; nodes can be dragged to declutter an auto-layout, but the
  arrangement is not remembered — it lays out fresh each time the diagram is
  opened.

- **Linux AppImage release** — Linux ships no release download at all right now
  — the raw zip it used to carry had no desktop integration (no icon in the
  launcher, no .desktop entry, nothing), which was worse than nothing, so it
  was dropped. Wrap the Neutralino binary output in an AppImage with a
  .desktop file and the app icon, so Linux users get the same download-and-run
  experience as the other platforms. AppImage only for now; deb and other
  formats can follow once the format is proven to work.

## Tech debts

Things that should be improved on code wise

- **Continuous integration on pull requests** — Nothing runs on a PR today, so a
  change that breaks the build or a test is only caught when someone runs it
  locally by hand — and the suites that run against real databases are the whole
  safety net this project leans on. Add a pipeline that builds, typechecks, and
  runs the extension suite (real MySQL/Postgres plus the seeded SQLite file) on
  every PR, and the Windows-only UI suite on a Windows runner. Linting joins it
  once a linter is adopted — its own item below.

- **macOS UI test suite** — The UI suite drives the app through WebView2's CDP,
  which exists only on Windows, so on macOS — a supported target — nothing
  exercises the running app and a regression that shows only in the mac webview
  ships unseen. Add a suite that drives the macOS webview the way the Windows one
  drives WebView2, so both platforms the app targets are covered.

- **One file per database engine** — The engine layer keeps the driver contract,
  the engine-neutral assemblers, and all three engines' SQL and value handling in
  one file, so adding a database means growing a file that already interleaves
  three and the clean "add an engine" the docs promise is buried in it. Split each
  engine's implementation into its own file, leaving the contract, the shared
  assemblers, and the dispatch central, so a new engine is a new file rather than
  an edit into a shared one. Structure only — every engine still answers the same
  contract tests.

- **Contributing guide** — A new contributor has no single place for how the
  project works: the conventions live in the agent working-agreement, the
  architecture in the docs barrel, the testing rules in another doc. Write a
  contributing guide that gives a human one entry point — coding conventions
  (naming, self-describing code, why-not-what comments), the docs-routing
  discipline, how to add an engine, the non-negotiables, and the real-database
  testing requirement.

- **Adopt a linter and formatter** — Style is left to discipline: there is no
  linter or formatter, so nothing mechanically enforces what the conventions ask
  for and drift is only caught by eye in review. Adopt both for what is
  mechanical and wire them into the PR pipeline — this is the linting the CI item
  leaves for later.

- **Strip what-comments** — The codebase carries comments that narrate what the
  code already says, against the standing rule that a comment explains why and
  never what. Do a pass that removes the noise, leaving only the why-comments the
  rule keeps.
