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
  db/                   the UI's engine table
  shortcuts.ts          every keyboard shortcut, and the one spelling of a chord
src/store/              every slice; bridge-crossed state and the keys it is held under
  index.ts              configureStore + RootState/AppDispatch
  hooks.ts              useAppDispatch / useAppSelector
  thunk.ts              createAppThunk + errorMessage
  sessionSlice.ts       every open connection, and which is in front + useSession()
  tabsSlice.ts          what is open, and what each one is pointed at + useTabs()
  workspacesSlice.ts    the workspace list
  environmentsSlice.ts  the environment picklist + useEnvironments()
  savedSlice.ts         the stored connection list
  savedQueriesSlice.ts  the kept statements, and which tabs have drifted from theirs + useSavedQueries()
  transferSlice.ts      exporting and importing the saved connections + useConnectionTransfer()
  connectionTestSlice.ts  what the connect form reached, without keeping it + useConnectionTest()
  awsSignInSlice.ts     what each AWS profile can currently do, and the sign-in that fixes it + useAwsSignIn()
  explorerSlice.ts      the catalog: databases, their tables, their columns
  resultsSlice.ts       the result grid, keyed by tab
  updaterSlice.ts       the release check, download progress + useUpdater()
  settingsSlice.ts      the user's preferences + useBooleanSetting()
