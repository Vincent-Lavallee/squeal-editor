# The frontend

`frontend/` — React 18 + TypeScript, built by Vite into `resources/`, which is
what Neutralino serves.

For anything visual, read `design-system.md` instead of this file.

## Files

```
src/main.tsx            entry; initBridge(), <Provider>, render
src/App.tsx             the titlebar, then routing: connected && !adding
src/Shell.tsx           the composition root; wires the features together
src/common/             shared infrastructure, no components
  bridge/bridge.ts      typed request/response over the extension channel
  icons/                icon bindings, workspace glyphs, the connection colour palette
  db/                   the UI's engine table and environment list
src/store/              every slice; bridge-crossed state and the keys it is held under
  index.ts              configureStore + RootState/AppDispatch
  hooks.ts              useAppDispatch / useAppSelector
  thunk.ts              createAppThunk + errorMessage
  sessionSlice.ts       every open connection, and which is in front + useSession()
  tabsSlice.ts          what is open, and what each one is pointed at + useTabs()
  workspacesSlice.ts    the workspace list
  savedSlice.ts         the stored connection list
  explorerSlice.ts      the catalog: databases, their tables, their columns
  resultsSlice.ts       the result grid, keyed by tab
  updaterSlice.ts       the release check, download progress + useUpdater()
  settingsSlice.ts      the user's preferences + useBooleanSetting()
src/features/
  connections/          ConnectScreen, ConnectionForm, SavedConnectionList,
                        WorkspacePicker, WorkspaceForm, PasswordPrompt,
                        useSavedConnections, useWorkspaces
  titlebar/             Titlebar, Menu, AboutDialog, useAbout, useWindowChrome
  rail/                 ConnectionRail: the open connections, and the way between
  tabs/                 TabStrip: the strip, its menu, and its drag
  explorer/             Sidebar, DropTableConfirm, useExplorer
  editor/               EditorPane, useEditor (text surface over the tabs slice), monaco (theme + worker),
                        completion + keywords + sqlScope + useSqlCompletion,
                        format + useSqlFormatter
  results/              ResultsTable, ResultsContext (useResultsView), useResults
  statusbar/            StatusBar + ReadOnlyConfirm: the bottom bar and its lock
  updater/              UpdateBanner, useUpdater: the found-update strip
src/neutralino.d.ts     ambient types for the global Neutralino client
src/styles/             the design system
```

The session lives in `store/`, not in `features/connections`. Every feature reads
the connection, so a feature owning it would be a hub in everything but name and
would force its siblings to import it — exactly what the feature split exists to
prevent. `features/connections` owns the *screen you connect from*; the session
it opens belongs to the app.

The tab list is in `store/` for the same reason, and `features/tabs` is the same
shape: it owns the *strip you click*, not the tabs it draws.

## State

**The boundary is "did it cross the bridge".** If a value was sent to or received
from the extension, it belongs in a Redux Toolkit slice. If it has only ever
existed in the webview, it belongs in its feature's context. That one test is the
whole rule; apply it and everything else here follows.

**With one amendment, which tabs forced.** The bridge test decides *slice vs
feature context*. It does not decide *store vs nowhere*. `activeTabId` and a
tab's `kind` never crossed and are in the store anyway, because a tab's id is the
key that crossed values are held under — `results` is keyed by it — and a key
that lives apart from its values is two sources for one fact.

| | Where | Why |
|---|---|---|
| open connections: id, `savedConnectionId`, config, `dialect`, `name`, `workspaceId`, `color`, `environment`, `readOnly` | `session` slice | crossed |
| `order`, `activeConnectionId` | `session` slice | never left, but see above |
| a tab's `connectionId`, `database`, `table`, and `sqlByTab` (editor text) | `tabs` slice | crossed |
| `tabs`, `activeTabId`, `kind`, `title`, `defaultDatabase`, a grid tab's `filter` seed | `tabs` slice | never left, but see above |
| `databases`, `tables`, `columns`, `stars` | `explorer` slice | crossed |
| `result`, query error, `running`, `browse` (with its `keyColumns` and the `filter` the page was fetched with), per tab | `results` slice | crossed |
| staged cell edits + row deletes, per tab (+ `saving`, `saveError`) | `results` context | never left, until Save |
| the filter *draft*, and whether the bar is open, per tab | `results` context | never left, until Apply |
| saved connections | `saved` slice | crossed |
| workspaces | `workspaces` slice | crossed |
| the release check, download `progress`, banner `dismissed` | `updater` slice | crossed |
| every stored preference, and whether the launch read has landed | `settings` slice | crossed |
| `adding` (the connect screen, with connections open) | `App` local state | never left |
| which connect screen is showing, and which workspace it is inside | `ConnectScreen` local state | never left |
| `maximized`, the open menu | `titlebar` local state | never left |
| which tree rows are expanded, which schema groups are collapsed, and the tree's filter text | `Sidebar` local state | never left |
| the sidebar's width and the results panel's height | `Shell` local state | never left |
| whether a `<Select>` is open, and its search text | `Select` local state | never left |

`adding` is the test pointing at "nowhere" rather than at a slice. It is a
routing question the extension has never heard of, and — unlike `activeTabId` —
nothing crossed is keyed by it, so there is nothing for it to be a second source
of. `activeConnectionId` is in the store for exactly the opposite reason: it *is*
the key the tabs, the tree and the caches are all read against.

The window chrome is the case that shows the test is about the *extension*, not
about "is it native". `useWindowChrome` talks to Neutralino's window API all day,
but the extension has never heard of any of it and it dies with the webview — so
it is not a slice.

The editor's text is the instructive case, and it is the one that flipped.
It used to be a context, keyed by tab id, because the extension had never heard
of it — the standing exception the bridge test allowed. **Per-connection session
restore ended that exception**: a query now has to survive a quit, so the
extension stores it, so it crossed, so it is a slice (`tabs.sqlByTab`). A tab is
no longer a store row plus a context entry joined by id — it is wholly a store
row. The doc that used to end this paragraph named the trigger — *"the day a query
has to survive a quit, it earns a slice"* — and that day is what shipped it. See
`docs/decisions.md`.

`dialect` is the same test pointing the other way: it is only ever read by the
editor, one feature, and it is in a slice regardless — because the extension is
what said it. It crossed; that is the whole rule. **"Three features read it" is
not a reason for a slice** — that is the argument for a slice living in `store/`
rather than inside a feature, which is a different question.

Anything keyed by tab must be dropped when the tab closes. `sqlByTab` is now in
`tabsSlice`, so it is pruned in the same reducer that removes tabs — `tabsClosed`
and `disconnect.fulfilled` each delete the text of the tabs they drop, which is
every way a tab leaves. The webview-only owners still **diff the store's tab list
in an effect** rather than hooking the close handler: `resultsSlice` reacts to
`tabsClosed`, `EditorPane` disposes Monaco models by diffing. Hook the one handler
instead and the next thing that closes a tab ("close others", a disconnect)
silently leaks.

**A disconnect is that second thing, and it arrived.** `EditorPane` needed no
change for it — it diffs, so tabs vanishing is tabs vanishing. `resultsSlice` is
not a component and cannot diff, so `disconnect.fulfilled` carries the departed
`tabIds` in its payload; it used to reset to `initialState`, which would now blank
the grids of every server still open. One event, carrying what its readers need —
the same shape as `sessionOpened` handing `databases` to the explorer.

**"Close others" was the third, and it cost nothing.** Both diffing owners took
it for free, exactly as this section predicted they would; only `resultsSlice`
needed a line, and only because it still cannot diff.

## Session restore

Connecting to a saved connection reopens the tabs and queries it had open last
time — shape restored from the extension's store, contents refetched. Launch still
lands on the connections list; nothing auto-connects.

