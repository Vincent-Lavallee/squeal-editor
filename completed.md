# Completed

Shipped work, newest last. Items arrive here from `backlog.md` unchanged, with
the date they were finished.

- **2026-07-23** — **Skeleton loading states** — Replace every "Loading…" text placeholder (table tree, query results, connection list) with pulsing skeleton rectangles shaped like the content that will load into each area.

This is a record, not a plan. Nothing here is waiting on anything.

---

## 2026-07-15

- **Feature folders in the frontend** — Components sit in one flat folder and the
  root component holds every piece of state, which is fine for three components
  and will not survive saved connections, IAM, Monaco and pagination all landing
  on it at once. Give connections, explorer, editor and results each a
  self-contained folder owning its own components, hooks and view-state context;
  the bridge stays shared and single, with features reaching it through typed
  hooks rather than dispatching for themselves.

- **A central store for frontend state** — The root component holds eleven
  useStates and threads all of them down as props, and every feature queued up
  adds more. Move anything that crossed the bridge — databases, tables, rows,
  saved connections — into Redux Toolkit slices, leaving state that never left
  the webview (expanded node, editor text, scroll position) in feature context;
  that "did it cross the bridge" test is the whole boundary, and this reverses the
  frontend doc's "a store is ceremony" call, which needs recording when it ships.

- **Saved connections** — Every launch starts at an empty connect form, retyping
  host, port, user and password to reach yesterday's database. Save named
  connections in the extension — SQLite, only the password encrypted, key from
  the OS keychain — and make the connect screen a list you pick from; the store
  cannot live in the webview, which has no keychain to hold a key that isn't
  sitting next to its own ciphertext.

- **Custom topbar** — The native Windows titlebar looks nothing like the app
  beneath it and spends a strip of screen on chrome that does nothing. Go
  borderless with a topbar carrying window controls, app menus and the active
  connection — VSCode's shape but the flat one-background look, divided by a 1px
  border and not a darker shade — with drag, double-click-to-maximise, edge resize
  and Aero Snap all still working; snap is the one custom titlebars routinely
  break on Windows.

## 2026-07-16

- **App icon** — The window, taskbar and Alt-Tab show Neutralino's stock icon
  because the config names none, and the favicon that does exist is a placeholder
  diamond whose only job is silencing a 404 in a webview that has no tabs. Draw an
  abstract seal — the animal, leaning on the pun — as a single bold silhouette in
  an existing accent token, legible at 16px because that is the size it is
  actually seen at, and point the window and packaged binary at it, not just the
  favicon.

- **A real SQL editor** — The query pane is a bare textarea: no highlighting, no
  line numbers, nowhere to find and replace. Move it to Monaco, matching the
  VSCode direction taken elsewhere, with find/replace over the editor text and
  highlighting driven by a dialect the engine reports as data — the UI feeds it
  to the editor without ever branching on engine type. No autocomplete yet, which
  means switching off the word-based suggestions Monaco enables by default.

- **Real icons instead of emoji** — Every glyph in the chrome is a literal
  character: the tree's database, table and view marks are emoji the OS font
  draws in its own colour and weight, and the expand caret is a typed triangle.
  They look cheap, they are the one bit of chrome that is not grayscale, and
  nothing says how an icon should be sized or coloured because the app has never
  had one. Replace all of them at once from a bundled set (Remix), tree-shaken to
  what is used and reachable offline — converting half of it leaves a drawn
  triangle beside a drawn icon, which reads worse than all-emoji does.

- **Paginated table browsing** — Opening a table previews 100 rows and then
  guesses whether more exist by checking whether exactly 100 came back, so a
  hundred-row table is labelled truncated and a larger one offers no way to reach
  row 101. Page it in the extension, which already authors the preview SQL and can
  author page N's, with explicit next/prev, no `COUNT(*)` (a full scan just to
  browse), and one row fetched beyond the page so "is there more" is answered
  rather than inferred; ordering stays the server's natural order and arbitrary
  query results stay capped, since paginating SQL the extension did not write
  means rewriting yours.