src/features/
  connections/          ConnectScreen, ConnectionForm, SavedConnectionList,
                        WorkspacePicker, WorkspaceForm, PasswordPrompt,
                        AwsSignIn (AwsSignInButton + AwsSignInStatus),
                        useSavedConnections, useWorkspaces
  titlebar/             Titlebar, Menu, AboutDialog, EnvironmentsDialog, ShortcutsDialog,
                        ExportConnectionsDialog + ImportConnectionsDialog,
                        useAbout, useWindowChrome
  rail/                 ConnectionRail: the open connections, the way between, and Disconnect
  tabs/                 TabStrip: the strip, its menu, and its drag; CloseTabsConfirm
  explorer/             Sidebar, DropTableConfirm, useExplorer
  queries/              SavedQueriesButton (the strip's picker), SaveQueryDialog
  editor/               EditorPane, useEditor (text surface over the tabs slice), monaco (theme + worker),
                        completion + keywords + sqlScope + useSqlCompletion,
                        format + useSqlFormatter
  results/              ResultsTable, StatementTabs, FilterBar, JsonCellDrawer,
                        ResultsContext (useResultsView), useResults
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
| open connections: id, `savedConnectionId`, config, `dialect`, `name`, `workspaceId`, `color`, `environment`, `readOnly`, `lostReason` | `session` slice | crossed |
| `connectingPhase`, and `awsCredentialsFailed` derived from it at rejection | `session` slice | crossed |
| `order`, `activeConnectionId` | `session` slice | never left, but see above |
| a tab's `connectionId`, `table`, and `sqlByTab` (editor text) | `tabs` slice | crossed |
| `database`, per connection | `tabs` slice | crossed |
| `tabs`, `activeTabId`, `secondaryActiveTabId`, `kind`, `pane`, `title`, a grid tab's `filter` seed, an editor tab's `savedQueryId` | `tabs` slice | never left, but see above |
| `databases`, `tables`, `columns`, `stars` | `explorer` slice | crossed |
| `result`, query error, `running`, `browse` (with its `keyColumns` and the `filter` the page was fetched with), the `sql` the result came from, per statement, per tab | `results` slice | crossed |
| which of a tab's statements is on screen, and how many the run held | `results` slice | never left, but it is the key its results are held under |
| staged cell edits + row deletes, per tab (+ `saving`, `saveError`) | `results` context | never left, until Save |
| the filter *draft*, and whether the bar is open, per tab | `results` context | never left, until Apply |
| where the result grid is scrolled to, per tab | `results` context (a ref) | never left, and a restored session refetches its rows |
| saved connections | `saved` slice | crossed |
| saved queries | `savedQueries` slice | crossed |
| whether closing a tab would destroy text (`unsaved`) | `tabs` slice | never left, but it is a fact about a tab, and tabs live here |
| which tabs a close is waiting to be confirmed for | `Shell` local state | never left, and is gone either way the dialog is answered |
| the version a *Test* reached, and why one failed | `connectionTest` slice | crossed |
| what the last connections export wrote or import merged, as counts | `transfer` slice | crossed |
| whether an export was ticked to include passwords | `ExportConnectionsDialog` local state | never left |
| which AWS profile was signed in, why one failed, the CLI's `prompt`, and what each AWS profile can currently do | `awsSignIn` slice | crossed |
| workspaces | `workspaces` slice | crossed |
| environments (the picklist, not any connection's own) | `environments` slice | crossed |
| the release check, download `progress`, banner `dismissed` | `updater` slice | crossed |
| every stored preference, and whether the launch read has landed | `settings` slice | crossed |
| the keyboard shortcut overrides (one JSON value in `settings`) | `settings` slice | crossed |
| which shortcut is being recorded, and the chord that was refused | `ShortcutsDialog` local state | never left |
| `adding` (the connect screen, with connections open) | `App` local state | never left |
| which connect screen is showing, and which workspace it is inside | `ConnectScreen` local state | never left |
| `maximized`, the open menu | `titlebar` local state | never left |
| which tree rows are expanded, which schema groups are collapsed, and the tree's filter text | `Sidebar` local state | never left |
| the sidebar's width and the results panel's height, per pane | `Shell` local state | never left |
| the split's own width, which tab is being dragged, and which pane last held focus | `Shell` local state | never left |
| whether the colour picker is expanded, and whether a submit has already looked for missing fields | `ConnectionForm` local state | never left |
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

## A connection the server dropped

`OpenConnection.lostReason` is why the server is no longer on the other end, or
`null` while it is. It arrives on `CONNECTION_STATE_EVENT`, a broadcast rather
than a reply — the third of them, beside update progress and connect progress,
and the only one nobody asked for. `main.tsx` subscribes and dispatches
`connectionStateReceived`; see `docs/extension.md` for what the extension does
about it.

**A drop reduces to one field and nothing else.** The connection keeps its place
on the rail, its tabs, its tree and its results, because the extension reopens it
on the next command — reducing this the way `disconnect.fulfilled` does would
throw away everything the user had open over a blip they did not cause. A
connection already gone finds nothing and no-ops, the same as a read-only toggle
landing late.

**It shows in two places and both are deliberately quiet.** The status bar says
`Connection dropped — reconnects on the next query` in `AMBER`, not `RED`:
nothing has failed and there is nothing to do. The only reason to say it at all
is that a query taking an extra beat to reopen should not read as a slow
database. The rail marks the chip with a small amber dot rather than recolouring
it — the chip already spends its colour on *which* connection this is, and
repainting it would read as "different server" rather than "same server,
dropped". There is no Reconnect button, because there is nothing for it to do
that the next query does not.

## Session restore

Connecting to a saved connection reopens the tabs and queries it had open last
time — shape restored from the extension's store, contents refetched. Launch still
lands on the connections list; nothing auto-connects.

**The shape is a `SessionSnapshot`** (`store/sessionSnapshot.ts`) — the tabs
(kind, table/schema, title, editor `sql`, grid `filter`), which one was active by
position, `nextQueryNo` and `database`, the connection's own rather than any
tab's. It leaves out runtime tab ids, which are minted fresh every session. It
lives in its own file, not in a slice, because both slices touch it and
importing a runtime value between them would close a cycle — `tabsSlice`
already imports `sessionSlice` for its matchers.

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

**Every close comes through `Shell`, because a close can be refused.**
`closeIdsFor(intent)` in `useTabs` turns a gesture — `one`, `others`, `right`,
`all` — into the ids it would take, and `closeTabs(ids)` is what finally
dispatches. The two are separate calls precisely so something can happen in
between: `Shell.requestClose` resolves the set, and if any tab in it holds
unsaved text it puts up `CloseTabsConfirm` instead of closing. One resolver
means the tabs that were counted are exactly the tabs that go.

The × in the strip, all four menu items and `Ctrl+W` are all wired to that one
function. Guarding the close inside `TabStrip` instead would leave the shortcut
destroying text silently, and the two would drift the first time a third way to
close arrived — which is exactly the history this section already records for
"close others".

**What the dialog asks about is `Tab.unsaved`, and one dialog covers the whole
gesture.** Cancel closes nothing at all; a set with nothing unsaved in it closes
with no dialog, which is every grid tab, every untouched definition tab and every
empty `Query N`. Two buttons and not three: *Save* would mean Ctrl+S, which for a
tab that came from nowhere opens the name dialog — a dialog summoned by a dialog,
and most of the tabs this asks about are exactly that kind.

**Closing takes a set, and closing one is the set of one.** `tabsClosed({ ids })`
is the only close action there is. "Close others" is not a loop over a
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
copy is a new tab of the same kind; a grid tab re-browses its table and an
editor tab is seeded from `peekSql`, at birth, the same inbound-write seam a
definition tab uses. It spans tabs, the editor and the results, so it is the
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

**The strip scrolls to whatever tab is now in front.** A tab arriving — `+`, a
table, a definition, a duplicate, a saved query, a tab docked from the other
pane — is appended and made active, so on a strip that already overflows it is
born off screen and the gesture opens something nobody can see. A layout effect
on `(activeTabId, tabs.length)` reveals it; the count sits beside the id because
a tab can arrive without changing which one is active. **Revealing the *last*
tab means the strip's very end, not `scrollIntoView`**, which stops as soon as
the tab fits and so parks it against the right edge with the `+` beyond it still
hidden — a strip that visibly stopped short of the end it was asked for.
`scrollLeft = scrollWidth` is the whole of it, and it clamps itself on a strip
that does not overflow. A reorder changes neither the active tab nor the count,
which is why a drop reveals its tab through a separate keyed effect — see *Split
the editor*.

## Split the editor

A tab dragged to the right edge of the content area docks into a second pane —
its own strip, editor and result grid, independent of the first. VS Code's
split-editor shape: **exactly two panes**, horizontal only, and a pane
disappears the moment its last tab leaves it, the survivor taking over the
whole view.

**The split rides in the session snapshot**, so a connection reopens divided
the way it was left — `pane` per tab and `secondaryActiveIndex` beside
`activeIndex`. It shipped session-only, on the reading that a split is a view
preference like the sidebar's width; that was wrong in a way only using it
shows, because which tabs are *beside* each other is part of what you had
open, not part of how wide it was. See `docs/decisions.md`. A snapshot written
before the split existed carries no `pane` at all, which reads as "all
primary" and reopens exactly as it used to — the whole of what makes the
change backwards-compatible. Each pane's front tab is resolved against its own
tabs, so an index naming a tab in the other pane falls back to that pane's
last rather than pointing it at something it does not contain.

**`Tab.pane` is the whole of where a tab lives, and `tabsSlice` gained one more
pointer to match it.** `activeTabId` keeps its exact pre-split meaning — the
primary pane's active tab, which is still what every existing reader (session
restore, Ctrl+S, the database-change re-browse) means by "the" active tab —
and `secondaryActiveTabId` is the same shape for the second pane, `null`
whenever there is none. **Whether a split exists is derived, never stored**:
it is `secondaryActiveTabId[connectionId] !== null`, not a flag that could
disagree with the tabs actually carrying `pane: 'secondary'`. New tabs (`+`,
opening a table, a definition, duplicate, a saved query) always mint into the
primary pane — a tab only ever reaches the secondary one by being *moved* there,
which is also why the secondary strip has no `+` or bookmark button of its own.
There are two gestures for that move and one action behind them: dragging, and
the *Move tab to the other pane* shortcut (see *Keyboard shortcuts*).

**`tabMoved` docks as well as reorders**, on one more optional field: `pane`,
given, reassigns `Tab.pane` before the reorder runs; omitted, it is the exact
same-pane reorder it always was, scoped to `moving.pane` rather than to the
whole connection now that a connection can have two strips. Dropping a tab
onto *either* strip — the one it came from or the other one — goes through
this single action: dropping "before" a tab in the other pane's strip is what
both docks a fresh tab into an unsplit view (`beforeId: null` onto a strip
with nothing in the second pane yet) and moves a tab back out again (dragging
the secondary pane's only tab onto the primary strip empties the secondary
pane, which is the collapse). No separate "undock" action exists because
none is needed.

**Losing the active tab of a pane picks its own neighbour**, the same
left-else-right-else-nothing rule `tabsClosed` already used, just scoped by
`(connectionId, pane)` instead of by connection alone — a tab closing in the
secondary pane must never hand the primary pane a new active tab. **A helper,
`promoteIfPrimaryEmpty`, runs after every close and every move**: if the
primary pane is left with nothing while the secondary pane still holds a tab,
every `pane: 'secondary'` tab of that connection is relabelled `'primary'` and
the pointers swap. This is what makes "close the tab you were comparing
against" read as *the split ending*, not as an empty pane sitting beside a
full one — and it is one pass, not a case duplicated at every call site that
could leave primary empty.

**"Which tabs are there" split into two questions, and conflating them shipped
a blank editor.** `selectTabs` is a *strip's* list and is the primary pane's
alone; `selectConnectionTabs` is every tab of the connection, both panes, and
is what anything cleaning up per-tab resources has to ask. `EditorPane`'s
model GC is the caller that found it out: keyed on the primary list, the
secondary pane's brand-new Monaco instance disposed the model it had just
created — the tab it was showing was not in the *other* pane's strip — and the
pane came up blank with a live editor over a dead model. **A tab dragged into
the other pane has not gone anywhere**, and only a tab that has left the
connection entirely may take its model with it. The cost of the wider list,
accepted: a pane keeps a model for a tab that has moved away, which the
inbound-write effect goes on keeping in sync for nothing. It is one model per
tab per pane it has ever shown, and it is freed when the tab really closes.

**A tab's drag payload is a custom MIME type, not `text/plain`.** Nothing ever
reads it back — the dragged id travels as React state, which is what lets the
UI suite drive a drag with plain `MouseEvent`s carrying no `dataTransfer` at
all — but something has to be set for the browser to start a drag, and the type
it is set *under* turned out to matter: **Monaco accepts a `text/plain` drop
and inserts it**, so dragging a tab across the editor pasted the tab's id into
the query. `application/x-squeal-tab` is a type nothing else claims, so every
text surface in the app — Monaco, every `<input>` — is offered nothing it knows
how to take. Fixing it at the payload rather than at Monaco's `dropIntoEditor`
option is what makes it true of the whole app instead of the one place it was
noticed.

**The split is stored as the primary pane's *share*, not its pixels.** The two
panes are `flex-grow: fraction` against a zero basis, so the ratio is what the
layout is told and the pixels fall out of it; `dragSplit` converts a drag's px
delta into a fraction of the measured container. A px width was the first cut
and it was wrong twice over. It defaults badly — one constant is about half of
a small window and a quarter of a wide one, so "even" depended on the machine
it was written on — and, the half that survived a first fix, **it does not
survive a resize**: the primary pane keeps its pixels while the secondary,
taking whatever is left, absorbs every pixel the window gains, so maximising a
50/50 split lands near 25/75. A fraction fixes both at once, and `0.5` needs no
measuring to mean half.

**A pane's whole body is a drop target, not just its 32px strip.** The strip is
a ribbon and the thing being aimed at is the pane, so each pane draws a
`TabDropZone` over its body while a tab from the *other* pane is in flight —
and while there is no split yet, the primary pane's trailing half is the zone
that opens one. Every one of them lands in the same `moveTab(id, null, pane)`
the strips already use. Three things they deliberately do: they start below the
strip (`top: TAB_H`), or they would swallow the `dragover` that draws the
insertion mark saying *where among the tabs* it lands; a pane offers none for a
tab it already holds, since "move it here" where it already is would only
shuffle it to the end of its own strip; and **they carry a `z-index`**, because
the result grid's sticky header and row gutter carry `z-index: 1`/`2` and a
positioned element with none of its own paints *below* those however late it
comes in the DOM — which shipped as a zone that was live over the rows and dead
over the header, the exact strip of the pane a tab is most likely dragged onto.

**The tab strip scrolls itself while a tab is dragged near either end.**
Without it a strip holding more tabs than fit cannot be dragged *into* the part
scrolled out of view, and a tab dropped past the right edge lands somewhere
nobody can see — the drag ends with the tab apparently gone. `dragover` fires
repeatedly for as long as the pointer is over the strip, so holding still at
the edge keeps it moving and there is no interval to start or to clear. The
moved tab is then scrolled back into view in a layout effect keyed on its id —
not in the drop handler, where the tab is not yet where it is going, since the
move is the store's and the strip re-renders from it.

**Aiming at the end of the strip jumps it all the way there**, rather than
stepping like the edge scroll. The mark that says "this lands last" is drawn
*past* the final tab, so on an overflowing strip it is off screen exactly when
it is the thing being decided; the end position is the only one that shows it.
The edge auto-scroll cannot serve this — it moves a step per event, so the mark
would arrive several events after the intent did.

**Where a drop would land is the strip's question, worked out from geometry —
not a `dragover` on each tab.** `dropTargetAt(clientX)` walks the tab elements
and returns the first whose midpoint the pointer has not reached, else `null`
for the end. Per-tab handlers were the first cut and they answer for the tabs
only: **the strip is more than its tabs** — the `+`, and the empty space past
the last one, are most of what you cross on the way to "drop it last" — so all
of that kept whatever the last tab the pointer happened to touch had said. That
is an insertion mark pointing at a slot the drop is not aiming for, and a `drop`
that then honours it. One handler on the strip has no gaps to leave uncovered.

**The mark is cleared by two things `dragend` cannot cover.** It goes when the
pointer *leaves* the strip, or the strip a tab was dragged out of goes on
advertising a slot while the drop is being aimed at the other pane — and
`dragleave` bubbles from every tab, so crossing from one tab to its neighbour
fires it on the strip too and the **coordinates, not the event, are what say
whether the pointer really left**. And it goes when `draggingId` falls to
`null`, which is the ending `dragend` genuinely misses: a tab dragged into the
other pane is re-rendered by the *other* strip, so the element this one would
have heard `dragend` on is unmounted before it fires, and the mark stayed drawn
until the next drag. Watching the composition root's id catches every ending,
including that one; drawing the mark is gated on it for the same reason.

**`EditorPane` and `useResults` stopped assuming there is one active tab.**
Both used to read `selectActiveTab` (or `useTabs().activeTab`) internally;
both now take the tab they are for as an explicit prop/argument, and
`ShellLayout` calls each twice — once bound to the primary tab, once to the
secondary — the same way it always called them once. `ResultsTable`,
`StatementTabs` and `FilterBar` take the same `tab` prop and pass it straight
through to `useResults(tab)`. `TabStrip` went the same way for the same
reason: `tabs`, `activeTabId` and every handler are props now, not a
`useTabs()` call, because two mounted instances need two different subsets.
Its `draggingId` is a **controlled** prop rather than local state for a
sharper reason than the others — a drop has to be accepted by whichever strip
it lands on even when the drag started in the *other* one, and only
`ShellLayout`, which mounts both, can see both; each strip still owns
`dropAt` (where *it* would insert) locally, since that really is per-strip.

**Two Monaco instances broke an assumption `useSqlCompletion` never had to
question with one.** The completion provider is registered once per dialect
and reads a live snapshot through a ref — `docs/decisions.md` already warned
that two registrations on one language both answer and the popup holds every
suggestion twice, for the dialect-change case. A second `EditorPane` calling
the same hook is the identical failure wearing a different trigger: two
providers, one per pane, each closing over *that pane's* scanned tables, both
answering every request regardless of which editor asked. The fix is not a
guard, it is that the provider never needed the calling pane's scan at all —
`provideCompletionItems(model, position)` already receives the model Monaco is
asking about, so `completion.ts` scans **that** model directly instead of
trusting an outside snapshot. That makes the registration itself pane-independent,
so `useSqlCompletion` (registration) and `useSqlFormatter` are now called once,
in `ShellLayout`, regardless of split state; `EditorPane` keeps only
`useSqlPrefetch`, the per-pane half that warms the column cache ahead of a
`.` for *that* editor's own text — safe to call from both panes, since
`loadColumns`'s own cache dedupes a table either one already asked for.

**`window.squealEditor` stays singular on purpose, not by accident of there
being one instance any more.** It is the primary pane's, always — `EditorPane`
takes an `exposeGlobal` prop, `true` by default, `false` on the secondary
instance. The UI suite's existing seam is untouched; a second seam for driving
the secondary editor is future work, not something this shipped needing.

**The editor's own keybindings are `addAction`, not `addCommand`, and with two
panes that is the difference between working and not.** `addCommand` registers
its keybinding with **no `when` clause at all** — global to the window, not
scoped to the editor it was called on (it is right there in Monaco's
`standaloneCodeEditor.js`: `addDynamicKeybinding(id, kb, handler, undefined)`).
One editor never noticed. Two both bound Ctrl+Enter globally, one shadowed the
other, and every run went to whichever pane mounted last no matter where the
cursor was — reported as *Ctrl+Enter always runs tab 2*. `addAction` scopes its
keybinding with `editorId == <this editor>`, so each pane's binding fires only
when that pane is focused. It costs an `id` and a `label`, which also puts the
actions in Monaco's own command palette; that is a gain, not a cost.

**The window-level Ctrl+Enter/Ctrl+S fallback gained a `focused` gate.**
Monaco's own instance-level bindings need none — with `addAction` they only
fire for the focused editor, which is exactly right. The
`window` listener exists for focus that has left Monaco but is still in that
pane (the Run button, say), and without the gate both panes' listeners would
answer one keypress. `ShellLayout` tracks `focusedPane` and passes `focused`
down; `preventDefault` still runs in both listeners regardless of the gate,
since the OS save dialog Ctrl+S would otherwise summon is a webview-wide
problem, not a per-pane one.

**`focusedPane` is tracked on pointer-down as well as focus, and the pointer
half is what makes it right.** Focus alone looks sufficient and is not: most of
a pane is not focusable, so clicking its result grid, the blank part of its
filter bar or its own divider fires no focus event at all and leaves the gate
pointing at whichever pane was last *focused*. After working in one pane and
then clicking into the other, a Ctrl+Enter from outside Monaco then ran the
pane the user was no longer looking at — which is what "I ran a query in one
tab and got the results in the other" turned out to be. Both handlers are
capture-phase, so nothing inside a pane can swallow the signal first.

**The dock gesture is a drop zone, not a third drag action.** `TabStrip`'s
`onDragTab` reports the dragged id up to `ShellLayout`, which is what tells the
zones above when to appear; dropping on one calls `moveTab(id, null, pane)`,
the same action a strip drop uses. There is no separate "split" verb anywhere —
a split is what it looks like when a tab is in the pane that had none. The
keyboard's *Move tab to the other pane* is a third way into that same one
action, and it is why it is named for the move rather than for the split: with
one tab open it moves the tab out of a pane that then has nothing left, so
`promoteIfPrimaryEmpty` hands it straight back and nothing appears to happen —
which is exactly what dragging that same lone tab already does.

## Saved queries

Ctrl+S keeps the editor's text as a named query; the bookmark button at the right
of the strip opens one back into a tab. They are **global** — a query names no
connection, so `savedQueriesSlice` is not keyed by one and nothing clears it when
a connection opens or closes. See `docs/extension.md` for the store's side.

**`Tab.savedQueryId` is the whole mechanism.** A tab opened from a saved query is
born carrying the id it came from, so Ctrl+S on it writes over that row and asks
nothing; a tab that came from nowhere gets the dialog, once, and is linked by
`tabSaved` when it lands. That is the difference between Ctrl+S meaning *save*
and meaning *save another copy*, and it is one field.

**It rides in the session snapshot, and that is not an exception to "runtime ids
are left out".** The ids that are left out are the tab ids, minted fresh each
session; a saved query's id is the extension's and outlives every session, which
is exactly why the link can be written down. `tabSaved` therefore joins the
session-sync listener's watched actions, or a link would type-check and paint and
then not survive a restart — the same line `tabRenamed` already needed.

**Both halves are wired in `Shell`**, because both span more than one feature:
opening one mints a tab (tabs) and seeds it (editor) from a query (the slice),
and saving reads the active tab's text and links the tab back. `SavedQueriesButton`
takes `onOpen`; `EditorPane` takes `onSaveQuery`, which takes **no text** — the
handler reads the active tab's off the store, the same rule a thunk reads its own
target by.

**Two tabs on one saved query are two views of it, not two copies.** `tabSaved`
therefore writes the saved text, the name and a cleared mark into **every** tab
carrying that `savedQueryId`, not just the one that pressed the key — so saving
in one place is the query changing, and both tabs show it. `EditorPane`'s inbound
write is what carries that into the other tab's Monaco model; without it the
store and the model would disagree and the next keystroke there would write the
stale text back over the save.

*The cost, accepted:* a sibling tab holding edits of its own loses them to that
save. Two views of one query are last-write-wins, the way two editors over one
file are. The alternative is two tabs claiming to be the same query while showing
different text, which is what this replaced. See `docs/decisions.md`.

**The unsaved mark is `Tab.unsaved`, a flag about the tab — not a comparison
against the stored query.** It is the *only* feedback a silent save gives (the
dot going away is how a Ctrl+S that opened no dialog says it landed), so what it
claims has to be exactly right. Comparing `sqlByTab` against `query.sql` was the
first cut and it answered a different question: *this text is not what is on
disk* is a fact about the **query**, so it was true of every tab holding it —
which, before the tabs shared a save, lit the mark on copies the user had never
edited. Deleting the query lit it on all of them at once for the same reason.

**What it names is "closing this would destroy text that exists nowhere else",
which is wider than the saved queries this section is about.** Two shapes of that
and one field for both: a linked tab whose text has drifted from its query, and a
tab linked to nothing that has been typed into. The second is the one that
matters more and the one the narrower reading missed entirely — a `Query 1`
holding two hundred lines nobody ever saved is the tab whose close costs the
most, and it has no `savedQueryId` to have drifted from. `tabsClosed` deletes a
closed tab's `sqlByTab` entry and the session listener then writes a snapshot
without it, so that text is genuinely gone. See `docs/decisions.md`.

Four writes and no others: `sqlChanged` sets it — always for a linked tab, since
blanking a stored query is an edit like any other, and on non-empty text for an
unlinked one, so typing and deleting back to nothing leaves the tab clean again;
`tabSaved` clears it across the query's tabs; and `deleteSavedQuery.fulfilled`
**raises** it while dropping the link, because losing the stored row is the moment
that text stops being backed by anything. It rides in the session snapshot as a
boolean, so a tab left mid-edit comes back saying so.

**Which is what makes seeding at birth load-bearing rather than tidy.**
`tabOpened` carries an optional `sql`, and every tab born holding generated text
uses it: the three definition tabs and *Duplicate*, alongside the saved-query
open that had it first. Seeding through a `setSql` instead would mark them —
every DDL you glance at would ask to be saved on the way out, about text the tree
regenerates on demand. `openEditorTab(title?, sql?)` is the seam, and it writes
the seed for a `Query N` as well as for a named tab; writing it only on the named
branch shipped a *Duplicate* that came up blank, since a copy is the unnamed one
carrying text.

A consequence worth stating plainly: **`Shell` no longer writes into the editor at
all.** Every inbound seed rides `tabOpened`, so the composition root reads text
(`peekSql`) and never sets it. `setSql` has exactly one caller left, `EditorPane`,
which is the user typing — which is precisely what should mark a tab.

**A save clears the mark when it *lands*, not when the key is pressed.** `Shell`
clears it in the thunk's `.then`, so a write the extension refuses leaves the tab
still claiming it holds edits — which it does. Nothing else renders that failure:
the mark staying put is the report.

**Opening a saved query is one action, `openSavedQueryTab`.** Not
`openEditorTab` followed by `setSql`: a `sqlChanged` is what marks a tab edited,
so seeding through one would light the mark on a tab nobody has touched at the
instant it appears. `tabOpened` carries the `sql` and the reducer writes it.

**A deleted query releases its tabs rather than leaving them pointing at
nothing.** `tabsSlice` clears `savedQueryId` on `deleteSavedQuery.fulfilled`, so
the link never rides into a snapshot naming a row that is gone and no reader has
to keep asking whether it still resolves. The tab keeps its title and its text —
what was deleted is the stored copy, not the query you are looking at — and its
next Ctrl+S asks for a name.

**A link whose query has been deleted falls back to the dialog** rather than
re-creating the row: the extension refuses a save under a vanished id, and the
honest reading of a deleted query is that this tab came from nowhere again.
`Shell` resolves the link against the list it already holds, so it takes that
branch without a round trip — and since the reducer above has already cleared the
link, that branch is the only one left to take.

**The dot occupies the close button's slot and gives it back on hover.** VS
Code's idiom, and it earns its place twice: the mark costs no width of its own
beside the label, and the control it stands in for is one pointer-move away
rather than gone. The swap is keyed on hovering **that button**, not the tab — at
tab level the dot would vanish the instant the pointer touched the tab anywhere,
which is most of the time you are looking at it. An unsaved tab's slot is always
shown, active or not, unlike a plain close: the dot is a *state*, not an action
offered on hover.

Two smaller things, and each was found by looking:

- **The button is a sibling of `TabStrip`, not a control inside it.** The strip
  scrolls horizontally once there are more tabs than fit, and a control inside it
  would scroll away with them — so `Shell` puts the two in one flex row and the
  strip takes `flex: 1`.
- **Save is bound twice, like Run, and the window half prevents Ctrl+S on *every*
  tab kind — and whatever Save is currently bound to.** A grid tab has nothing to
  save, but letting the key through there hands the webview its own "save this
  page" dialog over the app, and that dialog belongs to the key rather than to
  this shortcut. Monaco's own binding covers the case where the editor has focus,
  which is most of them.

## The database is the connection's, not any one tab's

`tabsSlice.database` is one value per connection — `Record<connectionId, string
| null>` — set by the sidebar picker and read by every tab of that connection
alike. A tab used to carry its own `database`, set when it opened and changed
only while it was the one in front; that gave every tab isolation from a
database picked to check something else, but it read, in practice, as the
picker and the tree jumping to a different database every time you switched
tabs. Being connection-scoped is what makes that stop, and it is also what
answers the picker and the tree before any tab exists to ask on their behalf —
`useExplorer`'s `database` is `selectDatabase` alone, no per-tab override to
fall back from, and the picker's own disabled check has only one reason left to
grey it out: `databases.length === 0`.

**Picking a database is one action regardless of whether a tab is open.**
`Shell`'s `changeDatabase` always calls `setDatabase`, then re-browses the
active tab if it is a grid one — there is no longer an empty-state branch,
because `databaseChanged({ connectionId, database })` never needed a tab to
target. Clicking a table row needed nothing new either: `openGridTab` already
reads the connection off state rather than off a caller-supplied tab, so it
mints one whether or not one existed a moment ago.

**The tradeoff, accepted on purpose:** switching the database can now change
what another open tab's *next* query or browse targets, since there is only
one database to read at call time. A grid tab whose table does not exist under
the newly picked database is not protected from that — it re-browses and
surfaces the failure as its own error, the same as any other missing-table
browse. See `docs/decisions.md`.

## Running several statements

Running text that holds more than one statement runs **each of them separately,
in order**, and the results pane grows a numbered strip — *Result 1*, *Result 2*
— over the grid. One statement draws no strip at all, which is the whole of how
the ordinary case is unchanged.

It exists because neither engine could ever answer more than one question at a
time: Postgres takes a stacked run, executes it, and hands back only the last
statement's result; MySQL refuses one outright, since `multipleStatements` is off
in the driver and stays off. Splitting up here is what makes every statement's
answer reachable.

**`ResultsState` went plural, and the split is `TabResults`.** A tab now holds
`{ parts, active, statementCount, runSeq }`: `parts` is one `ResultsState` per
statement that ran, `active` is which one the pane is showing, `statementCount` is
what the run set out to do, and `runSeq` counts runs for the tab (see below).
Every rule that used to be about "the tab's result" is
unchanged and now about `parts[active]` — a browsed page is a list of one, and so
is a single statement.

**The splitter is `common/db/splitStatements.ts`, and it is a lexer, not a
scan.** `sqlScope.ts` is allowed to be a loose regex because a miss there costs a
suggestion; a miss here would tear a statement in half and send both pieces to a
server. So it walks string literals, quoted identifiers, line and block comments
and Postgres' dollar-quoted bodies rather than pattern-matching around them, and
a semicolon inside any of those is not a terminator. It is the third thing in the
UI that reads `SqlDialect` for itself, beside `sql.ts`'s quoting and `format.ts`'s
language map, and for the same reason: how the text on screen is *spelled* is the
editor's business, while what SQL *means* stays the extension's. Nothing here
authors SQL — it only says where one statement the user typed ends.

**It reports where each statement sits, not only what it says.**
`statementSpans` is the pass that cuts, and `splitStatements` is its text view.
The offsets are produced by that pass because there is nothing to recover them
from afterwards: the same statement can appear twice in a tab, so searching the
text for one that came back as a string finds *a* position rather than *its*
position. `statementAt` is the one caller — see *Running the statement under the
cursor*.

**MySQL's `DELIMITER` is honoured, and it belongs here precisely because it is
not SQL.** The server has never heard of it — the `mysql` CLI consumes the line
and never sends it — so the client is the only thing that can act on it, which
after the split moved up here is this file. It is what makes a
`CREATE TRIGGER … BEGIN …; …; END` body reach the server whole rather than being
cut on its own semicolons, and the server does accept it: the semicolons are
inside a compound statement, so `multipleStatements: false` is no obstacle (there
is a test against the real MySQL for exactly that, and for stacking still being
refused beside it). It is recognised only at the head of a statement *and* the
head of a line — the CLI's own two guards, which is what keeps a column named
`delimiter` from being read as a command — and only on MySQL, since Postgres
dollar-quotes a body and SQLite has no routines to write.

Five things are load-bearing:

- **A slot exists because a statement ran.** `batchStarted` empties the list and
  records the count; `runQuery.pending` mints slot *i*. So a batch that stopped
  early ends with fewer tabs than statements, and `statementCount` is what lets
  the strip say `1 not run` rather than leaving the shortfall invisible.
- **The batch stops at the first failure, with no transaction around it.**
  Nothing after a rejected statement runs — carrying on would apply the rest of a
  migration on top of a step that did not take. Whatever already committed stays
  committed, exactly as running the statements by hand would leave it; wrapping
  the batch in a `BEGIN` would be this side authoring SQL the user did not write
  and rolling back work an earlier statement finished.
- **A failure selects itself.** `runQuery.rejected` moves `active` to its own
  slot, so the pane shows the statement that stopped the run rather than leaving
  the user on an earlier success wondering why it stopped. Every other landing
  result leaves `active` where it is, so a batch reads from *Result 1* in the
  order it was written.
- **`part` is a destination, exactly as `tabId` is.** It is which slot an answer
  belongs in and nothing the bridge hears about. That is what makes sorting one
  result re-run only *its* statement: `toggleSort` and the re-read after a Save
  both aim `runQuery` back at the slot the result already occupies. Re-running the
  tab's text would re-run an earlier `INSERT` or `DELETE`, which is not a cost
  worth paying for a different `ORDER BY`.
- **The statement index is part of the staging page key, and `runSeq` moved onto
  the tab.** The index is the same lesson the filter and the sort each taught that
  key already: two statements of one batch are two sets of rows under one tab id,
  so row 3 of one is not row 3 of the other. `runSeq` is the subtler half — it is
  what tells two runs of the *identical* text apart, so it counts on `TabResults`
  and survives `batchStarted`. Left per statement it would restart at zero with
  every batch, mint the same key twice, and carry the first run's staged edits
  onto the second run's rows, which is precisely what it exists to stop. The cost,
  accepted: clicking away from a half-edited result and back discards the staging,
  the same discard paging already makes.

**Running is the tab's state, not the shown result's.** `tabRunning` is true
while any statement of the batch is in flight, which is what *Run* is disabled on
and what the status bar times — the pane can be showing a finished *Result 1*
while *Result 2* is still going. That is also why *Cancel* has a second home in
the strip: the running pane's own Cancel is unreachable in exactly that case.

**The strip renders above every early return in `ResultsTable`**, beside
`FilterBar` and for its reason: a batch that failed on *Result 2* still has
*Result 1* to go back to, and the strip is the way. The two never draw together —
the filter is a grid tab's and two statements can only be an editor tab's.

## What names the rows on screen

`useResults` builds one string for *which rows these are*, `rowsKey`: a browsed
page is `table@offset@filter@sort`, and a hand query is
`query@statement@runSeq` — it has none of the first four, and `runSeq` is what
tells two runs of the identical text apart. **Its two readers are the two things
anchored to a row index**: the staged edits, and the grid's scroll offset. Rows
are positional and the server's order is not guaranteed stable between runs, so
anything holding a position has to stop meaning something the moment any of those
terms move.

**The grid comes back to where the tab left it.** There is one scrolling node per
pane and it shows whichever tab is in front, so a tab switch swaps the rows under
a node still holding the *other* tab's offset — clamped to the new content, which
is why a short table reads as "reset to the top" and a long one as a position
nobody scrolled to. `ResultsTable` writes the offset back itself, in a layout
effect keyed on `(tabId, rowsKey)`: **layout**, because an offset applied after
paint is a visible jump, and **keyed on those two alone**, because re-applying a
remembered offset on any other render would fight a wheel gesture already in
flight — a scroll event lands after the render that provoked it.

**A re-run starts at the top, and gets there through the key rather than through
a reset.** Running again, paging, filtering and sorting each mint a new
`rowsKey`, so what was remembered no longer matches and nothing is restored.
There is no clear-the-offset action to remember to dispatch, and so no way for
the two to disagree. Saving a browsed edit re-reads the *same* page and therefore
keeps its place, which is the whole point of the key naming the rows rather than
the fetch.

**It is a ref in `ResultsContext`, not state and not a slice.** Not a slice by
the bridge test — it has never crossed, and cannot: a restored session refetches
its rows, so there would be nothing for a snapshot to carry the offset against.
Not state because a scroll fires once a frame and nothing renders from it, so
state would re-render a pane per wheel tick to no effect. It is keyed by tab like
everything else there, and pruned in the same diff-the-list effect — in place,
since a ref has no setter.

## The editable grid

A browsed grid can be edited: change a cell, delete a row, copy selected rows as
TSV, and one **Save** issues the batch. It is offered in browse mode when the
extension gave the page a row identity (`browse.keyColumns`) *and* the
connection is not read-only — otherwise the grid stays read-only and the results
bar says why. `useResults` computes `editable`/`readOnlyReason` and is the whole
surface; `ResultsTable` and its context menu touch neither `dispatch` nor the
context directly, the same feature-hook rule as everywhere else.

**A hand-typed query is the second way in, gated on a different question.**
Browsing already knows its table; a query in `EditorPane` does not, so
`useResults.run` (via `runQuery` in `resultsSlice.ts`) scans the SQL for the
one table its `FROM` names (`detectSingleTable`, `common/db/`) and asks the
extension for that table's row identity alone (`db.tableKey`) — no paging, no
rewriting the statement, which still runs exactly as typed through `db.query`.
The table's key existing is not enough on its own: `queryEditable` in
`useResults` additionally checks that every key column the extension named is
actually present in `result.columns`, since a hand query, unlike a browsed
page, may not have selected it. Three outcomes, two different renders: the
key is there and the grid behaves exactly as a browsed table would; the table
has no key at all, same message as a keyless browsed table, shown unprompted
in the results bar (`readOnlyReason`) because it is a standing fact about the
table. The third — a real key that exists but was simply not selected — is
not: `missingKeyHint` carries that message separately and `readOnlyReason`
never includes it, because it is true only of *this* query and stating it
unprompted would read as the app scolding a result nobody meant to edit (an
aggregate, a report). `ResultsTable.startEdit` shows it only when a
double-click actually asks — a few seconds in the same slot `readOnlyReason`
would use, cleared by a timeout or by the next result. See `docs/decisions.md`
for why this replaced an earlier, narrower design that only recognised
`SELECT * FROM table` verbatim, and why the `db.tableKey` fetch rides inside
the same `runQuery` dispatch rather than a follow-up one.

**Neither paging nor the filter bar follow onto this path.** Both stay gated
on the tab being a `grid` tab (`gridTable`, `FilterBar`'s own early return),
so a hand query's grid never grows a pager or a `WHERE` builder — extending
either would mean the extension silently rewriting a statement it promised
to run as written. `Save` here re-runs the original SQL instead of
re-browsing a page, since there is no page to read back — and *original* is
meant literally: it re-runs `results[tabId].sql`, the statement the rows on
screen came from, not whatever the editor holds now. Copy-as-SQL and
FK navigation stay gated on `browse !== null` too, unchanged: they need a
`columnInfo` this path never fetches.

**Cells are selected as a rectangle, and cell and row selection are mutually
exclusive** — selecting either clears the other, both directions, so Ctrl+C
keeps meaning "copy what is selected" without asking which kind. `cells` is
component state in `ResultsTable`, beside `selected` (the row set) and reset by
the same effect on a new `result`.

**The range is two corners, not four edges.** `CellRange` is `{ anchor, focus }`
— where the selection began and where it currently reaches — because that is
what the gestures actually name: extending moves `focus` and leaves `anchor`
alone, which is the whole of shift-click, shift-drag and Shift+Arrow. The
rectangle is derived (`rangeBounds`) at the two places that need it, the render
and the copy. **A single selected cell is the 1×1 range**, both corners in one
place; there is no separate single-cell state, the same way a row selection of
one is a set of one.

Four gestures, all of them ones rows already use:

- **Click** selects one cell (editing still opens on double click, so nothing
  already free had to be rebound).
- **Shift-click** extends to the clicked cell.
- **Click and drag** sweeps a rectangle. The press only *arms* it — a press
  that never moves stays a plain click, so selecting one cell has exactly one
  path — and the first cell the cursor enters is what turns it into a range.
- **The arrow keys** move the focus, clamped to the grid's bounds, collapsing
  to 1×1; **Shift+Arrow** moves the focus and keeps the anchor.

Two things there are load-bearing:

- **The grid's cells are `userSelect: 'none'`**, which is what makes a drag
  select cells instead of sweeping the browser's own text selection across
  them. `CellEditor`'s wrapper opts back in: an input inheriting `none` cannot
  have its text selected, including by the `select()` the editor runs on open.
  See `docs/decisions.md` for the tradeoff.
- **A drag disarms on `mouseup` at the *window*, and on any `mouseenter` whose
  `buttons` is 0.** A release outside the window never reaches the listener, and
  a still-armed press turns the next stray hover into a selection.

Ctrl+C copies the rectangle as tab-separated text — cells on tabs, rows on
newlines, the shape "Copy row" already produces, so one paste target reads
either. It reads the *effective* value (staged edit if there is one, else the
original) rather than `copyRows`' raw row: a copy should match what is
highlighted on screen. A NULL cell copies as an empty string, never the word the
grid draws for it. Delete/Backspace still only touches row selection: a selected
cell is not a selected row, so nothing stages a delete from it. Right-clicking
clears the range, because the menu it opens is row-level throughout.

**The range is one outline around its boundary, and no fill.** `cellMarks` in
`ResultsTable.tsx` gives each cell only the sides that lie on the rectangle's
edge — top row draws a top, leftmost column draws a left, and a cell in the
middle draws nothing — so the range reads as one shape rather than a lattice of
boxed cells or a wash of background. Nothing marks the focus corner apart: with
no fill to sit inside there is nothing for a second mark to distinguish it from,
and the corner the arrows move from is still `cells.focus` in state.

Two things about how it is drawn are load-bearing:

- **All of a cell's accent marks are one `box-shadow`, composed in one place.**
  Selected, dirty and open-for-editing can all be true of the same cell — a
  double-click selects the cell it opens — and `box-shadow` is a single
  property, so split across CSS rules only the last one applied would survive
  and the others would vanish without a trace. `residual.css` therefore keeps
  `grid__cell--selected` and `--editing` as hooks with no rule of their own, and
  leaves `--dirty` only the colour a shadow cannot carry.
- **`box-shadow`, never a real border.** The grid's cells carry a right and a
  bottom border and nothing on the other two sides, so a border appearing on a
  top or left edge would grow the row and shift every column beside it. An inset
  shadow occupies no layout.

**A JSON/JSONB column edits in a drawer, not the inline text box.** `isJsonType`
in `ResultsTable.tsx` matches a column's `columnInfo.dataType` case-insensitively
against `json`/`jsonb` — the engine's own string, the same one the header prints,
never normalised (see *Listing a table's columns* in `extension.md`) — so
double-clicking such a cell opens `JsonCellDrawer` (`<Drawer>`, the side-panel
sibling of `<Modal>`) instead of `startEdit`'s usual inline `<CellEditor>`. The
drawer owns its own Monaco instance — syntax highlighting, `Format` (pretty-print,
Monaco's own `editor.action.formatDocument`) and validation (a synchronous
`JSON.parse`, gating *Save*) — independent of the tab editor's singleton; see
`docs/decisions.md` for why a second Monaco instance is the right call here and
what wiring it needed. `commit`/`setNull` are split into `applyEdit`/`applyNull`
(the write) and a thin wrapper that also closes whichever editor is open
(`editing` or `jsonEditing`), so the drawer's Save/Set NULL stage the same way
the inline editor's do — through `setCell`/`clearCell` below — without touching
state the drawer never entered. SQLite has no JSON type, so this path never
triggers there.

**The staged edits are a context, not a slice** — the bridge test again. They have
not crossed until Save (only the `db.write` arguments do), and they are keyed by
tab, so `ResultsContext` prunes them by diffing the tab list in an effect, never
from a close handler — the shape the editor's text held before session restore
moved it into a slice that prunes in the reducer instead. One twist rows
force: an edit is keyed by its **row index into the page on screen**, so each entry
stamps the `rowsKey` it was made against (see *What names the rows on screen*)
and a different one starts fresh — paging discards staging, switching tabs keeps
it, and the sort, the filter and the statement index are all in that key for the
same reason. The original key values are read
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

## Sorting by a column header

Clicking a grid header sorts the result by that column. It works on **both** kinds
of grid, which is the one place the browse/query boundary this feature draws
everywhere else is deliberately open — see `docs/decisions.md` for why the rewrite
that costs is allowed here and refused for paging and filtering.

**One column, three states.** `toggleSort` (in `useResults`) cycles
asc → desc → unsorted, and clicking a different header replaces the sort rather
than adding to it. The third state matters: an unsorted browse and an unsorted
query are both real orders — the server's natural one, and whatever the statement
itself asked for — so "no sort" has to be reachable and has to mean *the app adds
nothing*. A different column always starts at ascending rather than inheriting the
last one's direction, which would be the app remembering something the user never
said about this column.

**Which path runs is the tab's kind, and both go to the server.** A grid tab
re-browses, so the order goes into the page SQL the extension already authors; an
editor tab re-runs **the statement the result came from** — `ResultsState.sql`,
written by the run that produced it — with a sort the extension wraps around it.
Not the tab's current text: that has been free to change since, and between a run
of a *selection* and a run holding several statements the two are routinely
different strings. Re-running the tab would re-run the whole batch — including
an `INSERT` or `DELETE` that already landed — or a query the user is halfway
through rewriting, and report the answer under a header they clicked on the old
one. The re-run goes back into the statement's own slot; see *Running several
statements*.
Neither reorders the rows already in hand, and that is not laziness: a BIGINT
arrives as a string and a timestamp as the engine's own text, so a comparator up
here would sort `9` after `10` and order dates by their spelling. It is *Never
render a value through `Date` or `Number`* pointed at the order instead of the
value — the app would be reordering by rules the database does not use and then
showing it as the database's answer.

**`sort` lives on `ResultsState`, not inside `browse`.** Unlike `filter`, both
kinds of result can carry one, so it sits beside `browse` rather than in it. It is
cleared on a rejected run or page for the reason `browse` is: it describes a grid
that is no longer on screen, and an arrow claiming a sort is in force over an
error message is a lie the next click would inherit.

Four things are load-bearing, and each is the filter's own lesson arriving again:

- **Everything that re-fetches carries the sort** — paging, Apply, Clear filter,
  and the re-read after a successful Save. Miss one and that fetch is cut from a
  different order than the one on screen, which shows up as rows repeating across
  a page boundary rather than as anything that looks like a bug in sorting.
- **The sort is part of the staging page key** (`table@offset@filter@sort`). Row 3
  of a table ordered by name is not row 3 of it in natural order, so without this
  a re-sort would carry staged edits onto whatever rows landed in those positions
  — a write to rows the user never saw, the exact failure row identity exists to
  prevent. A hand query needs no such term: sorting one re-runs it, and `runSeq`
  has already moved.
- **Sorting always browses from offset 0**, the same reason applying a filter
  does: a new order makes row 250 a different row, so holding the old offset lands
  somewhere that meant something only under the order just replaced.
- **`canSort` refuses a blank or duplicated column name.** Both are unnameable in
  an `ORDER BY` — a name the result answers under twice (`SELECT id, id`) is
  ambiguous and both server engines reject the wrap. Refusing the click beats a
  server error about a statement the user did not type. Neither case can arise on
  a browsed page, which is `SELECT *` over a real table; this only bites a hand
  query.

**The sort is not in the session snapshot, though the filter is.** A restored grid
tab re-browses, so its filter has to ride along or the tab comes back holding a
different set of rows than it was left with. A sort changes no rows, so a restored
tab without one shows the same table it always did — and a restored editor tab's
sort would mean nothing until its query is run again.

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
"needs it or doesn't" judgment call to get wrong. That holds because nobody
reads this clause; the completion popup, whose text *is* read, is the one place
that quotes conditionally instead — see *Completion*.

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
- **Cancelling an in-flight connect does not `go(...)`.** Every other exit from a
  screen navigates somewhere, but a connect attempt can be cancelled from wherever
  it was started — the saved list, a freshly submitted form, the password prompt —
  and none of those needs to change screen for the attempt to stop. Routing it
  through `go(null)` once did, and since `screen` was already `null` at that point
  (nothing had navigated since the attempt began), `go(null)` re-derived the view
  from data instead of leaving it alone — landing on the workspace picker whenever
  more than one workspace existed, even though the list you clicked *Connect* from
  never changed. The Cancel button now only aborts (`cancelConnect`), clears
  `connectingId` and dismisses the error; it leaves `screen` untouched.

**A row with a connection already open is marked `Open`, and its *Edit* is
refused.** `ConnectScreen` reads the open saved ids off `session.connections`
(`savedConnectionId`, never the runtime `connectionId`) and hands
`SavedConnectionList` the set. Saving an edit writes the stored row, and a
connection running off that row never reads it again — so the form would save
changes that take effect on the next connect and nowhere before it, which is the
divergence being refused rather than explained afterwards. The reason sits on a
`<span>` wrapping the button, not on the button: a disabled button receives no
mouse events, so a `title` on it never shows. *Delete* stays available — the row
going is not the same claim as the row quietly disagreeing with what is running.

**A cancelled attempt still lands in `session.error`, and is rendered
differently on purpose.** `cancelConnect` aborts the in-flight `call()`, which
rejects with `Error('Cancelled.')` (`bridge.ts`) the same way a real failure
would, so `connect.rejected`/`connectSaved.rejected` sets `error` to
`'Cancelled.'` regardless — dismissing it synchronously in the Cancel handler
loses the race, since the rejection lands a beat later. Rather than chase that
race, `ConnectScreen` special-cases the string: `error === 'Cancelled.'` prints
in the same muted voice as "Connecting for…" instead of the red `Callout` a
genuine connect error gets, because the user asked for this one to stop and it
is not a failure.

`connectingStartedAt` (`sessionSlice`) is set the moment `connect`/`connectSaved`
goes `pending` and cleared on `fulfilled`/`rejected`, alongside `connecting` and
`connectingPhase`. `ConnectScreen` ticks a local elapsed value off it (100ms, the
same shape as the status bar's query timer) and prints it beside Cancel —
one place, regardless of which screen started the attempt, rather than a copy of
the same interval in the form, the password prompt and the saved list each.

Environments are a *grouping*, not a step: a workspace's connections render
under a heading per environment, in the managed list's order, and an
environment nobody used has no heading. Any number of connections may share
one — they are labels, not slots.

**The list is user-managed, not the fixed four it used to be.** `environmentsSlice`
(colocated `useEnvironments`, the same pattern `useSession`/`useTabs` use) is a
view of the extension's `environments` table — add and remove only, reached from
the File menu's `EnvironmentsDialog`, not from inside the connect screen at all.
`ConnectionForm`'s select and `SavedConnectionList`'s grouping both take it as a
prop rather than importing a static list, so neither can drift from what the
dialog shows. **A connection stores the name as plain text, not this row's id**
— removing an environment from the list cannot touch a connection already
carrying it, which is the whole point of "removed" meaning "no longer offered"
and nothing more. `SavedConnectionList` groups known names by the list's order
and anything left over — a connection whose environment was later delisted —
under its own heading afterward, sorted alphabetically, rather than dropping it
from view; see `docs/decisions.md` for why display shows exactly what is stored,
with no capitalising or abbreviating layered back on top of arbitrary text.

**The line under the title names the screen, not the app.** `screenSubtitle` is a
switch over the same resolved `Screen` the body renders, so the card's one
sentence of prose changes as you move between the picker, a list and a form. It
replaced a fixed tagline, which said the same thing on every screen and was
therefore read once, on the first launch, and never again.

**A connection's name is required, and `submitNew` saves the row before it
connects.** There is no unnamed, workspace-less throwaway connection any more:
every open connection is a saved, named member of a workspace, which is what lets
the rail group every one of them under its workspace. `session.connect` therefore
carries the `workspaceId` it was launched from, the same UI-side fact as the
`name`, `environment` and `color` it already threaded — `db.connect` never hears
any of the four. **Required is not the same as unique**: the store stopped
enforcing uniqueness (see `docs/extension.md`), so two connections in one
workspace may share a name and are told apart by their colour and their server.

### The order the form asks in

Engine, then name, then environment and colour, then the server, then
authentication, then the options. That is a narrative — *what kind of thing, what
you call it, where it is, who you are, how it opens* — and each step is only
answerable once the one before it is.

**Engine is first because it decides which fields exist at all.** A file engine
has no host, no port and no authentication; asked last, every answer above it was
given without knowing that, and switching then blanks half of them. The three
`Section` headings (*Server*, *Authentication*, *Options*) are the same argument
made visible: the method select and the fields it swaps are one question, so they
sit under one heading and nothing outside it moves when the method changes.

**Read-only and SSL share the Options row**, because both answer "how should it
open" rather than "where is it" — and a file engine, which has no SSL, simply
leaves read-only alone in the row.

### Saying what is missing

*Connect* is never disabled for an incomplete form. Submitting computes
`missingFields` — a **list**, in the order the fields are drawn — and if it is
non-empty the form marks each entry, focuses the first, and does not submit. A
disabled button states that something is wrong and nothing about what, and the
user is left comparing the form against itself to find it.

Four things there are load-bearing:

- **Nothing is marked until a submit has actually looked.** `submitted` is the
  gate; without it the form reddens fields you have not reached yet, which is
  scolding someone for not typing fast enough.
- **The mark clears per field, with no second submit.** `missing` is derived on
  every render, so a field that stops being empty stops being marked — and one
  that is emptied again is marked again, because `submitted` stays set.
- **`noValidate` on the `<form>`.** The browser's own validation bubble *is* the
  "you may not submit this" being replaced, and it fires before the handler. The
  `required` attributes came off the inputs for the same reason.
- **Only the exceptions carry a label.** Nearly everything here is required, so
  `(optional)` is the hint worth the space and `(required)` is not; the same slot
  carries `required` in red once a submit has found the field empty, which is
  what keeps the row from changing height when it does.

### Stopping an attempt started from the form

`ConnectScreen` has one abort — the elapsed line and *Cancel* under everything it
renders — and on the connect form that is under a form tall enough to put it
below the fold. So the form takes the job over: while `onAbortConnect` is set,
the actions row becomes `[Cancel] [Connecting for 3.4s…]`, and `ConnectScreen`
suppresses its own block for the `new` screen only. Every other screen here is
short, so for them it is still the one place an attempt is called off from.

Two things there are load-bearing:

- **The row is scrolled into view when the attempt starts.** Pressing *Connect*
  leaves the row under the cursor already and `block: 'nearest'` is a no-op — but
  submitting with Enter from a field near the top does not, and the abort would
  be off screen at the exact moment it is the only control that matters.
- **`submitNew` remembers the row it saved** (`draftRowId`), so a second attempt
  edits it instead of adding another. The save lands before the connect and
  cannot be taken back, so a cancelled attempt leaves a real row behind — and
  pressing *Connect* again used to be caught by the store's duplicate-name check,
  which is no longer there. Without this, the fix-a-field-and-retry loop quietly
  fills the workspace with copies. `go(...)` clears it, because leaving the form
  ends the draft.

**One case never reaches any of this**, and it is the first connection in an
empty workspace: saving its row makes `saved.connections` non-empty, which
re-derives the un-pinned screen from `new` to `list` mid-connect. The form is
gone by the time the connect is in flight, and `ConnectScreen`'s own abort —
under a short list — is the one that shows.

**Every connection has a colour; a workspace has none.** The picker shares a row
with the environment select — the same fact about *which connection this is*,
rather than how to reach it. At rest it is one tile showing the current hue;
clicking it expands the nine swatches across that same row, and picking one
collapses it back. Deliberately **not** a floating panel: it is one 32px row
either way, so nothing below it moves, and there is no layer to dismiss. See
`docs/decisions.md` and the *colour picker* recipe in `design-system.md`.

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

**IAM also gets a *Sign in to AWS* button**, beside the profile and region, which
dispatches `aws.ssoLogin` — the extension running the user's own
`aws sso login --profile X` (see `docs/extension.md`). The answer lives in
`awsSignInSlice`, a sibling of `connectionTestSlice` rather than a field on it:
both crossed the bridge, but a test describes the whole form and is withdrawn by
any edit, while a sign-in describes one profile and survives everything except
that profile being retyped — which is why the two have separate clearing effects
in `ConnectionForm`, one keyed on `form` and one on `form.awsProfile`. It holds
the profile rather than a boolean, so the success message cannot vouch for a
profile the field no longer names.

### A connection you cannot open yet is veiled, not left to fail

**Whether an IAM connection can be opened is a fact about the row, so it is
established before anyone reaches for it.** `SavedConnectionList` asks
`aws.credentialStatus` for every distinct IAM profile it draws, as it draws
them — not on the click. A profile that cannot mint credentials dims its
rows, disables their `saved-pick`, and reveals a frosted pane on hover carrying
*Sign in to AWS* — see the *veiled row* recipe in `design-system.md` for what the
pane is made of and why its blur stops where it does. Signing in clears the row
and connects it.

Five things there are load-bearing:

- **The check is keyed by profile, not by connection.** A workspace commonly
  holds several IAM connections that share one profile, and the answer belongs to
  the profile — so one check lights or clears every row that names it.
- **The component asks on every render pass that could have changed the set, and
  `checkAwsCredentials`'s own `condition` is what makes that free.** The same
  arrangement `loadColumns` has with the completion provider, and for the same
  reason: a component should say what it needs, not keep a private record of what
  it has already asked for.
- **Unknown is not blocked.** A profile still being checked, or one nothing has
  answered for, leaves the row exactly as it was. Gating on "we have not asked
  yet" would grey out every IAM connection for the first beat after the list
  appears, which reads as broken rather than as careful.
- **The veil covers the pick target and nothing else**, so a row you cannot open
  is still one you can edit or delete — editing the profile name being one of the
  two ways out of the state.
- **The pane reveals on hover *and* focus**, the same amendment the row's own
  Edit and Delete needed: `SavedConnectionList` tracks `focusedId` off the row's
  `onFocus`/`onBlur`, because a pane that only answered to the pointer would be
  the one control on a blocked row a keyboard could never reach.
- **A successful sign-in forgets the profile rather than assuming it good.** The
  CLI exiting zero means it wrote the token cache, not that `fromIni` will now
  resolve against it; the entry is deleted and the effect asks again, which is
  the same question that gated the row.

**`pick` therefore does no checking at all.** By the time it runs the answer is
already known to be yes, and re-asking would put a beat of nothing in front of
every IAM connect to re-learn what the row already shows.

**It is a reduction, not a guarantee, so the after-the-fact offer stays.**
Credentials valid when the list was drawn can lapse before the token is minted,
and the check itself can fail to be made at all — in which case it answers
*valid*, on purpose: a question the app could not ask must not stand between the
user and a connection that might work perfectly well.

**Only a missing profile withholds the sign-in button** (`signInHelps`); the veil
then says *Profile not set up* and carries the reason itself as its `title` —
the reason names the profile, so it is as long as the profile is, and a chip that
long lands on the connection's name. The narrower rule — offer it only for a
recognised expired-SSO error — was wrong in the direction that matters: the
credential-provider chain has no stable error shape, so an unrecognised failure
is more likely to be a session a login would fix than one it would not, and
withholding the button there withholds it from the very case the feature exists
for. A sign-in that turns out not to help says so in its own words; a button that
never appears says nothing.

**The sign-in is split into a button and a status, because they do not always sit
together.** `AwsSignInButton` goes wherever the action belongs — the form's
Authentication section, a veiled row, beside a failed connect — while
`AwsSignInStatus` (the CLI's URL and code, and how the last attempt ended) is
rendered **once per screen**. There is one CLI running at a time, so a copy beside
every veiled row would be the same URL repeated down the list.

**The same button is offered beside a *failed* connect, and there it retries.**
The veil catches the common case, but credentials can lapse between the list
being drawn and the token being minted, so this is the backstop. The form passes
no `onSignedIn` (there is no connection yet to retry); `ConnectScreen` passes the
very `connectSaved` that just failed, so signing in and getting in is one click.
**The retry runs in the click handler, not in an effect watching `signedIn`** —
that value stays set, so an effect would fire again on the next render that
touched it and reconnect behind the user's back after a second failure.

**Whether to offer it is read off the phase, never off the error text.**
`session.awsCredentialsFailed` is set in the rejection reducer from
`connectingPhase === 'iam-token'`: the extension emits that phase immediately
before minting the token and replaces it with `connecting` immediately after, so
a rejection while it still says `iam-token` *is* a credentials failure, by
construction. Matching `mapAwsError`'s wording up here would be the same fact
written twice in two places that cannot be kept in step. A *cancel* is excluded —
stopping an attempt mid-token is not the credentials being wrong. `ConnectScreen`
then resolves the profile off the saved row (`config.iam.profile`) rather than
carrying it through the store, since it already holds the row it was connecting.

**The URL and code arrive on a broadcast, and they are the sign-in rather than a
status line about it.** `aws sso login` runs *device authorization*: it prints a
verification URL and a user code, tries to open a browser, and then polls until
someone approves them. Both arrive long before the command exits, so they cannot
ride back on the reply — `AWS_SSO_PROMPT_EVENT` is the fourth broadcast, and
`main.tsx` dispatches `promptReceived` for it beside the other three.
`awsSignInSlice.prompt` holds it; the form draws an *Open the sign-in page*
button (`Neutralino.os.open`) plus the code and the raw URL. **The reducer drops
a prompt arriving while nothing is signing in** — that is a stale broadcast from
an attempt already abandoned, and drawing it under a button at rest would offer
a link to a login nobody is waiting on.

### Testing what is typed, without leaving the form

*Test* sits between *Cancel* and the submit and reaches the server described by
the fields as they stand — `db.test`, which opens a connection, names its
version and closes it (see `docs/extension.md`). Success reads
`Connected to PostgreSQL 16.13`: the version is the extension's and the engine's
name is the form's own, off `ENGINES`, which is the only engine knowledge the UI
holds. Failure is the server's message in the error `Callout` beside the button,
never the screen's error slot — *errors render where the action was taken*, and
the fix-and-retry loop happens here.

Five things are load-bearing, and each is a way the button could look right and
be wrong:

- **`serverConfig(form, iam)` is one function, used by both *Test* and the
  submit.** Two builders would let a draft be tested as one thing and saved as
  another, which would make a green result mean nothing about the row that
  follows it.
- **A test asks for none of what *saving* needs.** No name is required, so *Test*
  is live while the submit is still disabled — a test writes no record, and
  demanding the form's own bookkeeping first would put it in front of the
  question. Only SQLite gates it, on a path, because there is no server to reach
  without one.
- **Any edit withdraws the answer.** `useEffect(..., [form])` clears it, keyed on
  the whole form rather than hung off the handlers, so a field added later cannot
  forget. A test changes no field, so the answer survives the render that lands
  it.
- **An edit form tests with the password it was never shown.** `TestPassword` is
  `{ mode: 'stored', savedConnectionId }` exactly when the form is editing a row
  that has one and the box is untouched — read off the *form*, not the row, so
  switching the edit to IAM or to a file (neither of which has a password)
  falls back to `typed` rather than sending a secret that would go unread.
- **The button is `type="button"`, which `<Button>` now defaults to.** It was not,
  and a `<button>` in a `<form>` is a submit button unless it says otherwise: the
  first cut submitted the form as well as testing, which on an *edit* saved the
  row and navigated away before the result could render. See `docs/decisions.md`.

## Carrying the connections to another machine

The File menu's *Export connections* and *Import connections* are two dialogs
over one slice (`transferSlice`), and the shape they share is that **the UI names
a file and never holds one**: an OS dialog answers with a path, the path goes over
the bridge, and a tally comes back. The document does not exist up here in either
direction — see `docs/extension.md` and `docs/decisions.md` for why that is the
password's doing rather than a capability's.

Four things are load-bearing:

- **The only decision the export screen makes is the checkbox.** *Include
  passwords* is off, and its hint says what ticking it does — the secrets leave
  the encrypted store and land in the file as plain text. Everything else about
  the export is the extension's.
- **A cancelled dialog resolves rather than rejects.** `showSaveDialog` answers
  `''` and `showOpenDialog` an empty array, so both handlers check for nothing
  chosen and return; neither is a `catch`.
- **An import refetches both lists rather than patching them.** The summary
  counts rows and names none, so `importConnections` dispatches `loadWorkspaces`
  and `loadSaved` before it resolves — and the connect screen re-derives from the
  same data it always reads, with nothing new taught to it.
- **The slice is cleared when a dialog closes**, so opening it again does not
  open onto the last run's answer.

**A File-menu item is added in two places or it is Windows-only.** macOS draws
its own `NSMenu` in `scripts/macos-window-chrome.m`, which mirrors `Titlebar.tsx`'s
items exactly and dispatches a `squeal:menu` event that `TitlebarMacos` switches
on. An item added to one and not the other compiles, tests green on Windows, and
is simply missing on the platform that cannot show it.

## Keyboard shortcuts

Every shortcut the app owns is one row of `SHORTCUTS` in `common/shortcuts.ts`
— an id, a label, a group and a default chord — and the Preferences menu's
*Keyboard shortcuts* screen (`features/titlebar/ShortcutsDialog.tsx`) is that
list with a way to change one.

| Group | | Default |
|---|---|---|
| Editor | Run | `Ctrl+Enter` |
| Editor | Run statement under cursor | `Ctrl+Shift+Enter` |
| Editor | Save query | `Ctrl+S` |
| Tabs | New tab | `Ctrl+T` |
| Tabs | Close tab | `Ctrl+W` |
| Tabs | Next tab | `Ctrl+PageDown` |
| Tabs | Previous tab | `Ctrl+PageUp` |
| Tabs | Move tab to the other pane | `Ctrl+\` |
| Connection | Disconnect | `Ctrl+Shift+W` |
| View | Toggle sidebar | `Ctrl+B` |

**`Ctrl+W` is a browser accelerator, and that had to be settled by pressing it.**
A synthetic `KeyboardEvent` enters at the DOM and would pass whether or not a
real key does, because an accelerator is claimed by the embedder above it — so
the suite drives this one through `app.press`, which is `Input.dispatchKeyEvent`
and goes in where a physical key does. WebView2 lets it through: it closes the
tab, and the window is still there afterwards, which is half of what that test
asserts. See `docs/testing.md`.

**Close tab and Disconnect act on what is in front; their menus act on what was
clicked.** `Ctrl+W` takes `workingPane`'s active tab, the same pointer `nextTab`
and `dockTab` read; `Ctrl+Shift+W` takes the active connection, which is what
`useSession().disconnect()` already defaulted to. The tab strip's *Close* and the
rail's *Disconnect* name the tab or chip the menu was summoned on instead — and
neither activates it first, so a background server can be closed without leaving
the one being worked in.

**Adding one is a registry row and a handler**, and both listeners pick it up:
`EditorPane` registers a Monaco action for *every* row rather than a hand-written
list, and `Shell`'s window listener searches its own command map for whichever id
holds the chord. A row wired only to the window listener would be a shortcut that
stops working the moment the cursor is in the editor — which is not something the
person adding it would think to check.

**Two owners, and which one a shortcut belongs to is what it acts on.** Run,
Run-statement and Save are the *editor's*: they need this pane's text, cursor and
selection, so `EditorPane` answers them itself and its window listener is gated
on `focused` so only one pane of a split responds. The tab and sidebar commands
are the *shell's*: `ShellLayout` owns them, hands them down as `commands` (keyed
by id) for Monaco to register, and keeps one window listener over the same map.

**A chord is a string**, `Ctrl+Shift+Enter`, because it is written to the
settings store, which keeps text and no vocabulary of its own. `Ctrl` covers
Command as well — the `e.ctrlKey || e.metaKey` reading this app already had
everywhere and the one Monaco's `CtrlCmd` gives it — so one stored binding means
the platform's own modifier on both platforms, and `formatChord` is the only
thing that is per-platform, spelling it `Cmd`/`Option` on macOS.

**`chordFromEvent` produces a chord and `matchesChord` is that same function
compared against a stored one.** Recording a key and recognising it are
therefore one rule, which is what makes it impossible to record a chord that
then fails to match: the normalisations (a printable key uppercased so `b` and
`Shift+B` name one key, the space bar named rather than left as the character it
produces) are applied by the one function both sides go through. It also
replaced a real bug — `e.key` is `Enter` with or without Shift, so a hand-rolled
`e.key === 'Enter'` answered `Ctrl+Shift+Enter` as well as its own key.

**The overrides are one settings value, `keybindings`, holding a JSON map.** Not
a key per shortcut, and the reason is *reset*: `settings.set` writes and does not
delete, so a key per shortcut could only reset by pinning today's default as a
value — which would then quietly outlive a change to it. Removing an entry from
a map is the reset, and an id nobody has overridden simply is not in it. The
extension has never parsed it, the same opaque-text rule the session snapshot
rides on. `useShortcuts()` (in `settingsSlice.ts`, beside `useBooleanSetting` —
a hook per preference *shape*) is the whole surface: the resolved bindings, the
raw overrides so a row can say it is no longer the default, and rebind/reset.

**Every shortcut is bound twice, and both halves are needed.** Monaco wins inside
its own DOM and the window listener never sees those keydowns, so `EditorPane`
registers each as an `addAction` — and it registers them in *their own effect,
keyed on the bindings*, because an action's keybinding cannot be rewritten: a
rebind disposes them and adds them again. The window listeners (`EditorPane` for
run/save, `Shell` for the tabs and the sidebar) are what answer when focus has
left Monaco. `keybindingFor` in `monaco.ts` is the conversion, and it returns an
empty list for a chord Monaco has no key code for — which leaves Monaco's own
default in place there rather than registering an action nothing can trigger. Its
table is the arrow keys (which the DOM and Monaco name differently) and the
punctuation (which the DOM names by the character and Monaco by the key); the
punctuation is not cosmetic, since Monaco binds `Ctrl+/` to toggle-line-comment
and a shortcut rebound there without a registration would comment the line.

**Ctrl+S is prevented whatever Save is bound to.** The dialog the webview would
otherwise open over the app is that key's doing, not this shortcut's, so
rebinding or unbinding the shortcut must not hand it back.

**Recording listens on the window in the capture phase.** That is the whole of
how a key being *named* is not also obeyed: every listener in the app — Monaco's
included, since its DOM is a descendant — sits below that one, and
`stopPropagation` means none of them sees the keydown. A modifier held on its own
is not a chord yet, so the recorder waits rather than committing the instant Ctrl
goes down, and Escape cancels.

**A chord another shortcut already answers is refused, never stolen**, with the
clash named in the line that otherwise holds the instruction — the `<Field>` hint
idiom, so the rows below it do not move — and recording stays open so the next
press is the correction. Two shortcuts on one chord is a screen that cannot say
which one wins.

**There is no "split" command, because there is no split verb.** *Move tab to the
other pane* dispatches the same `moveTab(id, null, pane)` a drag onto the other
strip does, and a split is what that looks like when the pane had none — so the
one shortcut both opens a split and closes it, exactly as dragging does. Which
pane it acts on is `workingPane`, not `focusedPane` directly: a split that
collapses unmounts the secondary `<main>` and leaves `focusedPane` pointing at a
pane that is gone, and every tab command would then act on an empty strip until
the user clicked something. Stepping between tabs is the same pane's strip,
wrapping at either end, and a pane holding one tab has nowhere to step to.

**The grid's keys are not in the registry, and that is the line.** Ctrl+C,
Delete, Ctrl+Delete and the arrows in `ResultsTable` are the *control's* own keys
— what a data grid does, the same way the arrows are navigation rather than a
command — where these are the app's own commands, each of which had to be bound
at all because Monaco or the webview already claimed the key. See
`docs/decisions.md`.

## The editor

`features/editor` is Monaco. `monaco.ts` owns the two things that are not the
component — its worker, and a theme built by reading `tokens.css` — and
`EditorPane` creates the editor once and never re-renders into it. React owns
the box; Monaco owns everything inside it.

**One editor, one model per tab.** The model is what makes the text per tab;
switching a tab is `saveViewState` → `setModel` → `restoreViewState`. A split
view mounts a second `EditorPane`, each still holding one model per tab within
its own pane — "one editor" is about a tab never getting a second instance to
itself, not a ban on the component appearing twice, the same distinction the
JSON cell drawer already drew (see `docs/decisions.md`). `window.squealEditor`
stays singular by choice, not by there being only one instance any more: only
the primary pane's `EditorPane` exposes it. See *Split the editor*, above.

Six things there look incidental and are not:

- **`inherit: false` on the theme.** vs-dark ships a `string.sql` rule that
  outranks any `string` rule the app writes. Inherit and the strings come up red.
- **Text flows one way: out — and the two exceptions both prove the shape of it.**
  Browsing a table opens its own grid tab, and swapping tabs swaps the *model*,
  which is not `setValue`. The formatter was the first outside writer and it
  obeys the rule: it returns a full-range *edit*, which Monaco applies like a
  keystroke, so the change flows out through `onDidChangeModelContent`. **Saving
  a saved query is the second**, and it is the first that writes into a model
  nobody is looking at — the other tabs open on that query (see *Saved queries*).
  It does both of the things the rule asks: a full-range edit rather than
  `setValue`, and only **when the value actually differs from Monaco's own**.
  That guard is not caution, it is what stops the loop: a keystroke updates
  `sqlByTab` from the model, so the effect watching `sqlByTab` would otherwise
  fire on every keystroke and throw the cursor to the top of the document.
  Whatever writes next (the palette) does the same two things.
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
- **Every shortcut is rebound in the editor.** Run's default is Monaco's own
  "insert line below", Run-statement's its "insert line above", and Ctrl+B/Ctrl+S
  are the webview's — and Monaco wins inside its own DOM, so the `window`
  listener that serves the rest of the app never sees those keys. That listener
  is live on a grid tab too — the pane is mounted, just hidden — so it refuses
  for itself. The chords come from the shortcut registry rather than being
  written here (see *Keyboard shortcuts*), which is also why the four
  `addAction`s live in an effect of their own: a rebind disposes and re-registers
  them. Ctrl+S has one extra reason to be prevented at all, whatever Save is
  bound to, which is that the webview otherwise treats it as *save this page* and
  opens the OS file dialog over the app. With a split view there are two `window`
  listeners alive, one per pane, and only the focused pane's may act on a
  keypress that landed outside either Monaco instance — see *Split the
  editor*'s `focused` prop.
- **`window.squealEditor` is the UI suite's seam.** Monaco's text lives in a
  model, so there is no `.value` to read and nothing to type into. It holds no
  model at all while a grid tab is showing, so reads of it must guard.

**The pane is hidden on a grid tab, never unmounted.** That is not a preference:
there is one instance and every tab's model hangs off it, so unmounting would
dispose the lot and every other tab would come back empty.

### Running a selection

With text selected, running runs exactly that text; with nothing selected it runs
the whole tab, unchanged. One function decides it — `sqlToRun` in `EditorPane` —
and all three ways in call it: Monaco's Ctrl+Enter, the window listener behind it,
and the toolbar's *Run*. The `onRun` prop takes the text, so the results feature
never learns that a selection is a thing.

Four things there are load-bearing:

- **It is read off Monaco at the moment of the run, never tracked in state.** A
  selection is Monaco's own and the store has never heard of it, so there is
  nothing to keep in step and no frame to be behind.
- **A selection of nothing but whitespace runs nothing at all**, and gets there
  by being passed along rather than by a branch: `runQuery`'s own condition
  refuses a blank statement, which is the same no-op an empty editor already
  gets. Falling back to the whole tab would run the text the user just narrowed
  away from — the loudest possible way to be wrong, since what they narrowed away
  from is usually the statement they did not want to run.
- **The window listener runs the selection too.** A selection outlives the focus
  leaving the editor — Monaco still draws it — so running from the toolbar or from
  a keypress anywhere else has to mean what running from inside the editor means.
- **The button says which**, reading a `hasSelection` boolean kept from
  `onDidChangeCursorSelection`. That state is *only* the label: it is also
  refreshed in the tab-switch effect, because a tab carries its selection in its
  view state and swapping a model underneath the editor is not a cursor event.

A selection spanning more than one statement needs no case of its own — it is the
same text going the same way, so it is split and run statement by statement
exactly as a whole tab of several is. See *Running several statements*.

### Running the statement under the cursor

Ctrl/⌘+Shift+Enter runs the one statement the cursor is standing in, which is the
third and last thing a run can send. `statementToRun` in `EditorPane` decides it,
beside `sqlToRun`, and both are bound the same two ways: Monaco's own action and
the `window` listener behind it.

**A selection is ignored, and that is what makes the key worth having.** It means
"the statement I am in" always, so it stays predictable while text happens to be
selected; Ctrl+Enter is the one that honours a selection. Two keys that agreed
whenever a selection existed would be one key too many. The cursor read is
`getPosition`, which is the active end of a selection rather than some third
thing to reconcile.

**The gap between two statements belongs to the one above it.** A cursor sits
just past the `;` it typed far more often than inside the text it means to run,
so reaching backwards is what makes "write a query, end it, run it" work without
selecting anything. Only a cursor with no statement behind it at all reaches
forward instead — a blank first line above the tab's only query would otherwise
be a shortcut that does nothing.

**A comment above a statement needed no rule, and that is why the spans are the
splitter's own rather than a second reading of the text.** The splitter already
keeps a leading comment with the statement it heads, so a cursor parked in
`-- fetch the users` is *inside* that statement's span and never reaches the gap
rule. A second reading would have had to be taught the same thing and would have
disagreed the first time one of them changed.

Two things it inherits rather than re-decides:

- **Nothing to run is `''`, passed along rather than branched on.** `runQuery`'s
  own condition refuses a blank statement — the same no-op an empty editor and a
  whitespace-only selection already get.
- **The text is read off the model, not off `sqlByTab`.** The offset is an index
  into that string. The two agree, since text only flows out of Monaco, but
  reading one and indexing the other would be a bet on that rather than a use
  of it.

### Completion

Four files, and the split is the app's own boundary drawn through one feature:

| File | Owns |
|---|---|
| `keywords.ts` | the dialect's words, read out of Monaco's own grammar |
| `sqlScope.ts` | a regex scan for the tables and aliases in a `FROM`/`JOIN` |
| `completion.ts` | the provider: what to offer, in what order, with which mark |
| `useSqlCompletion.ts` | `useSqlCompletion` registers the provider (once, in `ShellLayout`); `useSqlPrefetch` fetches columns for one editor's own text (per pane, in `EditorPane`) |

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

- **Columns are fetched off the text, not off the dot.** `useSqlPrefetch`
  scans on every keystroke and dispatches `loadColumns` for whatever is in the
  `FROM`. By the time a `.` is typed after `users`, the columns have to already
  be there — start the fetch at the dot and you get an empty popup and a round
  trip. Typing the table's name is the event that says which table matters.
- **That effect runs per keystroke on purpose, and `loadColumns` is what makes it
  free.** Its `condition` carries the cache, and the thunk marks a table asked
  *before its first await* — without that, two keystrokes in a row both pass the
  condition and both fetch.
- **The provider is registered once, in `ShellLayout`, regardless of how many
  panes are open, and cannot close over anything pane-specific.** It reads a
  ref for the connection-level facts (words, dialect, catalog), exactly like
  the Ctrl+Enter command and for the same reason — capture the catalog and it
  answers with the catalog as it was at registration, forever. What tables are
  *in scope* is not on that ref at all: `provideCompletionItems` scans the
  `model` Monaco hands it directly, which is what lets one registration answer
  correctly for either pane's editor. See *Split the editor*.
- **One provider per language, disposed on dialect change.** Two providers on one
  language both answer and the popup holds every suggestion twice — the failure
  a second `EditorPane` calling this hook itself would have reintroduced one
  pane at a time instead of one dialect change at a time, which is why the
  registration lives above the panes instead.
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

**What a suggestion inserts is not always what it is labelled.** An identifier
the engine would not resolve written bare goes in quoted — Postgres folds an
unquoted name to lowercase, so accepting `createdAt` used to write a query
looking for `createdat`, a failure whose every ingredient came out of the
catalog. The label stays the plain name, since that is what is being typed and
matched against.

`quoteIdentifierIfNeeded` (`common/db/sql.ts`) is the rule, and it is
**conditional where `quoteIdentifier` beside it is not** — the same split as
"who reads the result". SQL this app *assembles* (the filter bar's `WHERE`,
copy-as-SQL, the extension's own page SQL) is quoted unconditionally, because
nobody reads it and a judgment call there is one more thing to get wrong. SQL
the user is *writing* is read by them, so `email` completes as `email` and only
a name that needs them gains quotes. It is a per-dialect pattern rather than one
rule: Postgres is the engine that folds, MySQL and SQLite keep the case they are
given and only quote what could not be spelled bare at all — a space, a leading
digit. See `docs/decisions.md`.

Two things there are load-bearing:

- **A relation quotes each half.** `"reporting"."daily_stats"` is one relation
  and not one quoted name with a dot in it, so `tableItem` takes the `Relation`
  rather than its printed name and quotes the schema and the table separately.
- **A quote the user opened themselves is theirs.** With a `"` already to the
  left of the word (`SELECT "crea`), the name goes in bare — adding ours spells
  `""createdAt"`, and widening the replaced range to swallow theirs would delete
  a character they meant. `qualifierAt` allows for that quote after the dot for
  the same reason, or `u."crea` would fall out of the qualified branch entirely
  and offer the whole dialect at a dot.

A **reserved word** (`order`, `select`) also needs quoting and is deliberately
not detected: telling the reserved words apart from the many keywords that are
perfectly good column names takes a per-dialect list, and erring generous would
put quotes around half the ordinary columns there are.

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
   tab list changing and nothing else. **Saved queries are the fifth and they
   arrive as two props**, one on each side of the gesture: `SavedQueriesButton`
   takes `onOpen` and `EditorPane` takes `onSaveQuery`, because opening one spans
   the tabs, the editor and the queries slice, and saving spans the same three
   back the other way.
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

**A rail chip right-clicks to *Disconnect*, and that is the second way out.** The
first is the status bar's button, bottom-left, which is where it has always
lived and which is easy to have never noticed; the chip is where the gesture is
actually reached for. One item, `danger`, naming the chip it was summoned on
without activating it — so a background server closes without leaving the one
being worked in. Neither way confirms: `disconnect.pending` saves the session
while the tabs still exist, so reconnecting brings back the tabs, the split and
the queries. A disconnect parks work; it does not destroy it, which is the whole
of why *Close All* asks and this — closing strictly more — does not.

### Thunks read their target; callers do not pass it

`runQuery` reads **the connection off the tab it names, and the database off
that connection** (`tabs.database[tab.connectionId]`). Dispatch is synchronous,
so pointing the connection at a database and then running is guaranteed to
query the one just picked, with no stale render in between — this is also how
`Shell` reads back the id of a grid tab the reducer just minted
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
  (It *will* rewrite it to sort it, and only to sort it — the difference is that
  a sort returns the same rows and a page returns a hundred of them. See
  "Sorting by a column header" above.)
- **A header's sort mark is the arrow in force, or a faint hint on hover.** The
  sorted column draws its direction in `--accent`, always. Every other sortable
  column carries an ascending chevron that is hidden until the cursor is on it —
  so it is the *hovered* column saying what a click would do, never an icon on
  every header saying something about none of them. It is the ascending glyph
  rather than a neutral one because that is what the next click actually
  produces. A header that cannot be sorted draws nothing and is left inert rather
  than styled as disabled — nothing offered is nothing to explain, and a greyed
  column reads as a broken one.

  **The hint is hidden, not unrendered** (`visibility`, never `display`), and the
  sorted arrow occupies the same slot. So a header keeps its width whether it is
  sorted, hovered or neither: pointing at a column does not widen it, and sorting
  one does not shift the columns beside it.
- **Browsed rows are numbered from the page's offset**, not from 1. A gutter
  counting 1…100 on every page gives two different rows the same name.
- Ctrl/⌘+Enter runs, from anywhere in the window (a `window` keydown listener),
  matching every other SQL tool; Ctrl/⌘+Shift+Enter runs the statement the cursor
  is in. On a grid tab neither does anything: there is no query there to run.
- **A tab binds to a connection for life; the database is the connection's, not
  any one tab's.** The connection is fixed at open time and nothing changes it:
  moving the rail switches which tabs you are *looking at*, never what any of
  them points at. The picker moves the database every tab of that connection
  reads — see "The database is the connection's, not any one tab's" above. A
  grid tab is "this table, in the connection's current database", so it
  re-browses when the picker moves while it is in front, and says so in its
  own grid when the table does not live there.
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

  **A narrowing sidebar clips the type before it clips the name, and by a lot
  more than "before" implies.** Both are `flex` items with `minWidth: 0` (the
  usual requirement for `text-overflow: ellipsis` to engage inside a flex
  container at all), but the *shrink* factor is asymmetric — the type's is
  `999` against the name's default `1`. Flexbox distributes negative space
  proportionally to `shrink × basis`, so at that ratio the type absorbs
  essentially all of it and is driven to its floor (0, invisible) before the
  name loses a pixel; only once the type is fully gone does any further
  narrowing reach the name. This is a pure-CSS two-stage priority with no
  measurement in JS — the number is arbitrary in the sense that any
  sufficiently large ratio does the same job, not in the sense that a smaller
  one would (proportional shrink with an ordinary `1:1` split was tried first
  and clipped both together, which is the bug this replaced). Verified against
  the running app: DOM-measured `offsetWidth < scrollWidth` per element, not a
  screenshot read by eye — a scaled or zoomed capture shifts font hinting
  enough to disagree with the native-scale layout it was supposed to be
  checking.
- **The tree's filter matches names only, and hides rows and nothing else.**
  Ordering, tables-above-views, which rows are expanded and the context menu all
  behave exactly as they do unfiltered. It deliberately does not match columns:
  those are fetched lazily per expanded table, so matching them would find hits
  in whatever you happen to have open and silently miss every table you do not —
  a filter whose answer depends on what you expanded earlier. A filter that
  matches nothing says *No matches*, which is a different fact from a database
  with *No tables* and reads as one.
- **The skeleton is for a tree with nothing behind it, never for a refresh.**
  `useExplorer` answers two questions off one `loadingTables` marker: `loading`
  is "a fetch is in flight for this node", which is what turns the refresh icon
  and disables the button, and `firstLoad` is that same fetch with
  `tables === null` behind it, which is the only thing that draws
  `<TreeSkeleton>`. They differ exactly on the refresh button, which asks past
  the cache (`force`) for rows that are already on screen — replacing them with
  placeholders throws away a readable tree to say something the spinning icon
  already says. A database switch is a first load again, because that node has
  nothing cached, so it keeps its skeleton without a second flag.
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
- **The tree and the picker always have a database to show**, the connection's
  own (`tabs.database`) rather than anything read off a tab — so the empty
  state, with no tab open at all, is not a special case: a connection pointed
  at nothing has an empty tree and nothing to run, and if the picker is
  disabled too, the only way out of the app's own empty state is to reconnect.
- **Triggers nest under their table; functions fold into their schema's own
  heading rather than earning one of their own.** A trigger belongs to exactly
  one table, so it renders inside that table's expanded row, lazily fetched the
  same way columns are (`triggersFor`/`loadTableTriggers`, the same
  asked-vs-answered `null` marker `columns` already uses). A function is not
  scoped to a table but it *is* scoped to a schema on an engine that has one —
  `functionsBySchema` groups them the same way `grouped` groups tables, and a
  schema's functions render after that schema's tables under the heading
  already there. A schema holding functions but no tables still gets a group
  for exactly this reason (`grouped`'s loop over `functionsBySchema.keys()`).
  Only when nothing schema-groups them — flat mode, or MySQL, whose database
  *is* its schema — does a flat **Functions** section with its own heading
  appear at the bottom, because there each function has nowhere else to fold
  into.

  **Function rows carry their own testids, never `tree-item`/`tree-label`.**
  Those name a *relation*, which the UI suite reads a schema group's contents
  by (`treeLabelsIn`) and asserts tables sort above views inside — a function
  landing under those same ids would count as one more relation and land after
  every view, breaking that ordering the moment a schema holds both. Its own
  `tree-function-item`/`tree-function-label` keep it a fact the suite has to
  ask for by name rather than one that silently rides along.

  Selecting either opens its definition in a new editor tab, same as a table's
  "Open definition" — `showTriggerDefinition`/`showFunctionDefinition` in
  `Shell`, the same shape as `showDefinition` beside them. Both also carry a
  context menu (`Copy name`, `Open definition`) — a fixed two items, not
  `menuItems`'s four: there is no star and no drop for something that is not a
  relation. A trigger's fires from `<Triggers>`, a separate component, so it
  takes `onContextMenu` as a prop and calls back up to `Sidebar`'s `menu`
  state rather than reaching for it directly; a function's is set inline
  since `renderFunctionRow` is a closure inside `Sidebar` already.
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