**The shape is a `SessionSnapshot`** (`store/sessionSnapshot.ts`) — the tabs
(kind, database, table/schema, title, editor `sql`, grid `filter`), which one was
active by position, `nextQueryNo` and `defaultDatabase`. It leaves out runtime tab
ids, which are minted fresh every session. It lives in its own file, not in a
slice, because both slices touch it and importing a runtime value between them
would close a cycle — `tabsSlice` already imports `sessionSlice` for its matchers.

**Restore rides the connect, not a separate call.** `db.saved.connect` carries the
stored blob back as a `session` string; `connectSaved` parses it and puts a
`SessionSnapshot` on the payload, and `tabsSlice`'s `sessionOpened` matcher mints
the tabs from it in that one synchronous reducer — fresh ids, `sqlByTab` and the
grid-filter seed keyed by them, active tab by `activeIndex`. Bundling it (rather
than a stars-style `db.session.get` a beat later) is what stops a flash of the
default "Query 1" the matcher would otherwise mint and then have to unmint. A
snapshot with no tabs — or a `connect` from the typed form, which carries none —
falls through to that default. See `docs/decisions.md`.

**Saving is a listener middleware** (`store/sessionSyncListener.ts`), not a hook:
it watches the actions that reshape a session (`tabOpened`, `tabsClosed`,
`tabMoved`, `tabActivated`, `databaseChanged`, `sqlChanged`, `browseTable.fulfilled`)
and, debounced ~600ms, serialises every connection still open and dispatches
`saveSession` for the ones whose snapshot changed (a per-saved-id cache skips the
rest). It reads the whole store — a hook could not, and the editor text now living
in a slice is exactly what makes that reachable. `disconnect.pending` fires an
**immediate** save while the tabs still exist, so the last edit before a close is
not lost to the debounce; `fulfilled` is deliberately not listened to, because it
has removed the tabs and would save an empty session over a good one. Only open
connections are ever serialised, so a teardown never overwrites a stored snapshot.

**Grid tabs re-browse lazily, and the filter seeds on the tab.** A restored grid
tab has a `table` but no `results` entry, and the `Shell` effect that catches
exactly that browses it — only when it is first in front, so reopening ten tables
does not fire ten browses at once. A hand-opened tab browses imperatively and
already has a `results` entry by the time the effect runs, so the effect only ever
catches restored ones. The `WHERE` a restored tab was on rides on `Tab.filter` as
a one-shot seed the first browse consumes; after that `results[tabId].browse.filter`
is authoritative, and the serialiser reads the live one for a browsed tab and the
seed for one never viewed. Contents are always refetched — the snapshot carries no
rows, only the shape.

## The tab strip

`features/tabs` owns the strip you click: the tabs of the active connection, a
`+`, a right-click menu, and drag-to-reorder. What it operates on is the store's,
which is the split the whole feature exists inside.

**Closing takes a set, and closing one is the set of one.** `tabsClosed({ ids })`
is the only close action there is. "Close all except current" is not a loop over a
single close: dispatching N times re-picks the active tab N times, walking it
along the survivors instead of landing where the menu was summoned from, and
every reader keyed by tab id sees N events for one gesture. One action carries the
set, the active tab is chosen once from the shape after all of them are gone, and
the rule for choosing it is unchanged — the neighbour to the right of the first
tab lost, else the left, else **nothing**, because the last tab closing is the
empty state and not a reason to conjure a tab back.

**A reorder is written back into the slots it came from.** `tabs` is flat across
every connection, so `tabMoved` reorders the moving tab's *own* connection's tabs
and writes them into the very indices they already occupied. Splicing the flat
array directly is the bug that looks like it works: another connection's tabs
slide past each other whenever one sits between two of these, and you find out by
switching to that server and seeing its strip shuffled by a drag you did
somewhere else. Same lesson as the explorer's caches — a list keyed by less than
what identifies its contents does not look broken until a second thing shares it.

**What is being dragged is React state, not the drag payload.** Nothing reads
`e.dataTransfer` back; the id is set on `dragstart` and the drop reads it from
state. That is what lets the UI suite drive a reorder with three plain
`MouseEvent`s, which carry no `dataTransfer` at all.

**Duplicate is wired in `Shell`, because a tab's text is not in the tab.** The
copy is a new tab of the same kind and database; a grid tab re-browses its table
and an editor tab is seeded from `peekSql`, at birth, the same inbound-write seam
a definition tab uses. It spans tabs, the editor and the results, so it is the
composition root's and arrives at the strip as `onDuplicateTab` — a feature never
imports a sibling. The copy takes the next `Query N` rather than the original's
name, the same answer the tree gives when a table is opened twice: two tabs, and
you can tell them apart.

**Renaming double-clicks the label, and the draft while typing never leaves
`TabStrip`.** `title` is a tab field that crossed the bridge (session restore
carries it), but the in-progress text is component state — the same split
`ResultsTable`'s cell editor draws between an edit in flight and the value it
commits — so `tabRenamed` dispatches once, on blur or Enter, not per keystroke
the way `sqlChanged` does. A blank commit is discarded rather than saved empty,
the reducer's job rather than the input's, so there is one place that decides
what counts as a name. The input is a sibling of `tab-pick`, not a child of it:
a `<button>` may not nest an `<input>` (interactive content inside interactive
content), and the button's own mousedown handling is exactly the kind of thing
that would steal focus back the instant the input appeared. `tabRenamed` joins
the session-sync listener's watched actions in `sessionSyncListener.ts`, or a
rename would type-check and paint but not survive a restart.

**Focus and select-all happen once, in an effect keyed by the tab id, not in an
inline ref callback.** The first cut used `ref={(el) => { el.focus(); el.select(); }}`,
which shipped with only one character ever landing: a callback ref's *identity*
is what React diffs, and an inline arrow function is a new one on every render —
so React re-invoked it, `select()` and all, after every keystroke. Re-selecting
the whole field on every render meant the next keystroke replaced everything
typed so far, the way typing over a selected word does. `useEffect(..., [renaming?.id])`
runs once when rename mode is entered for a given tab and not again while its
draft changes, which is the fix.

## Picking a database with nothing open

The tree and the database picker used to go dark the moment the last tab
closed: both read `activeTab?.database`, and an empty state has no active tab.
`useExplorer`'s `database` now falls back to `selectDefaultDatabase` — the same
field `tabOpened` already falls back to when minting a tab with nothing else to
go on — so there is still an answer with no tab open at all, not only once one
exists to ask. The picker's own disabled check dropped its `hasTab` half
alongside it; `databases.length === 0` is the only reason left to grey it out.

**Picking a database from the empty state writes the connection's default,
not a tab's.** `Shell`'s `changeDatabase` already had two things to do
depending on whether a tab was active; this is the third branch, not a new
handler — no active tab means there is nothing for `databaseChanged` to target,
so it dispatches `defaultDatabaseChanged` instead, and the picker, the tree and
the next tab opened from `+` all read the same fact afterward. Clicking a table
row needed nothing new: `openGridTab` already reads the connection off state
rather than off a caller-supplied tab, so it mints one whether or not one
existed a moment ago.

## The editable grid

A browsed grid can be edited: change a cell, delete a row, copy selected rows as
TSV, and one **Save** issues the batch. It is offered only in browse mode and only
when the extension gave the page a row identity (`browse.keyColumns`) *and* the
connection is not read-only — otherwise the grid stays read-only and the results
bar says why. `useResults` computes `editable`/`readOnlyReason` and is the whole
surface; `ResultsTable` and its context menu touch neither `dispatch` nor the
context directly, the same feature-hook rule as everywhere else.