- **Tabs** — One editor and one grid means everything overwrites everything:
  clicking a table eats the query being written, and comparing two results means
  running one of them twice. Tabs come in two kinds — an editor with its result
  grid beneath it, and a bare grid opened by clicking a table, which should not
  spend half the screen on an editor nobody asked for — both rendering the same
  grid, so one place still knows how a row looks. A tab binds to a database, not
  merely to its connection: the rail picks the connection, and the database
  dropdown shows the *active tab's* database and moves that tab alone, so
  switching database to check one thing never drags every other tab along with
  it. Results are per tab, or switching tabs paints the last tab's rows under
  this one's query.

## 2026-07-16

- **Workspaces** — Saved connections are one flat alphabetical list, but they are
  not one flat set of things: a connection belongs to a project, and a project
  has the same servers again in each of its environments, so a list mixing every
  project together buries the four that are relevant. Group them by project and
  make picking one the way into the app — choose the workspace, then the
  environment inside it, then connect — creating, editing and deleting them from
  that same screen, with a default one so the whole feature can be ignored. Each
  carries a name and an icon from a small set kept deliberately disjoint from the
  chrome's own, so a workspace never wears a table's glyph. Environment is a
  field on a connection, from a fixed Local/Dev/Staging/Production for now
  (user-extendable later), with any number of connections per environment rather
  than four slots. A workspace groups and carries no behaviour of its own; a
  connection's name only has to be unique within one.

## 2026-07-17

- **Keyword completion in the editor** — Monaco highlights SQL but suggests
  nothing: it ships a grammar, not a completion provider, and word-based
  suggestions are off on purpose because they only ever offered words already in
  the document. Give the editor the dialect's keywords, so writing SQL stops
  being typing into a highlighted textarea. No bridge and no cache — these are
  the grammar's words, not the server's.

- **Schema-aware completion** — The editor knows nothing about the server it is
  pointed at, so every table and column is typed from memory and confirmed by
  running the query. Complete them from the real catalog, driven by the query as
  it is written: match identifiers against the known table names, fetch a table's
  columns the moment it is mentioned in a `FROM` or a `JOIN`, and offer that
  table's columns after its name or alias and a dot. Columns have never crossed
  the bridge, so it needs a catalog query per driver. The cache is keyed by
  connection and database — by database alone it repeats the tree's collision,
  two connections both holding an `app` — and is dropped when the database
  changes. It also forces a database's table list to be fetched on select rather
  than when its tree node is expanded: nothing can match a table never listed.

- **Multiple open connections** — Only one connection can be open, so looking at
  dev and prod together means disconnecting and losing where you were. The
  extension already keys everything by connection and holds a client per
  database, so it needs nothing: the work is the UI going plural, with a rail
  switching between open connections, each labelled and coloured by its
  environment — which a connection now carries, so nothing blocks this.
  A tab already binds to a database and picks it from a dropdown, but it does not
  carry a connection, so it needs one in the same change — otherwise a tab left
  on dev quietly runs against prod the moment the rail moves. The tree's
  per-database table cache has to become per-connection too: two connections
  whose databases are both named `app` would read each other's tables. The
  editor's column cache is already keyed that way and is the shape to copy —
  which also means the two caches disagree about what identifies a database
  until this lands.