**A cell can be selected instead of a row, and the two are mutually exclusive** —
selecting one clears the other, both directions, so Ctrl+C keeps meaning "copy
what is selected" without asking which kind. `selectedCell` is component state
in `ResultsTable`, the same shape as `selected` (the row set) and reset by the
same effect on a new `result`. A single click on a data cell selects it (editing
still opens on double click, so nothing already free had to be rebound); the
arrow keys move it, clamped to the grid's own bounds; and Ctrl+C copies its
value alone, reading the *effective* value (staged edit if there is one, else
the original) rather than `copyRows`' raw row — a copy should match what is
highlighted on screen. A NULL cell copies as an empty string, never the word
the grid draws for it. Delete/Backspace still only touches row selection: a
selected cell is not a selected row, so nothing stages a delete from it.
Rectangular ranges (drag, shift-click, a tab-separated shape) are a deliberately
separate, unbuilt feature — row copy already covers grabbing data in bulk.

**The staged edits are a context, not a slice** — the bridge test again. They have
not crossed until Save (only the `db.write` arguments do), and they are keyed by
tab, so `ResultsContext` prunes them by diffing the tab list in an effect, never
from a close handler — the shape the editor's text held before session restore
moved it into a slice that prunes in the reducer instead. One twist rows
force: an edit is keyed by its **row index into the page on screen**, so each entry
stamps the `table@offset` page it belongs to and a different page starts fresh —
paging discards staging, switching tabs keeps it. The original key values are read
from the browsed row at Save time, so editing a key column is just another staged
cell while the `WHERE` still targets the original.

`saveEdits` is the thunk (it crosses the bridge, so it is one), reading the tab's
connection and database off state like `runQuery` and taking `edits`/`deletes` as
arguments the way `runQuery` takes `sql`. It touches no slice state: the grid stays
exactly as browsed while the write is in flight, and on success the hook re-browses
the same page and clears the staging. **A save error goes beside the save bar, in
the context — never into the slice's `error`**, which `ResultsTable` renders by
*replacing* the grid: a failed save must leave the grid and the edits the user is
still holding on screen. Setting NULL is distinct from clearing a cell (Ctrl+Delete
or the ∅ button versus an empty box), the write side of "show what the server
sent" — and it is refused on a key column, which has no NULL to be set to (it
identifies the row, and a primary key forbids NULL outright), so the ∅ button and
the menu item are absent there. Copying is a webview clipboard write
(`Neutralino.clipboard`), crossing nothing — the same as the tree's *Copy name*.

**"Copy as SQL" builds an `INSERT INTO` client-side, beside "Copy row" in the
same context menu.** It reads `result.rows`/`result.columns` the same way
`copyRows` builds its TSV — no round trip, and every value written exactly as
the server sent it, never through JS `Date` or `Number`; `NULL` is the one
value that is never a literal. Table, schema and column names are quoted per
engine through `quoteIdentifier` (`common/db/sql.ts`), the module `FilterBar`
also reads from now — a second copy of that function was the alternative and
would have been the two-tables-that-disagree outcome the filter bar's own
comment already warns about. **Gated on `browse !== null`, the same boundary
editing and FK navigation draw**: the table name an INSERT needs is the one a
browsed grid carries, and a hand-typed query's result has none — exposed as
`canCopyAsSql` since it needs none of `editable`'s read-only/key-column
reasoning.

**The row gutter opens the same context menu a data cell does.** `Menu.col` is
`number | null` rather than always a real column — right-clicking the row
number carries no cell to target, so *Set NULL* (which needs one) leaves
itself out while *Copy row*, *Copy as SQL* and *Delete row* — all row-level —
still show.

The browse page also carries each column's type (`columnInfo`, beside
`keyColumns`), so the grid header shows the type next to the name the way the tree
does when a table is expanded — one more fact travelling with the page that needs
it, rather than the grid reaching into the explorer's catalog cache.

## Following a foreign key

A cell whose column carries `ColumnInfo.foreignKey` (see `docs/extension.md`)
shows a small icon beside its value. Clicking it always opens a **new** tab —
never re-points the current one — browsed straight to the referenced table with
a one-condition filter: the referenced column equal to the value the cell held.
Deliberately not reused, the same rule "Clicking a table always opens a new tab"
already states: following a reference is exactly the moment you want to compare
it against where you came from.

**Reachable only from a browsed grid**, the same boundary editing and "Open
definition" already draw around a hand-typed query: `foreignKey` rides on
`browse.columnInfo`, which is `[]` for a query's result the same way
`keyColumns` is `null` there. A `SELECT * FROM events` typed by hand gets no
icon, for the reason it gets no edit affordance either — the extension does not
know which table's catalog to have read.

**`navigateForeignKey` (in `useResults`) mints the tab and browses it in one
motion**, reading `openGridTab` off `useTabs()` directly rather than being wired
through `Shell` — this spans tabs and results only, never the explorer, so it is
not the multi-feature case `Shell` exists for (see "Features never import each
other" below; `useTabs` is app-level infrastructure, the same as `useSession`,
not a sibling feature). A `NULL` value points at nothing, so the icon's handler
is simply not reachable — `ResultsTable` never renders it over a `NULL` cell in
the first place.

**The new tab's filter is never seeded into `ResultsContext`'s draft.** It does
not need to be: an untouched draft derives itself from `browse.filter`
(`filterToDraft` in `useResults`), so the bar shows the very condition that just
ran the moment the freshly opened tab reads it back — one `browseTable` carrying
the filter is the whole of the wiring, the same as `applyFilter` beside it.

## Filtering a browsed grid

`FilterBar` sits above the results bar on a **grid tab only**. It is either the
condition builder (column, operator, value, joined by one `AND`/`OR`) or a raw
`WHERE` box. Applying re-browses from the extension — see `extension.md` for why
a query's result has none.

**It is always open, and always shows a row.** There is no reveal button and no
collapsed summary: a filter you have to go and find is one you do not use, and a
button that opens a form is a click that says nothing. An untouched builder
renders one blank condition that is *not* in the draft yet — editing it is what
materialises it, and `useResults` prunes incomplete rows before anything runs, so
a bar nobody has touched is not a filter and Apply is disabled.

**The bar is exactly as tall as it has rows.** Every row is one line of a shared
grid — lead, column, operator, value, remove, then a trailing cell only the first
row fills with `+ / Raw / Apply`. A second line of buttons underneath would
double the height of the bar to hold controls that fit on the line already there.
The empty cells on later rows are load-bearing: drop them and that row's controls
slide left and the columns stop lining up.

**The draft holds both forms at once, and only `mode` says which is in force.**
`FilterDraft` (in `ResultsContext.tsx`) is not the protocol's `TableFilter` union
— it carries `conditions`/`conjunction` *and* `where` together, because the
union is the wrong shape the moment switching form has to keep what you were
switching away from. `toRaw` refreshes `where` from the current conditions every
time (`conditionsToWhere`, a fold over data already held, safe to redo); `toBuilder`
touches only `mode`, so the conditions it set aside are exactly what is still
there. Reading raw text back into rows would be parsing SQL, which this repo does
not do — that is the one direction that stays a reset, and it is a reset of
nothing, because the conditions were never disturbed by leaving.

Values become quoted literals when rendered into `where` (`name = 'O''Hara'`,
embedded quotes doubled), because the builder binds them and raw text does not —
handing a value over bare would make it an identifier. **Column names are quoted
too**, per `quoteIdentifier`, which mirrors `Driver.quoteIdent` in the extension
(backtick for MySQL, double quote otherwise) and reads `SqlDialect` off
`useSession()` the same way `EditorPane` already does for highlighting. Left
bare, the first cut of this shipped a bug: Postgres folds an unquoted
identifier to lowercase, so a mixed-case column like `eventType` rendered
unquoted becomes a lookup for `eventtype`, which does not exist. Quoting is
unconditional — the same call `quoteIdent` already makes — so there is no
"needs it or doesn't" judgment call to get wrong.

Seven things are load-bearing, and each was found rather than designed:

- **The draft is a context; the applied filter is a slice.** The bridge test,
  unbent, exactly as the staged edits beside it: only Apply crosses. Those two
  being allowed to differ *is* what an unapplied edit is, and `filterDirty` —
  the comparison of the two — is the whole of when Apply has anything to do.
- **The bar is keyed off the tab's `table`, not off `browse`.** A filter the
  server rejects clears `browse` (a failed page leaves nothing to page from), so
  a bar keyed off it would vanish together with the error — taking away the one
  control that fixes it. The tab still knows which table it is, so the bar and
  the draft survive and the correction is one edit away.
- **It renders above every early return in `ResultsTable`**, for that same
  reason: running, error and empty all replace the grid, and the filter belongs
  to the tab rather than to whatever the grid is currently showing. It draws
  nothing on an editor tab, so a query's result is untouched.
- **Apply and the form toggle are on the row; *Clear* is in the results bar.**
  That split is the same rule again rather than an inconsistency: an error
  replaces the results bar, so anything needed to *recover* from a bad filter has
  to live on the row that survives. Clear does not qualify — emptying the value
  and applying does the same thing — and it is genuinely a fact about the result
  on screen, which is what that bar is for.
- **Everything that re-browses carries the filter**: paging, and the re-read
  after a successful Save. Miss either and the grid silently widens back to the
  whole table under a filter the bar still claims is on.
- **The filter is part of the staging page key** (`table@offset@filter`, not
  `table@offset`). Row 3 is a different row once a `WHERE` applies, so without it
  staged edits would carry across a filter change and write to a row the user
  never saw — the exact failure the row-identity design exists to prevent.
- **The column dropdown reads `columns`, a field on `ResultsState` held apart
  from `browse`.** `browse` goes to `null` on a failed page — nothing to page
  from — but the bar and its dropdown outlive that failure by design, and the
  columns a table has did not stop being true because one `WHERE` was malformed.
  `columns` is written only by a *successful* page (and only when the page's own
  `columnInfo` is non-empty, so a successful-but-unreadable answer cannot blank a
  known-good list) and a failure never touches it. The grid header still reads
  `browse.columnInfo`, which does go empty with the grid it describes — the two
  fields answer different questions and only one of them needs to survive an error.

Applying always browses from **offset 0**: a filter's matches are a different set,
and holding the old offset lands on page 3 of a one-page result, which reads as
"no matches" rather than as a paging artefact. Reload stays user-initiated
throughout — editing the draft touches no database, and only Apply does.

## The way in

`ConnectScreen` is a switch over one `Screen` union: the workspace picker, a
workspace form, a workspace's connection list, a connection form, and the
password prompt. **Which workspace you are in is which screen you are on** — the
connection screens carry it, rather than a "current workspace" living somewhere
that has to be kept in step with them.

`screen` is `null` until something navigates, and while it is null the view is
**derived from the data**: one workspace means nothing to pick, so the picker is
skipped and the app lands where it always did; an empty workspace has no list
worth showing, so the form *is* the screen. Deriving rather than pinning at mount
means the first load settles without a flash.

Three things fall out of that, and each is invisible until it bites:

- **The picker has to be reachable from the list**, because it is skipped on
  launch. `.ws-bar` is that route and it doubles as the heading naming the
  workspace — without it a first-run user could never reach the screen that makes
  a second workspace. The empty workspace's form gets there through *Cancel*, for
  the same reason.
- **Deleting pins the screen before the delete lands.** The view follows the
  data, so removing the second-to-last workspace re-derives the launch screen and
  drops the user into the survivor's connection form mid-click. Deleting the last
  connection in a list does the same thing. Both handlers `go(...)` first. This
  was caught by the UI suite, not by reading it.
- **A screen inside a workspace that has gone falls back to the picker**, resolved
  once before the switch rather than in each case, so there is one answer to "the
  workspace is gone" instead of two that could differ.

Environments are a *grouping*, not a step: a workspace's connections render under
`Local / Dev / QA / Production` headings, in that order, and an environment
nobody used has no heading. Any number of connections may share one — they are
labels, not slots.

**A connection's name is required** — the form disables *Connect* until one is
typed, and `submitNew` saves the row before it connects. There is no unnamed,
workspace-less throwaway connection any more: every open connection is a saved,
named member of a workspace, which is what lets the rail group every one of them
under its workspace. `session.connect` therefore carries the `workspaceId` it was
launched from, the same UI-side fact as the `name`, `environment` and `color` it
already threaded — `db.connect` never hears any of the four.

**Every connection has a colour; a workspace has none.** The form's picker sits
beside the environment select: the same nine swatches `WorkspaceForm`'s icon
picker shape offers, defaulting new to the neutral `slate`. `flexWrap: 'nowrap'`
and a tightened gap keep all nine on one row at the card's fixed width. See
`docs/decisions.md`.

`ConnectionForm` chooses an authentication method: a password, or an RDS IAM
token minted from an AWS profile. Choosing IAM swaps the password field for a
profile and region, forces the SSL box on (the extension refuses an IAM token
plaintext), and stores nothing secret — the profile and region are not secrets,
so unlike the password they edit back in place. IAM is a variation on the
`ServerConfig` (`config.iam`), not a new connect action, so it reuses `connect` /
`connectSaved` and nothing in the store slices changed. **The one guard that is
invisible until it bites:** an IAM connection is `hasPassword: false` like one
that just did not save a password, so `pick` must check `config.iam` before
routing to the password prompt — there is nothing to prompt for.

## The editor

`features/editor` is Monaco. `monaco.ts` owns the two things that are not the
component — its worker, and a theme built by reading `tokens.css` — and
`EditorPane` creates the editor once and never re-renders into it. React owns
the box; Monaco owns everything inside it.

**One editor, one model per tab.** The model is what makes the text per tab;
switching a tab is `saveViewState` → `setModel` → `restoreViewState`. There is
never a second editor — which is why `window.squealEditor` is still singular.

Six things there look incidental and are not:

- **`inherit: false` on the theme.** vs-dark ships a `string.sql` rule that
  outranks any `string` rule the app writes. Inherit and the strings come up red.
- **Text flows one way: out.** Nothing writes the editor from outside — browsing
  a table opens its own grid tab, and swapping tabs swaps the *model*, which is
  not `setValue`. The formatter is the first outside writer that arrived and it
  obeys this: it returns a full-range *edit*, which Monaco applies like a
  keystroke, so the change flows out through `onDidChangeModelContent`. Whatever
  writes next (the palette) either does the same or feeds the value in *only when
  it differs from Monaco's own* — setting the value Monaco already holds fires on
  every keystroke and throws the cursor to the top of the document.
- **A table's definition is the one inbound writer, and it writes at birth.**
  "Open definition" opens a new editor tab holding the table's `CREATE`, which
  looks like writing text in from outside — but it does not touch a live model.
  `modelFor` seeds the model from `useEditor().peekSql(tabId)` when the model is
  *created*, so the seed and `sqlByTab` agree from the first frame and text still
  only flows out after. `peekSql` reads `store.getState().tabs.sqlByTab` **synchronously**:
  the shell opens the tab and sets its text in the same turn, and the model is
  created in an effect a beat later — but a Redux dispatch commits synchronously, so
  `getState` already holds the text by the time the model is born. (This is what
  the old context needed a `sqlRef` shadow for: a `useState` had not committed yet
  at that point, and the slice removed the need for the ref.) Session restore uses
  the same seam: `sessionOpened` writes `sqlByTab` in the reducer that mints the
  tabs, before any render, so a restored tab's model is born holding its text. This
  is the "write only when it differs" warning's seam; seeding at creation sidesteps
  it entirely, and no live `setValue` ever happens.