- **2026-07-17** — **SQL formatting** — There is no way to tidy a query, and the
  editor's own Format Document action — already bound to a key and sitting in its
  context menu — does nothing, because nothing is registered to do it. Register a
  formatter over the whole document and hang a button off that, so the button,
  the shortcut and the menu entry are one thing instead of three. Formatters name
  dialects their own way (`postgresql`, where the protocol carries `pgsql` for
  Monaco's sake), so the UI adapts its one opaque dialect in one place; the
  extension must not grow a second dialect field, which is the
  two-tables-that-disagree outcome the protocol's Monaco ids were picked to avoid.

- **2026-07-17** — **Drop the brand diamond** — The ◆ mark reads as a stray blue
  dot, and it sits in two places: the titlebar and beside the wordmark on the
  connect screen. Remove it from both. It is decorative and carries no meaning, so
  nothing is lost — the titlebar keeps its menu and the screen keeps "Squeal".

- **2026-07-17** — **Automated release pipeline** — Cutting a release is entirely
  manual and the version lives in two files that can drift. Let release-please own
  it: commits adopt the conventional format so it can read the bump, and on merge
  it moves both the package and Neutralino versions in lockstep, keeps a changelog,
  tags, and cuts a GitHub Release. That release triggers a build that produces the
  Windows, macOS, and Linux binaries and attaches them — with the caveat that mac
  and Linux are unverified today (see the topbar item), so their binaries ship
  before anyone has confirmed they launch.

- **2026-07-17** — **Read-only connections** — Nothing stands between a stray
  `UPDATE` and production except noticing which connection you are on. Open a
  connection read-only and let the server refuse the write — both engines have
  read-only sessions, so there is no SQL parser of ours for a CTE or a procedure
  to sneak past. On by default for Production, shown in the bottom bar as a lock,
  and turning it off costs something: a modal that wants the environment name
  typed out. The session is per client and a connection holds one per database,
  so a toggle has to reach every open client and every one opened afterwards —
  miss the second and changing database quietly makes it writable again. This
  reduces accidents rather than making production safe; neither engine's
  read-only session covers DDL, and that guarantee needs a read-only database user
  instead.

- **2026-07-17** — **User-initiated auto-updater** — Getting a new version means
  finding the release and reinstalling by hand, so most installs will simply go
  stale. On launch, check the releases for a newer version and, only if the user
  says yes, download it — never on its own. Updating replaces the whole app, not
  just the frontend bundle: the native binary, the resources, and the Bun
  extension can each change between versions, so Neutralino's resources-only
  updater is not enough. Because Windows cannot overwrite a running executable, the
  download is staged while the app runs and applied on Restart — the instance and
  its extension exit, then a helper or installer swaps the files in and relaunches.
  The download is checked two ways before it is applied: a checksum for corruption,
  and a signature that proves it came from the maintainer and not someone else —
  which means a Windows code-signing certificate (Authenticode) or a detached
  signature verified against a key baked into the build, and the certificate
  carries real cost and lead time.

- **2026-07-18** — **Drop the run-shortcut hint** — The "Ctrl/⌘ + Enter" text next to the Run
  button is toolbar clutter. Remove it. The button still runs and the shortcut
  still fires; nothing advertises it, and that is fine.

- **2026-07-18** — **AWS IAM authentication** — Reaching an RDS instance means hunting down a
  password for it, when the SSO-backed AWS profile already on the machine can
  mint one; generate the token at connect time from a stored profile and region,
  never storing the token itself. Carries TLS with it — no connection uses TLS
  today and IAM auth is refused without it — and an expired SSO session must say
  so, not surface as a database access error.

- **2026-07-18** — **A colour per workspace** — Workspaces are told apart only by their icon, so
  the rail has no colour of its own to group by. Give each workspace a colour,
  chosen the same way its icon already is: a fixed palette of preset swatches on
  the Radix-dark scale, picked beside the icon in the create/edit form, stored as
  an id with a default so workspaces made before this are never colourless. The
  colour marks the workspace in the picker and tints its group in the rail — which
  is the dependency the rail-grouping item stands on.

- **2026-07-18** — **Rail grouped by workspace** — The rail packs identity into two derived
  letters tinted only by environment, so same-environment connections look alike
  and the letters read as cryptic. Group the rail by workspace instead, tint each
  group with that workspace's colour (from the per-workspace-colour item), and let
  each chip show both the connection's name and a readable environment
  abbreviation — Local, Dev., Stag., Prod. — with the room the two-letter mark
  never had. Environment stops being a colour and also surfaces in the bottom bar
  for the active connection. When one workspace holds two of the same
  environment, the name on the chip is what tells them apart. This assumes every
  open connection belongs to a workspace, which the current ad-hoc, workspace-less
  connection contradicts — that path has to close for the grouping to hold.

- **2026-07-18** — **A teal primary** — The one accent is a stock blue that reads as generic.
  Move it to teal/cyan on the same Radix-dark scale, keeping the "one non-gray in
  the chrome" rule. It is not just one swatch: the accent also drives selection,
  focus, badge backgrounds, and the SQL keyword colour, so all of those follow it
  and have to still read well on the single dark ground.

- **2026-07-18** — **Tables above views in the tree** — Tables and views are intermixed in the
  tree, so finding a table means reading past views to reach it. Order every
  table above every view; no heading, since the view icon already tells them
  apart. Existing order holds within each group.

- **2026-07-18** — **Expandable tables in the tree** — A table in the tree is a name and nothing
  else, so learning its shape means browsing it or leaving for the completion
  popup. Give each row a disclosure chevron that reveals its columns in place —
  name, type, and a mark on the primary key — while clicking the name still
  browses as it does now. The key mark means the column metadata has to grow a
  primary-key flag it does not carry today, which the editable grid wants anyway.

- **2026-07-18** — **Table context menu** — Right-clicking a table does nothing, so every table
  action has to be a button somewhere or a query typed by hand. Add a menu on
  right-click, and make it the surface the other per-table actions hang off
  rather than each inventing its own: copy the table name, open its full DDL in a
  new editor tab, and drop it. The definition is a faithful `CREATE TABLE` for
  both engines — MySQL from `SHOW CREATE TABLE`, Postgres reconstructed from the
  catalog (columns, constraints, indexes), which is the bulk of the work and
  belongs to each driver. Drop is guarded by a modal that wants the table name
  typed out, the same severity the read-only unlock uses, because it is DDL and
  nothing rolls it back.

- **2026-07-18** — **Editable result grid** — The grid only ever shows rows; changing one means
  leaving for a client that can write. Make it write back, but only where a write
  is safe: browse mode, where the table and its primary key are known. Edit a
  cell, delete a row, and copy selected rows as tab-separated text; edits and
  deletes stage as dirty state and one Save issues them together. A browsed table
  with no primary or unique key stays read-only and says why, because there is no
  row identity to target. The edited value goes back as text for the server to
  parse — never through a JS `Date` or `Number` — and setting NULL is distinct
  from clearing the field.

- **2026-07-19** — **Close button clips at the window edge** — The X control on the custom
  titlebar is sometimes cut off on its right side — part of the whole 46px
  button is lost, not just the glyph inside it. The trigger is not pinned down
  yet. First suspect is the Windows maximized overflow: a maximized window sits a
  few pixels past each screen edge, so the rightmost control runs off — the
  horizontal twin of the 7px top offset the frame already fights.

- **2026-07-19** — **`?column?` for un-aliased expressions** — Postgres returns `?column?` as the column name for `SELECT 1` and similar un-aliased expressions. Show the expression text from the query instead, so the result header is meaningful.

- **2026-07-19** — **Backend disconnection** — The extension process sometimes terminates with "Connection terminated unexpectedly," taking down the window with it. The crash log shows multiple connection errors from the extension before Neutralino exits cleanly.

- **2026-07-19** — **Stale placeholder in editor** — Opening a table definition from the context menu (e.g. "Show CREATE") inserts the SQL but does not clear the editor's placeholder text, so the placeholder stays visible underneath the pasted query.

- **2026-07-19** — **Collapse the sidebar** — There is no way to reclaim the left width for the editor and results. Ctrl-B collapses and restores the whole left side — the explorer tree — with a toggle handle on the edge so it is discoverable and mouse-reachable too. It starts expanded every launch; the state is a within-session toggle, not remembered. The key is bound app-wide and rebound inside the editor, or Monaco swallows it.

- **2026-07-19** — **Organize `src/` with `common/` folder** — Moved shared infrastructure out of the flat `src/` root into `common/bridge/` (bridge.ts), `common/icons/` (icons, workspace icons, workspace colors), and `common/db/` (engine dials, environments). Also created `common/components/` for the reusable primitives. App-level components and type declarations stay at root; no loose utility files left under `src/`.

- **2026-07-19** — **Inline styles, avoid CSS files** — Replaced the 5 CSS files (tokens, base, components, layout, index) with a single `residual.css` for things inline styles cannot express (pseudo-elements, @keyframes, :has(), compound grid selectors). Every colour, size, and radius lives in `tokens.ts` as typed constants — the single source of truth. Reusable visual patterns became React component primitives (`<Button>`, `<Input>`, `<Select>`, `<Badge>`, `<Modal>`, `<Note>`, `<Callout>`, `<Field>`, `<SrOnly>`, `<Mono>`) in `src/common/components/`. Shared CSS snippets became components; if something felt like it needed an exported CSS object, it became a component instead. Feature components own their layout as inline styles directly in JSX. CSS custom properties on `:root` remain only because Monaco's theme and the window frame paint read them at runtime via `getComputedStyle()`. A strict rule emerged: **never create a shared CSS object — make a component. Never export a style object — inline it. If it repeats, it's a component.**

- **2026-07-19** — **Database type in bottom bar** — Moved the database type badge (e.g. "PostgreSQL") from the editor toolbar into the bottom bar as a muted neutral badge next to the read-only lock, so the toolbar is cleaner and the connection facts are in one place.

- **2026-07-19** — **Cleaner no-result state** — Centered the running, no-result, and zero-row states in the results panel. The initial state shows a muted heading ("No results yet") with the prompt below; the zero-row state shows a green "Query finished" heading with the server's message below.

- **2026-07-19** — **Visible disconnect** — Moved the disconnect action out of the File menu and into the bottom bar as a red button with "Disconnect" text taking the full bar height on the left side.

- **2026-07-19** — **Dropdown alignment** — Matched the sidebar's database dropdown container height to the tab strip height so they align visually side by side.

- **2026-07-19** — **Bottom bar layout** — Moved the read-only lock icon to the right side of the bottom bar and the environment label to the left, with the database type badge beside the lock.

- **2026-07-19** — **SQL error presentation** — Centered the error message on the result screen inside a red-background card with monospace text, and added a copy icon button inside the card so users can grab the full error text.

- **2026-07-19** — **Sequential migrations** — Replace the `migrate()` function in the extension store (which uses ALTER TABLE checks to catch up old schemas) with numbered sequential migrations that are applied in order. Add a migration table in the db to keep track of which one ran

- **2026-07-19** — **Split the protocol by domain** — The single 644-line bridge contract mixed connection config, result shapes, updater status, the command map, and the channel's event names, so no question could be answered without reading past four unrelated domains. Split into one file per domain behind a single barrel, so both sides still import one contract.

- **2026-07-19** — **Tab improvements** — Drag-and-drop to reorder tabs. Right-click context menu on a tab with: Close All, Close All Except Current, Close Tabs to the Right, and Duplicate (copies query text, connection, and database). Closing all tabs leaves an empty editor state with no tabs.

- **2026-07-19** — **About menu** — Add an About menu next to File in the title bar with three items: Check for software update (moved here from the File menu, where it already works), Current version (a small dialog that shows the running version string), and open app data (opens the directory with the sqlite db).

- **2026-07-20** — **Muted railbar** — Tone down the colors on the sidebar railbar — it draws too much attention away from the editor and results. Kept the structure it already had (tinted heading, bordered and washed chips, filled active chip) and moved only the intensity: every hue is now a blend toward `--bg` at four named ratios. The grayscale-chip alternative was built alongside it as a second stash and compared before choosing.

- **2026-07-20** — **One chrome bar height** — The rail was 48px, the editor toolbar 44px, and the tab strip and sidebar head 32px, stacked directly on one another so the three heights read as a misalignment. Every bar in the stack is `--tab-h` (32px) now; `BAR_H` is deleted and `RAIL_H` is defined as `TAB_H`. The rail's groups went horizontal to fit, and bar-dwelling buttons took a new 24px height.

- **2026-07-20** — **Result-set filtering** — Filter the result set above the grid with a structured builder: each row is a column, operator (=, ≠, >, <, LIKE, IN, IS NULL, IS NOT NULL), and value, stackable with AND/OR. Toggle to a raw WHERE clause text box as an alternative. Filters re-run the query against the database; reload is user-initiated, not automatic. Shipped browse-only — a grid tab, where the extension authors the SQL — because filtering a query's result means wrapping the user's statement, which is the rewrite `db.query` already refuses; builder values bind as parameters while the raw clause is the user's own text.

- **2026-07-20** — **Package the macOS release** — CI zipped the raw `neu build` output for macOS: a bare executable and resources folder, no `.app`, no signature, no `.dmg`. `scripts/package-macos.sh` now builds a real bundle — payload in `Contents/MacOS/` because that is what `NL_PATH` resolves, `icon.icns` from the source PNG, ad-hoc signed inner-out — and lays it into a `.dmg` that replaces the zip. arm64 only: the extension is arm64 whatever the shell is, and a universal build would launch on Intel and then hang with no database. Notarization stays out of scope, so first launch needs right-click-Open.

- **2026-07-20** — **Devtools open on launch in the release build** — The inspector opens by itself
  every time the app starts, which is right while developing and wrong in an installed
  app: a user gets a debugger window they did not ask for, over a program holding live
  database credentials. It should open on launch only when running locally, with the
  release build stripping the auto-open while leaving the inspector reachable on
  demand, so a user's problem can still be diagnosed. The UI suite is not at risk —
  it reaches the page over the debugging protocol through an environment variable it
  sets itself, not through this setting.

- **2026-07-20** — **Search the database dropdown** — Picking a database means finding it by eye in
  an unfiltered list, which stops working on a server holding more than a screenful.
  Type to filter it. The dropdown is a native select today and a native select
  cannot hold a search field, so the shared select becomes a custom listbox — drawn
  to look exactly like the one it replaces, since nothing about the chrome is meant
  to change — with the search field opt-in per usage: on for the database dropdown,
  off for Engine, Environment and Authentication, where a search box over four fixed
  options is noise. The command palette also promises a database switcher; that
  stands, because reaching for the dropdown and reaching for a palette are different
  gestures.

- **2026-07-20** — **Filter the table tree** — Finding a table means scrolling the whole list, which
  is the same problem the database dropdown has one row above it. Put a filter field
  under the dropdown, always visible, filtering as you type. It matches table and
  view names only: columns are fetched lazily per expanded table, so matching them
  would find hits in the tables you happen to have open and silently miss every
  other one. Filtering hides rows and changes nothing else — ordering, tables above
  views, expansion and the context menu all behave as they do unfiltered.

- **2026-07-20** — **Group the tree by schema** — A Postgres database with several schemas lists every
  table in one flat run, and the only hint of where a table lives is a schema glued
  onto the front of its display name. Group them under collapsible schema headings,
  grouped by default, toggled from a control in the sidebar itself — not from
  Settings, which does not exist yet and would block this — and the choice is
  remembered globally, since it is a preference about trees and not a fact about one
  server. Schema has to become its own field on a table rather than a prefix on its
  name: splitting a display string on a dot is guessing, and a table name may contain
  one, so the browse, definition and drop paths qualify from the field instead. MySQL
  has no schema layer — its database is the schema — so its tree is untouched and the
  toggle does not apply there.

- **2026-07-21** — **SQLite support** — Connect to a SQLite database file via the same extension
  flow that Postgres and MySQL use. On the connection screen, browse to an existing
  `.db` file with the OS dialog or type a path — no host, port, user, password or
  SSL, since a file has none of them. The path travels in `ServerConfig.database`
  rather than a field of its own, because for SQLite the file *is* the database, and
  `listDatabases` reports that path back so the connection keys to exactly one client
  instead of quietly opening a second handle onto the same file. It joins the same
  `describe.each` contract block as the other two engines and passes it unchanged;
  the three lines that moved were the block over-assuming, not the engine. Creating a
  new database file is deliberately not part of this — a missing file is a failed
  Connect that names it, never a silently conjured empty database — and is its own
  backlog item.

- **2026-07-21** — **Star a table** — The handful of tables actually worked on sit wherever the
  alphabet put them, so reaching them costs a scroll every time. Star a table from
  its context menu — the surface per-table actions already hang off — and starred
  tables lift into a pinned group at the top, out of the list below rather than
  repeated in it, with tables-above-views still ordering each group. Stars persist
  in the extension store, keyed by connection and database the way the table cache
  already is: keyed by database alone, two connections both holding an `app` would
  wear each other's stars. Filtering matches pinned and unpinned alike.

- **2026-07-21** — **Resizable panels** — Make both the table tree sidebar and the result panel (under the editor) resizable via drag handles, so the user can adjust the split proportions.

- **2026-07-22** — **The topbar off Windows** — It is built to one platform's conventions: window
  controls on the right, drawn and sized the way Windows draws and sizes them,
  which macOS contradicts by putting them on the left as traffic lights that going
  borderless hides. Neither macOS nor Linux has ever been launched, so the rest of
  what the bar does there — dragging, resizing, snapping — is unknown rather than
  known to work.

- **2026-07-24** — **Select a cell** — The grid selects whole rows and nothing smaller, so lifting one
  value out means copying the entire row and cutting the rest away by hand. Click a
  cell to highlight it and Ctrl+C copies that value alone; arrow keys move the
  selection, since the grid already takes focus and reads keys, and a highlight that
  cannot move is half an interaction. Single click is free today — editing opens on
  double click — so nothing has to be rebound. Cell and row selection are mutually
  exclusive, each clearing the other, which keeps Ctrl+C meaning "copy what is
  selected" and leaves Delete applying to rows only. A NULL cell copies as nothing
  rather than the word the grid draws. Rectangular ranges are a separate item: the
  drag, the shift-click and the tab-separated shape are their own problem, and row
  copy already covers grabbing data in bulk.