- **The dialect is set on every model, not the attached one.** Miss the others
  and a background tab comes back highlighted as plain SQL.
- **`layout()` before `restoreViewState`.** The pane is `display: none` on a grid
  tab, so `automaticLayout`'s observer has not fired when the switch effect runs
  and the editor still believes it is 0 tall. A scroll offset restored against a
  0-height viewport is silently lost.
- **Ctrl+Enter is rebound in the editor.** It is Monaco's own "insert line
  below", and Monaco wins inside its own DOM — the `window` listener that serves
  the rest of the app never sees the key. That listener is live on a grid tab
  too — the pane is mounted, just hidden — so it refuses for itself.
- **`window.squealEditor` is the UI suite's seam.** Monaco's text lives in a
  model, so there is no `.value` to read and nothing to type into. It holds no
  model at all while a grid tab is showing, so reads of it must guard.

**The pane is hidden on a grid tab, never unmounted.** That is not a preference:
there is one instance and every tab's model hangs off it, so unmounting would
dispose the lot and every other tab would come back empty.

### Completion

Four files, and the split is the app's own boundary drawn through one feature:

| File | Owns |
|---|---|
| `keywords.ts` | the dialect's words, read out of Monaco's own grammar |
| `sqlScope.ts` | a regex scan for the tables and aliases in a `FROM`/`JOIN` |
| `completion.ts` | the provider: what to offer, in what order, with which mark |
| `useSqlCompletion.ts` | the wiring — fetches columns, keeps the snapshot live |

**The words never cross the bridge and the catalog always does.** That is the
same test as everywhere else, applied inside one popup: `SELECT` is the grammar's
word and `email` is the server's. `keywords.ts` reaches into
`monaco-editor/esm/vs/basic-languages/*` for the very lists the tokenizer paints
with — so a word the editor highlights is a word it offers, with no second list
to drift — and `src/monaco-languages.d.ts` declares that shape, because those
grammar files ship no types.

`operators` is the trap in those grammars: `AND`, `IN`, `LIKE`, `NOT` and `JOIN`
live there and not in `keywords`, so taking `keywords` alone offers `SELECT` and
not `AND`. `monaco.ts` already pays for the same quirk, painting `operator` with
`--syntax-keyword`.

**`sqlScope.ts` is a scan, not a parser, and that is the design.** The text is a
query *being typed* — half a statement, an unclosed paren, a `FROM` with nothing
after it. A real parser rejects almost every keystroke that matters, which is
exactly when the popup must have an answer, so it would have to be
error-recovering, per dialect, and still be wrong. The regex is right far more
often and its failures are one-directional: a suggestion missing, never a wrong
one. **Nothing but suggestions may ever lean on it** — it does not decide what
runs.

Five things fall out, each invisible until it bites:

- **Columns are fetched off the text, not off the dot.** `useSqlCompletion`
  scans on every keystroke and dispatches `loadColumns` for whatever is in the
  `FROM`. By the time a `.` is typed after `users`, the columns have to already
  be there — start the fetch at the dot and you get an empty popup and a round
  trip. Typing the table's name is the event that says which table matters.
- **That effect runs per keystroke on purpose, and `loadColumns` is what makes it
  free.** Its `condition` carries the cache, and the thunk marks a table asked
  *before its first await* — without that, two keystrokes in a row both pass the
  condition and both fetch.
- **The provider is registered once and cannot close over anything.** It reads a
  ref, exactly like the Ctrl+Enter command and for the same reason: capture the
  catalog and it answers with the catalog as it was at registration, forever.
- **One provider per language, disposed on dialect change.** Two providers on one
  language both answer and the popup holds every suggestion twice.
- **After a dot: columns, or a schema's relations — never keywords.** The
  qualifier is the whole question, and it is one of two things. A table or alias
  answers with its columns (`u.`). A *schema* answers with the relations in it
  (`public.`), named bare because the schema is already typed. Keywords are
  suppressed either way — three hundred words that cannot follow a dot would bury
  the answer. The schema case has to be tried **after** the column case and only
  when it comes back empty: `sqlScope` scans a name ending in a dot (`FROM public.`)
  as a bogus table, so `resolveQualifier` claims `public` as one — but the catalog
  has no columns for it, and that empty answer is the tell that a schema was meant.
  A real table sharing a schema's name keeps its columns, which land here non-empty
  and never reach the schema branch. On an engine with no schema layer no relation
  carries a schema, so this offers nothing there and a `db.`-style qualifier stays
  the empty popup it was.

**Word-based suggestions stay off**, and the reason has not changed: they offer
the identifiers already in the document, which is a guess about a schema Monaco
has never read. What changed is that there is now something better. The UI suite
still pins it, with a bait word no keyword and no catalog could account for.

Monaco's relevance beats `sortText`, which is why `SELECT * FROM user|` offers
the `user` keyword above the `users` table: an exact prefix match outranks the
sort group. The groups (columns, then tables, then words) only break ties.

### Formatting

Format Document is Monaco's own action, and the whole feature is registering a
provider so it has something to do. `useSqlFormatter` registers one
`DocumentFormattingEditProvider` per dialect (disposed on dialect change, the
same rule as the completion provider); `format.ts` is the pure transform it
mounts. The toolbar's *Format* button runs `editor.action.formatDocument` — the
same action as Shift+Alt+F and the context-menu entry — so the button reaches
for Monaco's registered action rather than calling the formatter itself. One
action, not three.

Two things there are load-bearing:

- **The dialect is adapted in one place.** sql-formatter names Postgres
  `postgresql` where the protocol carries `pgsql`; `format.ts` holds the one map
  from `SqlDialect` to sql-formatter's language, the same shape as `keywords.ts`
  reading the grammar. The extension reports one dialect and both the editor and
  the formatter read it — a second dialect field is the two-tables-that-disagree
  outcome the protocol's Monaco ids exist to avoid.
- **A parse error is a no-op.** sql-formatter throws on input it cannot parse;
  the provider catches and returns no edits, leaving the text as typed rather
  than popping a notification about a query still being written.

### The three rules that keep this from rotting

1. **Features never import each other.** Anything spanning two of them is wired
   in `Shell.tsx` and nowhere else. Clicking a table is the live example: the
   explorer picks it, the tabs mint one for it and the results browse it, so
   `Shell` owns that handler and `Sidebar` takes it as a prop. Picking a database
   is the second: what it *means* depends on the tab kind (a grid tab re-browses
   its table), so `Sidebar` takes `onSelectDatabase` too. The context menu's
   "Open definition" is the third: the explorer fetches the DDL, the tabs mint an
   editor tab and the editor seeds it, so `Shell` owns `showDefinition` and
   `Sidebar` takes `onShowDefinition`. Its other two items stay in the explorer —
   copy is a webview clipboard write that crosses nothing, and drop is the
   explorer's own catalog changing (`useExplorer().dropTable`). **Duplicating a
   tab is the fourth**, and it is the tab strip's turn to take a prop: the copy
   needs the original's *text*, which lives in the editor's context and not in the
   tab, so `Shell` owns `duplicateTab` and `TabStrip` takes `onDuplicateTab`. Its
   other three items — the closes — stay in the strip, because closing tabs is the
   tab list changing and nothing else.
2. **Components never touch `dispatch` or `call` directly.** Each feature exports
   one hook — `useExplorer`, `useResults`, `useEditor`, plus app-level
   `useSession` and `useTabs` — and that hook is the feature's whole public
   surface.
3. **The session and the tab list live in `store/`, not in a feature.** Every
   feature reads them, so no feature could own them without becoming a hub in
   everything but name. `features/connections` owns the *screen you connect
   from*, `features/tabs` owns the *strip you click*; what they operate on
   belongs to the app.

**Routing is `connected && !adding`.** `session.activeConnectionId === null` used
to be the whole of it, and it stopped being the moment the rail grew a "+": that
has to reach the connect screen with connections still open, so "there is a
connection" and "show the shell" became different questions. `adding` lives in
`App` and is dismissed by watching `activeConnectionId` change — never by hooking
a connect handler, of which there are already two.

### Thunks read their target; callers do not pass it

`runQuery` reads **the connection and the database off the tab it names**.
Dispatch is synchronous, so pointing a tab at a database and then running is
guaranteed to query the one just picked, with no stale render in between — this
is also how `Shell` reads back the id of a grid tab the reducer just minted
(`useTabs().openGridTab`) in order to browse into it. Do not add a `database`
parameter back, and do not add a `connectionId` one; there is nothing to guard
against, and two sources for one fact is how they disagree.

**The connection comes off the tab and not off the session, and that is not
interchangeable.** The session's active connection is whatever the rail points at
*now*. The strip only draws the active connection's tabs, so the two agree today
— but the tab is the query's target and the session is a pointer at a different
question, and the failure mode when they diverge is a tab that looks identical
running against another server.

**`tabId` in a thunk's arg is not a counter-example.** The bridge has never heard
of a tab. It is not the *target* of the query — it is the **destination of the
result**, the key the reducer writes under, the same category as `browseTable`'s
`offset`. It has to be in the arg rather than the payload because `pending` has
no payload, and `pending` is what sets `running` on the right tab.

Two guards go with it, and both are silent when missed:

- **Key reducers off `action.meta.arg.tabId`**, never off whichever tab is active
  when the action lands. Same lesson as `loadTables.rejected`.
- **`pending` is the only place an entry is created.** `fulfilled` and `rejected`
  must find the entry or no-op: a query still in flight when its tab closes would
  otherwise resurrect the entry `tabsClosed` just deleted, and nothing would ever
  collect it again.

And `tabsSlice.nextId` **survives a disconnect** while `tabs` does not. Reset it
and the next session's first tab is `"1"` again — so a result still in flight from
the last session lands on whatever reused its id, right past the guard above.

## Using the bridge

The bridge is shared and single. Features reach it through their own hook, never
by dispatching for themselves, and every call goes through a thunk built with
`createAppThunk`:

```ts
export const loadColumns = createAppThunk(
  'explorer/loadColumns',
  async ({ database, table }: ColumnsArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      const res = await call('db.columns', { connectionId, database, table });
      return { connectionId, database, table, columns: res.columns };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    condition: ({ database, table }, { getState }) => {
      const { session, explorer } = getState();
      if (!session.activeConnectionId) return false;
      return explorer.columns[session.activeConnectionId]?.[database]?.[table] === undefined;
    },
  }
);
```

`call` is typed from `shared/protocol/`, so the payload and the return type are
inferred and a typo is a compile error. It rejects on a database error, so thunks
catch and `rejectWithValue` a plain string the UI can render.

`createAppThunk` types `getState` and pins `rejectValue` to `string`, so a
failure always carries something renderable. Its `condition` option is where a
"don't fetch twice" rule goes — the tree's cache is that one line, and the
already-fetched case never reaches the bridge. Note what the condition is keyed
by: the connection *and* the database, because that is what identifies the
answer.

### The caches in `explorerSlice` are all keyed by connection first

`databases` is keyed by connection. `tables` is keyed **connection → database**.
`columns` is keyed **connection → database → table**. Everything names the
connection it is true of, and nothing is emptied when a connection opens — there
is nothing to empty, because no key is ambiguous.

That was not always so: `tables` was keyed by database alone and *had* to be
wiped on `sessionOpened`, which was coherent only while one connection could be
open. Two connections both holding a database called `app` would have read each
other's tables. `columns` named its connection from the start and is the shape
the other two moved to.

**The lesson worth keeping is the one the asymmetry taught:** a cache keyed by
less than what identifies its contents does not look broken. It looks like a
cache, right up until a second thing shares a name.

**`columns[c][db][t] === null` means asked, not answered** — in flight, or
failed. It is a marker in the same map rather than a second map beside it because
the completion re-reads this on every keystroke: without it, `loadColumns`'
condition sees `undefined` and fires a fetch per keystroke, and a table whose
fetch failed is retried forever. **`loadColumns.rejected` is therefore
deliberately unhandled** — the `null` stays, so the table is asked exactly once.

**Nothing renders a `loadColumns` failure**, and that is not the "errors render
where the action was taken" rule being bent: no action was taken. It fires
because a name appeared in a `FROM` while someone was typing, so there is no
place on screen that is *about* it. The table simply suggests nothing.

**Markers are dispatched by the thunk, not written in `pending`.** `pending` has
no payload, so a reducer could only find the connection in `action.meta.arg` —
and the connection is the thunk's to read off the session, not the caller's to
hand it. `tabId` in a thunk arg is the case that looks like this and is not: a
tab is the result's *destination* and the bridge has never heard of one, whereas
this is the target. Both rules survive; the marker carries it instead.

**`loadTables` has two markers for that reason, and `rejected` is unhandled.**
`tablesRequested` sets the spinner, `tablesFailed` carries the error. `rejected`
has the same hole `pending` does — `meta.arg` is the database and nothing else —
and it matters here in a way it does not for `loadColumns`, whose failure nothing
renders: without the connection in it, a slow failure on one server paints its
error under an identically-named database on another. A thunk keyed by an
argument must read what identifies its target, not trust current state.

Never call `Neutralino.extensions.dispatch` directly — you would lose the
`reqId` correlation and the reply would go nowhere.

`initBridge()` runs once in `main.tsx`, before render. Calls made before the
extension is up simply wait; they do not vanish.

## Engine-agnostic

The UI knows two engine *names* and their default ports. It does not know
dialects, quoting, or catalogs — browsing a table names the table and lets the
extension write the SQL, quoted for whatever engine it turns out to be. Keep it
that way: if the UI ever needs an `if (type === 'mysql')` around SQL, the logic
belongs in a driver.

Highlighting is the live example. The session carries a `dialect` the extension
reported, and `EditorPane` hands it to Monaco without reading it — there is no
map from engine to grammar up here, because that map would be the second place
that has to know what MySQL is.

The one legitimate engine-specific bit is `ENGINES` in `common/db/engines.ts` —
label, default port, default user, and how the engine is *addressed*, and nothing
else. It sits in `common/db/` because both the connect form and the toolbar badge
need it, and a second copy is how the two drift apart.

`isFileBased` is the other one, and it is **re-exported from the protocol** rather
than answered here. A file engine (SQLite) has no host, port, user, password or
TLS, so three places up here ask: the connect form draws a path field with the OS
file dialog instead of the server block, `ConnectScreen` does not prompt for a
password it could never need, and `serverLabel` prints the path rather than `@:0`.

The re-export is the point. This table answered it alone at first, and the
extension's store asks the *same* question before it will resolve a saved
connection — so the two disagreed, and a SQLite connection the form saved
perfectly happily came back "does not store a password; one is needed to
connect". A predicate both sides of the bridge act on belongs to the contract,
not to the renderer's engine table. See `docs/decisions.md`.

## The window

The window is borderless and the titlebar is a React component, so `App.tsx`
renders `<Titlebar />` above the router rather than inside `Shell`: the window
needs a way to move, maximise and close whether or not a connection is open.

`useWindowChrome` is the whole surface, and five things in it are load-bearing
while looking like none:

- `setSize({ resizable: true })` at startup is what keeps **Aero Snap and edge
  resize alive**. Borderless clears `WS_THICKFRAME`, and Windows will not snap a
  window it thinks cannot be resized. Deleting this "no-op" costs snap.
- **The pixel-out-and-back `setSize` pair right after it is not a tic.** The
  frame that call re-adds insets the client area by 7px a side, but the webview
  child keeps the full-window size it was created at, so the right and bottom
  ~14px of the app — the close button, the status bar — sit clipped behind the
  frame until a real resize makes Neutralino refit it. Only an actual size
  change triggers that refit, so startup causes one and puts it back. Both
  calls keep `resizable` on, or they would drop the very bit the first call
  exists to set.
- Dragging starts after 4px of travel, **not** on pointerdown, which is why
  double-click-to-maximise works.
- `window.matchFrame` asks the extension to paint the OS frame `--bg`, because
  keeping the frame means Windows draws 7px of it above the titlebar and no
  webview can paint there. It sends `NL_PID` (the extension is spawned through a
  shell, so it cannot find the window itself) and the `--bg` token (so the colour
  is written once).
- `window.fitMaximized` fires from `sync` whenever the window is observed
  maximised, because Windows maximises a caption-less window over the whole
  monitor: taskbar covered, and the outer ~7px — the close button, the status
  bar — pushed offscreen. The extension clamps it so the *content* lands on the
  work area (the window overshoots by its invisible frame, as a captioned
  maximise would). It hangs off `sync` rather than off the button so the OS's
  own gestures (snap-to-top, Win+Up) are covered too; the extension no-ops on
  an already-fitted window, which is what keeps the resize it causes from
  looping.

Read the `decisions.md` entry before touching any of them; all three cost real
digging, and Neutralino's own `setDraggableRegion` is the wrong answer to the
second.

### The menus

`Menu` is one dropdown, drawn twice: **File** (Exit) and **About** (check for
updates, version, open app data). It takes its label as a prop rather than being
two components, because the only difference between them is the word and the list.

**Two menus side by side need no coordinator.** Each owns its own `open` state,
and pressing the other trigger lands outside this one's root — so the
`pointerdown` listener that already closes a menu on an outside click closes it in
the very gesture that opens its neighbour. Reaching for a shared "which menu is
open" state is the thing to resist: it is a second source for a fact each menu
already holds.

`useAbout` is the second hook in the app to call the bridge without a thunk, and
for `useWindowChrome`'s reason: `app.dataDir`'s answer is handed straight to
`Neutralino.os.open` and kept nowhere, and a folder that will not open has nothing
to say. `version` is `__APP_VERSION__` — the same build-time constant
`update.check` is compared against, so the number the dialog shows and the number
the release check uses cannot drift.

`AboutDialog` is the app's third modal, after `ReadOnlyConfirm` and
`DropTableConfirm`, and the first that asks for nothing: it states the version and
closes. It renders inside the titlebar's `<header>`, which is fine because `Modal`
is `position: fixed` — the header is where it is *owned*, not where it is drawn.

## The status bar

`features/statusbar` is the bar under the shell. It carries two facts about the
**active** connection: a lock showing whether it is read-only (and toggling it),
and the name of its **environment**. Both are here rather than in the editor's
toolbar because that toolbar is per-tab and hidden on a grid tab, while these are
facts about the whole connection that have to be visible on every tab. The
environment reads as plain grayscale text: it used to be the rail's colour, but
the rail's colour is each connection's own now, so the environment moved here as
a word.
It reads `useSession` only and owns its own modal, so it imports no sibling
feature -- `Shell` stacks the connection rail, the `.app` grid, and this bar in a
column, so the rail spans the full width on top and the status bar spans it
beneath, each a fact about the whole shell rather than one pane.

Locking is immediate; **unlocking opens the app's one modal**, `ReadOnlyConfirm`,
which asks the connection's environment name typed back before it will turn
read-only off. It was the first overlay in the app, and the pattern it set is what
`DropTableConfirm` and `AboutDialog` follow -- see
`design-system.md` for why it is allowed to float and `decisions.md` for why the
friction is worth it and uniform across environments.

`matchFrame` is also the one bridge call in the app that does not go through a
thunk. A thunk exists to land a result in a slice and put a failure on screen;
this has no result to keep and nothing to say when the platform declines, so a
slice for it would hold nothing.

## The updater

`features/updater` is a dismissible strip under the titlebar. The whole flow is
user-initiated: `App.tsx` fires one launch check (`useUpdater().check()`) and it
is silent by design — a check that finds nothing, or cannot reach GitHub, renders
nothing. Only a *manual* check from the menu speaks when it finds nothing, and it
draws two different answers: "You're on the latest version" when it genuinely
reached the releases and found nothing newer (`checked: true`), and "Couldn't
check for updates" when it could not reach them at all (`checked: false`). Those
are not the same answer, and reporting the second as the first is a quiet lie —
the launch check still stays silent for both.

Three things about the wiring are load-bearing:

- **The `updater` slice is a slice because it crossed the bridge.** The release
  check and the download progress both come from the extension — that is the whole
  rule. The one feature-local scrap, whether the banner was dismissed, lives in it
  too rather than in a second place to keep in step, the amendment tabs already
  set: the bridge test decides slice-vs-context, not store-vs-nowhere.
- **The "Check for updates" menu item is wired in the composition root, not by
  the titlebar.** A feature never imports a sibling, so `App` passes the updater's
  check action into `Titlebar` as `onCheckForUpdates` — the same shape as anything
  spanning two features being wired above them. It sits in the About menu, but
  where an item is *drawn* does not change whose it is: the titlebar owns its own
  items (exit, version, open app data) and takes this one in.
- **Download progress is a broadcast, heard in `main.tsx`.** It is not a reply to
  any `reqId` — a download outlasts a single `call` — so `main.tsx` subscribes to
  `UPDATE_PROGRESS_EVENT` and dispatches `progressReceived`, while the
  `update.download` thunk resolves separately when the download is staged and
  verified. That thunk carries a generous timeout, because a download outlasts the
  bridge's default.

`__APP_VERSION__` is the running version, injected by Vite from the root
package.json (see `vite.config.ts`) and passed to `update.check`. It is a
build-time constant, not a runtime lookup: the compiled extension has no config to
read a version from, and the value is fixed the moment the frontend is built.

## Neutralino types

`src/neutralino.d.ts` declares the small surface actually used. The client is
loaded by a `<script>` tag in `index.html`, so it only exists as a global.

`neu update` does download a full `neutralino.d.ts`, but it lands in
`public/js/` — gitignored, fetched at install, and shaped as a module. Depending
on it would make the typecheck fail on a fresh clone before `bun install`.

## Conventions

- Loading, error and empty states for a *query* are all rendered by
  `ResultsTable`; keep them there rather than scattering conditionals.
- An error renders where its action was taken. A query error belongs to the
  results pane *of the tab that ran it*; a "could not list tables" error belongs
  in the tree, not in a pane about query results.
- **One place names a thing.** The rail names the connection (under its
  workspace's heading); the titlebar names the server the active one is on; the
  sidebar's picker names the database. Three facts, three places, and none repeats
  another — the rail says which, the titlebar says what. Printing one twice is how
  the two drift apart. The **environment** is the deliberate exception: it is a
  glanceable abbreviation on the chip (`Dev.`, `Prod.`) *and* the full word in the
  status bar for the active connection — two resolutions of one fact, the way the
  rail's name and the titlebar's `user@host:port` are, not one label printed
  twice.
- `NULL` renders as an italic muted token, never as an empty cell or the string
  `"null"` — telling them apart is the whole point in a SQL client.
- **The pager appears only when there is somewhere to go** — a next page, or a
  previous one. A table that fits on a single page shows none, because two dead
  buttons announce paging about the one case that has none. A query's result
  never shows one at all: the extension will not rewrite your SQL to page it.
- **Browsed rows are numbered from the page's offset**, not from 1. A gutter
  counting 1…100 on every page gives two different rows the same name.
- Ctrl/⌘+Enter runs, from anywhere in the window (a `window` keydown listener),
  matching every other SQL tool. On a grid tab it does nothing: there is no query
  there to run.
- **A tab binds to a connection for life, and to a database by the picker.** The
  connection is fixed at open time and nothing changes it: moving the rail
  switches which tabs you are *looking at*, never what any of them points at. The
  picker moves the active tab's database alone.
  Switching database to check one thing must never drag every other tab with it.
  A grid tab is "this table, wherever I am pointed", so moving it re-browses the
  same name in the new database — and says so in that tab's own grid when the
  table does not live there.
- **Clicking a table always opens a new tab**, deliberately not deduped: opening
  one table twice is how you compare it before and after a write.
- **A tree row is a chevron plus a name, not one button.** The chevron reveals
  the table's columns in place — name, type, and a key mark on the primary key —
  and the name still browses. Two buttons because a `<button>` cannot hold one,
  the tab strip's structure exactly. The columns come from `loadColumns`, the same
  thunk and cache the completion fills, so expanding a table the editor already
  completed against costs nothing. **Which rows are open is component state**: it
  never crossed the bridge, so it lives in `Sidebar`, not a slice — and
  `useExplorer` grew `columnsFor`/`loadTableColumns` as the surface onto that
  shared cache.
- **The tree's filter matches names only, and hides rows and nothing else.**
  Ordering, tables-above-views, which rows are expanded and the context menu all
  behave exactly as they do unfiltered. It deliberately does not match columns:
  those are fetched lazily per expanded table, so matching them would find hits
  in whatever you happen to have open and silently miss every table you do not —
  a filter whose answer depends on what you expanded earlier. A filter that
  matches nothing says *No matches*, which is a different fact from a database
  with *No tables* and reads as one.
- **Tables sort above views in the tree.** A stable sort in `Sidebar` keeps the
  server's within-group order (by name); no heading, since the view icon already
  tells the two kinds apart. It is a presentation decision, so it lives in the UI
  and not in a driver's `ORDER BY` — the extension stays engine-agnostic about how
  the tree reads. Grouped, "above" is per schema: the sort is unchanged and the
  groups are what it happens inside.
- **The tree groups by schema, and that is a preference rather than a fact about
  a server.** It is on by default, toggled from a control in the sidebar's own
  filter bar, and remembered globally in the `settings` slice — a preference you
  have to leave the tree to change is one nobody finds, and Settings does not
  exist yet. Which groups have been opened or shut is `Sidebar` state, like which
  rows are expanded: it never crossed.

  **The default schema leads, and it is the only group that starts open.** A
  dozen schemas all open cost exactly the scroll grouping exists to remove, and
  the group holding the tables being worked on should not sit below several that
  open onto nothing. Which schema that is comes from the session's
  `defaultSchema` — the UI still does not know what `public` is.

  The state is which groups have been **flipped away from that default**, not
  which are collapsed. A set of collapsed names has to be seeded, and there is
  nothing to seed it from until the tables land — a different moment per
  database, per connection, and always after the first render. Flipping is keyed
  by schema name and outlives a database change, the same as row expansion.

  **A filter reveals every group it matched in.** The groups are built from the
  filtered list, so a group drawn at all has a hit inside it — and with the other
  schemas shut, a heading sitting closed over a match would read as "nothing
  found" about a search that found something. It is derived from the filter
  rather than written into the flip state, so clearing the filter returns the
  tree to the shape the user chose.

  Three more things fall out, and each was found rather than designed:

  - **Whether to group at all is read off the data, not off the engine.** MySQL
    reports no schema on any relation, so there is nothing to group by, no
    heading is drawn and the toggle is absent — a control that could only ever do
    nothing is not shown disabled. The UI still does not know what MySQL is; it
    knows whether these relations name a schema, which is the question anyway.
  - **A key and a label are different strings, and they part on the default
    schema.** `relationName` always qualifies (`public.users`) and is what caches,
    tab ids and expansion state are keyed by — two schemas may each hold a
    `users`, and a key that dropped the common one would file both under one
    entry. `relationLabel` leaves off whatever the session's `defaultSchema` says
    goes without saying, and that is what the tree prints, what a tab is titled,
    and what *Copy name* copies. Print the key and every ordinary Postgres row
    shouts `public.`; key by the label and two tables silently share a cache
    entry. **The editor completion is the deliberate exception** — it offers a
    default-schema relation *both* qualified and bare (`public.users` and
    `users`, either of which resolves) and a relation in any other schema only
    qualified, so its flat list can name a schema the way the tree's headings do
    without hiding the bare form the reader may prefer. See the completion section.
  - **The completion resolves a typed name against the catalog** (`resolveRelation`),
    rather than being the one caller that files columns under a bare name. It
    scans `users` out of a `FROM` and the tree fetched `public.users`; without the
    lookup those are two entries, so expanding a row in the tree would stop
    warming the popup — and the popup's own fetch is deduped by that same key, so
    the miss would be permanent rather than a slow first answer.
- **Right-clicking a tree row opens its context menu**, the surface the per-table
  actions hang off rather than each growing a button. It works on a view too (a
  relation with a name to copy, a definition to show and a `DROP` to run), and its
  labels follow the kind (`Drop view`). Which table it is on and where it was
  summoned is `Sidebar` state — it never crossed the bridge. Drop is disabled on a
  read-only connection: read-only is the server refusing writes, but it does not
  reliably cover DDL, so honouring that intent for a `DROP` is the UI's to do. The
  drop itself is guarded by `DropTableConfirm`, the app's second typed-confirmation
  modal after `ReadOnlyConfirm`, and its failure renders in that modal — a drop the
  server refuses is news about the action just taken there.
- **A tab always opens on a database**, inherited from the active tab or falling
  back to the session's `defaultDatabase`. The empty state is the case that needs
  the fallback and the one that has no tab to inherit from — a tab pointed at
  nothing has an empty tree and nothing to run, and if the picker is disabled
  too, the only way out of the app's own empty state is to reconnect.
- **Starring a table lifts it into a "Starred" group at the top, out of the list
  below rather than repeated in it.** Starred and unstarred are computed once
  from the same sorted, filtered list (`pinned`/`unpinned` in `Sidebar`), so both
  keep the tables-above-views order the sort already established, and every
  schema group renders `unpinned` rather than the whole list. Toggled from the
  context menu (`Star`/`Unstar`, reading the current state off `isStarred`), not
  from a button on the row — one more control on every row is the thing the
  context menu already exists to avoid.
  Stars are fetched once per **connection**, not per database: `useExplorer`'s
  effect keys on `connectionId` alone, and `loadStars`' own cache (keyed the same
  connection-first way `tables` and `columns` are) is what keeps a connection
  already fetched off the bridge on every database switch. They persist in the
  extension's store, keyed by the *saved* connection — see `docs/extension.md` and
  `docs/decisions.md` for why the runtime `connectionId` cannot be the key.
- **The sidebar and the results panel are resizable, and neither survives a
  reload.** `Shell` holds `sidebarWidth` (a grid column, `1fr` beside it going to
  the tab strip and editor) and `resultsHeight` (a grid row; the editor above it
  is the `1fr`), both dragged through `<ResizeHandle>`. Bridge test again: a
  panel's size never crossed, so it is component state and not a setting. The
  sidebar's handle is not rendered while collapsed — there is nothing to drag a
  28px rail wider into — and the results handle only exists on an editor tab,
  since a grid tab's pane is the whole space below the strip and has no split to
  drag. `resultsHeight`'s clamp reads `window.innerHeight` at drag time rather
  than being pinned once, so a window resized between drags does not leave the
  editor's `minmax` fighting a stale ceiling.
