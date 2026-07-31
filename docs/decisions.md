# Decisions

Why things are the way they are. Read the relevant entry before reversing
something — most of these look arbitrary until you know what they cost.

Newest last.

---

## Neutralino over Electron

**Why.** ~2MB app instead of ~150MB, and the UI is just a webview.

**Cost.** No Node in the runtime, so the database work needs a separate process
(see next entry), and the app depends on Bun being on the user's PATH.

---

## Database work lives in an extension

**Why.** Not a preference — Neutralino's runtime cannot open a TCP socket. There
is no way to talk to a database from the UI.

**Consequence.** Everything database-shaped goes over the bridge. The UI is
engine-agnostic by construction, which is a genuine benefit: adding an engine
touches one file.

---

## Bun for the extension

**Why.** It runs the TypeScript directly, so the extension has no build step at
all — edit, restart, done. One toolchain for the app, the extension and the
tests.

**Verified before committing to it:** `mysql2` and `pg` behave identically under
Bun and Node — bigints exact, dates verbatim, duplicate columns preserved, real
`Buffer`s. Bun's own `Bun.SQL` was not used: mysql2/pg are battle-tested and
their exact type semantics are already pinned by tests.

**Cost.** In dev, `bun` must be on PATH to run the extension from source; the
packaged app carries no such dependency, since the extension is compiled to a
self-contained binary (`bun build --compile` — see "The extension is compiled").

---

## Never render a value through `Date` or `Number`

**Why.** Both silently corrupt data, and both actually happened here.

- `Date` must pick a timezone. For types carrying no offset (MySQL `DATETIME`,
  Postgres `timestamp`, `date`) it picks the machine's: a stored `09:30`
  displayed as `14:30`, and a bare `DATE` could land on the **previous day** east
  of UTC.
- `Number` cannot hold a BIGINT: `9007199254740993` came back as `…992`.

**Fix.** `dateStrings: true` + `supportBigNumbers: true` (mysql2); identity
type-parsers for the Postgres date OIDs. Show what the server sent.

**Do not "improve" this by formatting dates nicely.** The moment a value is
reinterpreted it can be wrong, and being wrong is worse than being ugly.

---

## Rows as arrays, not objects

**Why.** Object rows key by column name, so `SELECT 1 AS x, 2 AS x` silently
loses a column. Arrays plus field metadata keep every column.

---

## The extension heartbeats

**Why.** It orphaned. A stray extension was found alive holding **8 open
database connections** after its app had died.

**Root cause.** Killing the app does not necessarily close the socket: WebView2
child processes **inherit the listening handle**, so the connection sits in
ESTABLISHED forever and `ws.on('close')` never fires. Waiting on the socket is
not a reliable signal — this was verified, not assumed (a lingering process still
held the port).

**Fix.** Ping the app every 10s; exit after 30s of silence. `ws.on('close')` is
kept as a fast path for the clean case.

**Verified both directions**, because a wrong heartbeat is worse than none: it
survives 60s+ of normal use (Neutralino does answer pings), and reaps itself
~25s after a hard kill, releasing its connections.

---

## `Driver<C>` is generic; the registry is not

**Why.** mysql2 and pg have unrelated client types. The obvious `any` in the
registry would infect every call site.

**How.** `withDriver` hands the concrete driver to a callback; `connection.ts`
captures `C` in a closure and returns a non-generic `ConnectionHandle`. Result:
no `any` anywhere in the extension.

---

## Tests run against real databases

**Why.** Every bug so far was invisible to a mock. See `docs/testing.md`.

---

## Design system adapted, not copied

**Why.** The reference described a security dashboard; its visual language
transfers, its domain furniture (severity ramps, AI pill, icon rail) does not.
The full adopted/adapted/dropped record is in `docs/design-system.md`.

The deliberate deviation is row height: 30px in grids instead of the reference's
44px, because a 100-row result grid at 44px is nothing but scrolling. It is a
token, so it is one line to change back.

---

## The backlog lives at the root, and is written by a skill

**Why not in `docs/`.** The docs describe the current state. A backlog is the
opposite — everything in it is untrue today. Mixing the two means every doc read
has to sort claims into "is" and "might be", which is the failure mode the split
docs exist to avoid.

**Why a skill instead of just editing the file.** The `backlog` skill runs
`grill-me` before it writes. An item logged without grilling is a proposed fix
with the problem left implicit, and it goes stale the moment anyone touches the
area. The grilling is the value; the file is just where the result lands.

**One item, one grilling — twenty items is twenty gruellings.** Batching is the
obvious efficiency and it defeats the purpose: a merged round of questions
resolves the item that was easiest to talk about and lets the rest through on its
coattails. The long tail of a brain-dump is where the half-formed items are, so
the grilling has to hold up longest exactly where it is most tempting to cut it.

**Why items name features, not files.** Two reasons, and the second matters
more: file names churn and break the reference, but an item that *needs* a file
name to make sense is one whose author had not yet found the problem. The rule
makes that failure visible at write time.

**Three sections — Improvements, Bugs, Features — and no more.** A fourth
section is always the beginning of a tracker: priorities, then statuses, then
IDs. There is no fourth section.

---

## A store, after all — and "did it cross the bridge" is the boundary

**This reverses an earlier call.** `frontend.md` used to say all state lives in
`App.tsx` and "a store would be ceremony, revisit if it grows past two panes".
That was right when written and stopped being right: `App.tsx` reached eleven
`useState`s threaded down as props, and saved connections, IAM, Monaco and
pagination were all queued to land on the same component.

**Why Redux Toolkit.** Boring and mainstream over clever and minimal. The store
is small; the value is that thunks, caching and cross-feature reactions have one
obvious shape instead of four hand-rolled ones. Cost: ~38kB gzipped.

**The boundary is "did it cross the bridge", and it is the whole rule.** Crossed
means a slice; never left the webview means feature context. It earns its keep by
deciding the tempting cases *against* the store: the editor's text looks like app
state, but `db.query` takes a string argument — the extension has never known it
— so it stays in the editor's context until session restore makes it cross for
real.

**What it bought beyond tidiness.** Dispatch is synchronous, so `runQuery` reads
its target off the session instead of being handed it. The old code threaded
`database` through every call specifically to dodge a stale `useState` read; that
class of bug is now unavailable.

**The session is in `app/`, not in `features/connections`.** Every feature reads
the connection and the active database. Putting them in a feature would have made
that feature a hub in everything but name and forced its siblings to import it,
which is exactly what the feature split exists to prevent. Features never import
each other; anything spanning two is wired in `Shell.tsx`.

**Rejected: one slice per screen, and slices reaching into each other.** Both
recreate `App.tsx` with extra steps. Slices react to *events* instead —
`explorerSlice` and `resultsSlice` both handle `session/disconnect`, and neither
knows the other exists.

---

## Saved connections: SQLite on disk, the key in the OS keychain

**Why not the webview.** Encryption only means something if the key is somewhere
the ciphertext is not. The webview has no keychain, so a key it held would end up
in localStorage beside the thing it encrypts — obfuscation wearing a hat. The
extension can reach the OS credential store, so it owns the store outright.

**Why SQLite for the row and the keychain for only the key.** The alternative was
a credential-store entry per connection. One key means one entry to manage and
one thing to lose, and it keeps a connection's password in the same row as the
connection: deleting one cannot strand the other. Host, port and user are not
secret and are queryable as ordinary columns.

**No new dependencies.** `bun:sqlite` and `Bun.secrets` (Credential Manager on
Windows, Keychain on macOS, libsecret on Linux) are both Bun builtins. `keytar`,
the usual answer, is an unmaintained native module.

**AES-256-GCM, not CBC.** GCM authenticates: an edited or corrupted row fails
loudly at the tag instead of decrypting to garbage. There is a test that flips a
ciphertext bit and requires the connect to fail.

**The password never crosses the bridge toward the UI.** The UI gets
`hasPassword`, never the secret — which is why `PasswordUpdate` is a union with a
`keep` arm. The edit form cannot prefill a password it is never sent, so "leave
it alone" has to be sayable as a mode rather than as a value.

**`ServerConfig` vs `ConnectionConfig` is that rule in the type system.** A
server is everything but the secret; only `ConnectionConfig` carries one, and it
only ever travels UI → extension. The session holds a `ServerConfig`, so the
webview structurally cannot retain a password after connecting.

---

## Slices react to "a session opened", not to a connect thunk

**This cost a real bug, caught only by the UI suite.** Adding saved connections
added a second way to open a session. `explorerSlice` matched
`connect.fulfilled` to pick up the database list, so connecting from a saved
connection produced a perfectly good session with an **empty tree** — the
explorer never heard about it. Nothing failed; the tree was just blank.

**Fix.** `sessionSlice` exports `sessionOpened = isAnyOf(connect.fulfilled,
connectSaved.fulfilled)`, and reactors match on that. Adding a connect path —
IAM is next — means adding it to that one matcher.

**The general shape.** A slice reacting to *one thunk* of a multi-path action is
a trap that springs on whoever adds path two. Match the event.

---

## Errors render where the action was taken

**Why.** Failing to list a database's tables used to surface in the results pane,
because one component held every error and the results pane was where errors
went. Nothing chose that; it fell out of all the state living in one place.

The feature split made it visible — routing it back would have meant `results`
importing `explorer` — and the honest fix was to render it under the tree node
that failed, where the tables would have appeared. A collapse-on-error hack went
away with it.

**Consequence.** A tables error is keyed by database (`action.meta.arg`), not
stored bare: a slow failure must not paint under whichever node is open by the
time it lands.

---

## The titlebar is ours, and so is the frame's colour

**Borderless alone is a trap.** Neutralino's borderless mode is
`style & ~(WS_CAPTION | WS_THICKFRAME)`, and Windows hangs edge-resize *and*
Aero Snap off `WS_THICKFRAME` — it only snaps windows it believes are sizeable.
So borderless buys a custom titlebar and silently pays for it with a window that
cannot be snapped or resized at all. Snap is the thing custom titlebars break;
losing it was never an acceptable price.

**Fix.** `window.setSize({ resizable: true })` once at startup puts the bit back.
Verified against the running app: style goes `0x140B0000` → `0x140F0000`, caption
off, thickframe on. It is the one line the whole feature rests on and it reads as
a no-op — it sends the size the window already has, and `resizable` is the entire
point of the call.

**Keeping the frame means Windows paints 7px of it.** With `WS_THICKFRAME` back
and no `WM_NCCALCSIZE` to reclaim the non-client area, Windows draws a `#202020`
band above our titlebar, in an area no webview can paint. That band broke the
"one background" rule, and the OS was the one breaking it.

**So the extension paints it.** `DwmSetWindowAttribute` with
`DWMWA_BORDER_COLOR` + `DWMWA_CAPTION_COLOR` set to `--bg` recolours the frame:
verified on the live window, rows 1–6 go `#202020` → `#111113` and what is left
is a 1px outline, which is the structural language the system already uses. It is
a native call Neutralino does not expose, so it runs in the extension over
`bun:ffi`.

**Which is not the category error it looks like.** The extension is not "the
database process", it is *the process that makes the native calls the webview
cannot*. That is why the connections live there — Neutralino's runtime cannot
open a TCP socket — and it is the same reason the frame paint lives there: the
webview cannot call `dwmapi` either. Read that way, `window.matchFrame` is not a
database command sitting in the wrong place; it is the second instance of the
rule the extension already exists for.

**The UI sends the pid and the colour, and both are load-bearing.**

- **pid.** Neutralino spawns extensions **through a shell**, so the extension's
  own parent is `cmd.exe`, not the window — this was measured, after a first
  attempt using `process.ppid` silently painted nothing. The window is only
  findable via the app's own `NL_PID`, which exists in the webview and nowhere
  else. (The client's `neutralino.d.ts` types it `string`; it is a `number`.)
- **colour.** `tokens.css` is the source of truth for `--bg`, so the UI reads the
  token and sends it. The extension hardcoding `#111113` would be the second copy
  that drifts.

**Cost.** Windows-only, and Windows 11 only — the attribute wants build 22000+.
Everywhere else `applied` comes back false and the band stays, which is a
cosmetic loss and not an error worth showing anyone.

**Still rejected: patching the framework.** Handling `WM_NCCALCSIZE` in a fork is
what Electron does and is the only way to remove even the 1px. It also means
building and vendoring seven platform binaries that `neu update` fetches today,
and maintaining a C++ fork, for chrome.

**Rejected: `setDraggableRegion`.** Neutralino's own draggable-region API calls
`beginDrag` on *pointerdown*, and `beginDrag` hands the window to the OS move
loop, which swallows the rest of the click — so the second press of a
double-click never reaches the webview and double-click-to-maximise silently does
nothing. `useWindowChrome` waits for 4px of travel instead, which keeps a click a
click. The drag still ends in the OS move loop, which is exactly why snapping is
native rather than reimplemented — and reimplementing snap in JS is how everyone
else gets it wrong.

**Reasoned and verified on Windows only.** The config option is cross-platform
and the bar renders anywhere, but the frame bits, the frame paint and the snap
behaviour above are Win32. macOS turned out to have its own version of the
borderless trap, answered by an injected dylib — see "macOS gets its titlebar
from an injected dylib" below.

---

## The icon is a committed PNG, generated from a committed SVG

**Why a PNG at all.** Not taste — `neu`'s exe patcher reads `modes.window.icon`
only if it ends in `.png`, and silently falls back to Neutralino's stock icon
otherwise. An SVG-only icon would look correct in the window and wrong in every
packaged build.

**Why both files are committed.** The SVG is the thing a human edits; the PNG is
what the tooling consumes. Deriving the PNG at build time would mean a rasteriser
(`sharp`, `resvg`) in `devDependencies` — a real dependency, on every install, to
regenerate an asset that changes approximately never. The cost of committing it
instead is that the two can drift, which is why `design-system.md` says so out
loud.

**Rejected: an accent-coloured plate with an `--on-accent` seal.** It is the
primary-button style and it is more visible in a taskbar, but a dark seal on the
accent loses its shape at 16px. Legibility at the size it is actually seen beat
consistency with the button style.

**Rejected: a transparent plate.** Frees the icon from a background colour, but
the seal's light blue on a light desktop or light taskbar is close to invisible.
The dark plate carries its own contrast everywhere.

**Verified end-to-end**, because "the icon looks right" is exactly the kind of
claim that is wrong in the packaged build: the live window's `WM_GETICON` handle
and the icons patched into a copy of the `.exe` were both read back and confirmed
to be this drawing, not the stock one.

---

## The macOS Dock inset is applied in packaging, not baked into the SVG

The source `icon.svg` used to draw its plate at 80% of the canvas, centered,
because macOS composites Dock/Finder icons with that same content box baked into
their own artwork and a full-bleed plate reads larger than its neighbors there.
But every other consumer — the Windows window icon and the taskbar — shows the
icon at native size, so the same margin that fixed macOS read as a shrunken icon
everywhere else.

**Fixed by moving the inset to `scripts/package-macos.sh`.** The committed SVG
and PNG are full-bleed again; the script shrinks a copy to 80% and pads it back
out before handing it to `iconutil`, so `icon.icns` gets the inset and nothing
else does. One drawing, each platform's packaging asks for what it needs from it.

---

## The query pane is Monaco, and the engine names its own dialect

**Why Monaco.** A textarea cannot highlight, number a line or find and replace,
and those are the reasons to open a SQL editor rather than a terminal. Monaco is
the editor from the app this UI already takes its cues from, so the behaviour
people already have in their fingers is the behaviour they get.

**Why the whole editor, ~4MB.** `import 'monaco-editor'` pulls the core, every
basic language and every contribution. The alternative is importing
`editor.api` plus a hand-picked list of contributions, which is smaller and is a
list that is silently one entry short the day someone reaches for Ctrl+/. There
is no network in this app's loop: the bytes are read off the user's disk by the
app that shipped them, so the cost is parse time once, and the languages nobody
opens are lazy chunks that are never fetched. If this is ever revisited, the
reason will be the ~27s build, not the app.

**Rejected: `@monaco-editor/react`.** Its job is loading Monaco from a CDN and
handing you a component. A desktop app must not block on a CDN — the same reason
the font is not fetched — so its one feature is the one thing that must be
switched off, leaving a dependency wrapping a `useEffect` that creates an editor.

**The dialect is data the engine reports.** `db.connect` answers with a
`SqlDialect` and the UI hands it to the editor without reading it. This is the
same rule that already puts quoting in the drivers: the renderer knows engine
*names* and default ports, and the moment it knows that MySQL means backticks
and this grammar, there are two places that have to agree about an engine.

The values are Monaco's language ids (`mysql`, `pgsql`, `sql`), which couples the
protocol to the one editor this app has. Deliberate: the alternative is a lookup
table on each side of the bridge, and two tables are how they disagree.

**`inherit: false` on the theme is load-bearing.** vs-dark does not only define
`string`, it defines `string.sql` — bright red — and `predefined.sql`, magenta.
The SQL grammars postfix every token with `.sql` and Monaco resolves a token to
the *longest* matching rule, so an inherited theme outranks every rule the app
writes, and the editor comes up with red strings no matter what its own palette
says. Found by looking at it; the theme was "defined" and being ignored.

**Cost: the UI suite lost `.editor.value`.** Monaco's text lives in a model, so
there is nothing to read with `.value` and nothing `REACT_SETTERS` can type into.
The app exposes the editor on `window.squealEditor` for the suite to drive. It is
a test seam in shipped code, which is a real cost, and the alternative was
asserting against `.view-lines` — the DOM Monaco virtualises, which can only test
what is currently painted.

---

## Icons are drawn, bundled, and named by kind

**Why not emoji.** The tree's marks were literal characters (`🗄`, `👁`, `▦`) and
the caret a typed `▸`. An emoji is drawn by whatever the OS font decides, in its
own colour and weight: it cannot be sized, cannot be recoloured, and arrived in
colour — so the marks were the only thing in the chrome breaking "chrome is
grayscale" and the app had no say in it.

**Why Remix.** Boring and mainstream over minimal and clever, the same call as
Redux Toolkit. It is MIT, ships per-icon ESM exports with `sideEffects: false`,
and has a glyph for every kind this app has or is about to have.

**Why bundled rather than a font or a sprite fetched at runtime.** The app is
offline-capable — the same reason the font is not fetched and Monaco is not
loaded from a CDN. Tree-shaking is what makes that affordable: the package is a
2.4MB barrel and exactly the four imported glyphs reach the bundle. That was
measured, not assumed (4 components in `index-*.js`, and an unused icon's path
data absent).

**All of them at once, in one change.** Half-converting leaves a drawn icon
beside a typed triangle, which reads worse than all-emoji did — the inconsistency
is more visible than the cheapness.

**`icons.ts` names kinds, not glyphs.** Components import `ViewIcon`, never
`RiEyeLine`. Picking a different glyph for a view, or leaving Remix, is then one
file. It must stay a list of named exports: a `Record<string, Icon>` lookup or a
`export *` defeats the tree-shaking and ships all ~3000.

**Rejected: the set's `size` prop.** It is a hardcoded size in a component, which
is the one thing tokens exist to prevent. `.icon` sizes them from `--icon`
instead — CSS width/height beat the attributes the set writes onto the `<svg>`,
so it wins without `!important`.

**Icons inherit their colour and are never given one.** They default to
`currentColor`, so an icon is the colour of the text beside it and follows it
into hover, `--accent` on an active row, `--red` on a destructive one — without the
stylesheet learning every place an icon can appear. Recolour the row, not the
icon.

**Rejected: `--purple` for views.** Purple is this system's "distinct object
kind" and a view is exactly that, so it was tempting. But the whole complaint was
colour in the chrome the app did not choose, and shape already distinguishes them
now that the marks are drawn — an eye is not a grid. Colour would be decorative
here, which rule 2 forbids.

**The brand mark `◆` was removed.** It was a `--accent` character rather than an
icon — a logo, not chrome — carried in the titlebar and beside the connect
screen's wordmark. But at its size it read as a stray accent dot more than a mark,
and being decorative it carried no meaning to lose: the titlebar keeps its menu,
the connect screen keeps "Squeal". Nothing draws it now. If a mark is ever wanted
again it becomes the seal from `icon.svg`, which is a drawing question, not an
icon-set one.

---

## Browsing a table is its own command, not a query the UI wrote

**Why.** Opening a table used to mean the extension handing the UI a `previewSql`
string with `LIMIT 100` on it, which the UI put in the editor and ran like any
other query. That made "is there more?" unanswerable, so the grid *guessed*:
`rows.length === 100` meant truncated. A table of exactly 100 rows was labelled
truncated and offered nothing, and a table of a million offered no way to row 101.

`db.browse` names a table and an offset instead. The extension writes page N's
SQL, because it is the only side that knows the engine's quoting — and because
paging means authoring SQL, which it may only do for SQL it authored.

**`hasMore` is answered, not inferred, and there is no `COUNT(*)`.** The page SQL
asks for `PAGE_SIZE + 1` rows and drops the extra one before it ships. A full page
proves nothing; a count is a full scan to answer a question one spare row already
answers.

**Rejected: paginating arbitrary query results.** Reaching page 2 of a statement
the user wrote means rewriting it — wrapping it, or bolting on a `LIMIT` it did
not have. An editor that silently runs something other than what is on screen is
the one thing worse than an un-paged grid. Your SQL runs as written, the row count
is the honest answer, and the pager is simply absent. This is the same rule as
"show what the server sent", one level up: do not rewrite the user's input either.

**Rejected: the old `first 100` badge.** It was the guess above wearing a colour.
Nothing renders `--amber` today; the token stays, since warning is a real kind.

**Browsing does not touch the editor.** It is not shyness about clobbering the
text — it is that there is no honest text to put there. Writing page N's SQL into
the editor invites an edit, and an edited statement is one the pager cannot step;
the pager and the text would disagree from the first keystroke. So the grid is
browse's whole surface, and running anything in the editor clears the pager. Tabs
took this the rest of the way: a table opens a bare grid tab, with no editor on
it at all.

**No `ORDER BY`.** Natural order is what the server hands back, and a table with
no meaningful order has no correct one to impose. The cost is real and accepted:
natural order is not *stable* order, so rows written between two page fetches can
shift across a boundary. Ordering by a key we picked would sort the whole table on
every page — paying a scan per page to fix a browse.

**Offset is coerced, not trusted.** It is user-supplied JSON going into a `LIMIT`
clause, and no placeholder can carry one on both engines, so it is forced to a
non-negative integer (`Math.max(0, Math.floor(Number(x) || 0))`) before it is
interpolated. The table name is quoted by the driver for the same reason. This is
the only SQL in the extension built by interpolation; keep it the only one.

**The editor's inbound text flow went with it.** `previewSql` was the only thing
that ever wrote the editor from outside, so `EditorPane`'s feed-the-value-in
effect became a no-op the moment browsing stopped using it, and it is gone rather
than kept as code that cannot run. The lesson it carried is not gone: whatever
writes from outside next — the command palette, SQL formatting, session restore,
all queued in `backlog.md` — must set the value **only when it differs** from
Monaco's own, or it fires on every keystroke and throws the cursor to the top of
the document. `TableInfo.previewSql` went the same way: with the UI naming tables
instead of SQL, nothing read it.

---

## Tabs are in the store, and the bridge test does not decide it alone

`frontend.md`'s rule is "did it cross the bridge": crossed means a slice, never
left means a feature context. A tab's `activeTabId`, `kind` and `title` never
crossed, and they are in the store regardless. That is an amendment, written down
rather than left as a silent exception:

> The bridge test decides **slice vs feature context**. It does not decide
> **store vs nowhere**.

**A key cannot live apart from the values it keys.** A tab's `database` and
`table` crossed — they are arguments to `db.query` and `db.browse` — and
`resultsSlice` is keyed by tab id. Put the ids in a context and the store holds
`Record<tabId, ResultsState>` for tabs it cannot enumerate, validate or collect.

**Thunks cannot read a context.** `runQuery` must read its target database off
`getState()`. Tabs in a context forces a `database` argument back into the thunk,
which the "thunks read their target" decision forbids in one sentence: two
sources for one fact is how they disagree.

**A `features/tabs` context would be a hub.** The picker is the explorer, the
strip is main, the text is the editor, the results are per tab — all three would
import it. That is the `session` argument unchanged.

**Rejected: the tab list in a context, the per-tab database in a slice.** Two
sources for one fact by construction; the store could hold a database for a tab
the context had dropped, and closing a tab would fan out to two owners that do
not know about each other. That is "slices reaching into each other" wearing a
different hat.

**The rule still earns its keep, which is the proof it is not being bent:** per-tab
`sql` stays in `EditorContext`. A tab is deliberately **not one object** — it is a
store row plus a context entry, joined by id. Session restore is still the thing
that would move the text, and it has not happened yet.

**"Three features read it" is not an argument for a slice**, and must not be
written into one as if it were. That is the argument for a slice living in
`store/` rather than inside a feature. `dialect` settles it: one reader, in a
slice anyway, because the extension is what said it.

**What the split costs, and who pays it.** Anything keyed by tab has to be dropped
when the tab closes, and each owner does it by **diffing the store's tab list in
an effect** rather than from the close handler: `resultsSlice` reacts to
`tabsClosed`, `EditorProvider` prunes `sqlByTab`, `EditorPane` disposes models.
Hooking the one handler is the `connect.fulfilled` bug waiting to happen again —
it springs on whoever adds "close others". **"Close others" arrived, and it did
not spring**: both diffing owners needed no change at all, and `resultsSlice`
needed one line only because it is not a component and cannot diff. That is the
rule being paid back the first time it was tested.

**Ids are a counter in state, not `nanoid()`.** The first tab is created from the
`sessionOpened` *matcher*, and a matcher takes no `prepare` callback, so the id is
minted inside the reducer — where a random one is a side effect in a function that
must be pure. `nextId` also **survives a disconnect** while `tabs` does not: reset
it and the next session's first tab is `"1"` again, so a result still in flight
from the last session lands on whatever reused its id.

---

## One Monaco, one model per tab

The editor is created once and owns its DOM. Tabs did not change that: each tab
gets an `ITextModel` and a saved `ICodeEditorViewState`, and switching is
`saveViewState` → `setModel` → `restoreViewState`.

**`setModel` is not `setValue`, and that is the point.** The standing warning
about writing text into Monaco from outside — feed the value in only when it
differs, or it fires on every keystroke and throws the cursor to the top of the
document — never comes up, because nothing writes text. The model is swapped
underneath the editor instead.

**Rejected: an editor per tab (`<EditorPane key={tabId}>`).** It contradicts
"create once" directly, pays a full Monaco construction per switch, and loses undo
history and view state unless they are rebuilt by hand anyway.

**The pane is hidden on a grid tab, never unmounted.** Not a preference: every
tab's model hangs off the one instance, so unmounting runs the cleanup's
`dispose()` and takes the lot — every other tab comes back empty.

Three things fall out of that and are each invisible until they bite:

- **The dialect is set on every model**, not the attached one, or a background tab
  comes back highlighted as plain SQL.
- **`layout()` before `restoreViewState`.** While hidden, `automaticLayout`'s
  observer reported 0×0 and has not fired again by the time the switch effect
  runs; a scroll offset restored against a 0-height viewport is silently lost.
- **The window Ctrl+Enter listener is live on a grid tab**, because the pane is
  mounted, so it refuses for itself. Today it would also no-op by accident — the
  tab's text is `''` and the thunk's `condition` rejects it — and an accident is
  not a reason.

**"Hidden, never unmounted" is about the editor box alone, and the toolbar above
it was quietly swept in.** One rule hid both (`.main--grid .toolbar, .main--grid
.editor`), which read as symmetry and was a bug: the toolbar sets `display: flex`
inline like every other layout in this app, and an inline style outranks a class
selector, so the rule only ever did anything to the editor. The toolbar stayed up
on a grid tab, kept occupying a row in the shell's grid — which defines two rows
there, not four — and pushed the results pane into an implicit auto row, where it
stopped filling the height. Two complaints, one cause.

The toolbar is now simply not rendered on a grid tab. It holds no Monaco state, so
it never had the reason the editor box has, and unmounting it is both correct and
the thing a reader expects. **The general rule the near-miss leaves behind: if
something is hidden by CSS, it may not set `display` inline** — and reach for not
rendering it first, because "hidden" is a workaround Monaco earned and nothing
else in the app has.

`window.squealEditor` needed no change and stays singular: one editor, one seam.
It holds no model while a grid tab is showing, so the UI suite's reads guard —
which is itself the assertion that a grid tab really has no editor on it.

---

## Workspaces group connections, and carry nothing else

**Why.** Saved connections were one flat alphabetical list, but they were never
one flat set: a connection belongs to a project, and a project has the same
servers again in each environment. A list mixing every project together buries
the four that are relevant.

**A workspace groups and has no behaviour.** Nothing about connecting reads one;
a connection works identically whichever it is in. The only rule that follows
from grouping at all was the one it used to enforce: **a connection's name is
unique within a workspace, not across the app** — otherwise `api` in Dev and
`api` in Production, the exact case the feature exists for, could not coexist.
That rule is gone too now, and a workspace enforces nothing at all; see *A
connection's name is a label, not a key* below.

**Environment is a field on a connection, from a fixed set.** Free text gives you
`prod`, `Prod` and `production` as three groups, and the point is headings that
mean the same thing in every workspace. Any number of connections per
environment, not four slots. User-extendable is a later question.

**It is a grouping, not a step.** Pick a workspace, then see its connections under
their environment headings — two screens, not three. An environment with nothing
in it has no heading: a heading over nothing announces four groups to someone who
has one, which is the flat list's problem wearing a hat.

**One workspace skips the picker, so the whole feature can be ignored.** A first
run has a `Default` workspace and lands exactly where it used to. **That is only
safe because the picker stays reachable** — `.ws-bar` names the workspace you are
in and is the route to it. Skip it *and* hide it and a first-run user can never
reach the screen that makes a second workspace; the feature would be unusable by
anyone who did not already have two.

**Deleting a workspace cascades, behind a confirmation that counts.** Rejected:
*refusing while non-empty*, which makes deleting a finished project a chore of
deleting its connections first; and *moving them to the default*, which cannot
answer what to do when the name already exists there. The cascade takes stored
passwords with it, so the confirmation names how many rather than just "Delete?"
— in the armed delete button's tooltip now, see the note below, but the count
itself is unchanged. The store deletes the rows explicitly inside a transaction
rather than leaning on `ON DELETE CASCADE` alone — the FK stays for making an
orphan unwritable, which is a different job.

**A workspace's or connection's delete is a trash icon armed by a click, not a
Yes/No pair.** The row's actions used to swap `Edit`/`Delete` for a `Delete?`
label plus `Yes`/`No` on the first click — a second menu for what is really one
decision landing on one control. It is now a single button: unarmed it reads
`Delete` and does nothing destructive, a first click arms it (red fill, the
tooltip says `Click again to delete`, and the workspace row's tooltip folds the
connection count into the same sentence rather than a second line), and a
second click on that same button commits. Leaving the row (`onMouseLeave`)
disarms it, so an armed button is never left behind for a later, unrelated
click to land on. Rejected: a timeout to auto-disarm, which would either fire
too early for someone reading the tooltip or too late to mean anything as a
safety net.

**The last workspace cannot be deleted.** A connection hangs off a workspace, so
an app with none has nowhere to save one. Refused in the store, and the UI does
not offer the button — the guarantee is the store's, but nobody should have to
meet it.

**Existing connections migrate to `Default` / `local`.** SQLite cannot drop a
constraint and the old `UNIQUE(name)` is now wrong, so the table is *rebuilt* in
a transaction rather than altered. `local` because nobody said what those
connections are, and the guess that costs least never labels an unclassified row
Production — which matters more the moment read-only-by-default and the
environment-coloured rail land on top of it.

**The screen derives from the data, and deleting has to pin it.** `ConnectScreen`
picks its view from "how many workspaces, how many connections" while nothing has
navigated — which is right for the launch screen and wrong the moment a delete
changes those numbers. Deleting the second-to-last workspace re-derived the view
and dropped the user into the survivor's connection form mid-click. **The UI
suite caught this; reading the code did not.** Both delete handlers now pin the
screen before the delete lands.

**Rejected: a `currentWorkspaceId` in the store.** Which workspace you are in *is*
which screen you are on, and the screen already had to be state. A second field
holding the same fact is two things to keep in step — and it never crossed the
bridge, so it has no business in a slice either.

**The icon set is data, which makes it the one legitimate icon lookup.** See
`design-system.md`: the ban on a `Record` of icons is about the 2.4MB barrel, and
nine glyphs imported by name do not reach it. The set is deliberately disjoint
from the chrome's own so a workspace never wears a table's glyph.

---

## SSL is one boolean, and it means verified

**Why a boolean and not a mode ladder.** Postgres spells this as six `sslmode`s
and MySQL has its own set. A neutral three-mode enum (`disable` / `require` /
`verify-full`) was the alternative and was rejected: the middle rung is the only
thing it adds, and the middle rung is the one nobody should pick. `require` means
*encrypted against an observer and wide open to anyone in the middle of it* — it
is the mode that exists because verification used to be hard, and offering it is
offering a footgun with a reassuring name.

`allow` and `prefer` were never candidates. They downgrade to plaintext silently
when TLS fails, which is the one behaviour this app cannot have, and mysql2 has
no equivalent to map them onto — so the enum would carry values one driver had
to fake.

**So checking the box means verified, and there is nothing to turn off.** This is
the same rule as "show what the server sent", one layer down: a connection that
reported "SSL" while guaranteeing nothing about who was on the other end would be
lying in exactly the way a timezone-shifted `Date` lies. It is also why GCM beat
CBC in the entry above — fail at the tag, loudly, rather than decrypt to garbage.

**The cost is real and was accepted knowingly.** With no way to name a CA yet,
RDS and every private CA are unreachable with SSL on. The failure is a refused
connect that says why, which is the honest version of this limitation; naming a
CA file is a backlog item. The temptation, when someone hits it, will be to add
`rejectUnauthorized: false` behind a second checkbox. That is the thing this
entry exists to refuse.

**Off is what a connection that predates the column becomes**, and not merely
because it is the SQLite default. Those rows connect in plaintext today, so
anything else migrates a working connection into a broken one — every row at
once, on the launch after an update, looking exactly like the server having gone
rather than the app having changed its mind. Same reasoning as `local` for a
migrated environment.

**Plain `ADD COLUMN`, not a rebuild.** The workspaces migration rebuilds the
table because `UNIQUE(name)` became wrong and SQLite cannot drop a constraint.
Nothing became wrong here; a column is simply missing. Rebuilding would put every
stored password through a copy to achieve it.

**`rejectUnauthorized: true` is written out**, though both libraries would pick
it themselves. It is the whole meaning of the flag, and a default that moved in a
minor version would flip verified TLS to unauthenticated silently — and looking
identical to success. Stating it in one shared constant is also what stops the
two engines drifting apart on it.

**Measured, because "SSL is on" is exactly the claim that is wrong in the
packaged build.** Against the real fixture servers: pg with `ssl` on gets *"the
server does not support SSL connections"* — refused, not downgraded. MySQL 8
generates its own certificate and gets *"self signed certificate in certificate
chain"* — refused, which is the trap working; a laxer client connects there and
calls it SSL. Trust that CA via `NODE_EXTRA_CA_CERTS` and the same code connects
with `Ssl_cipher = TLS_AES_128_GCM_SHA256`, per the **server's** own status
variable rather than the client's word for it. One variable changed: trust.

**The surprise, which is not fixed:** mysql2 checks the chain and **not the
server's identity**. That MySQL certificate is `CN=MySQL_Server_8.4.10_Auto_
Generated_Server_Certificate` with no subjectAltName, and it satisfies a
connection to `127.0.0.1`. pg passes `tls.connect` a `servername` and is expected
to check identity, which the fixtures cannot confirm — so "verified" is worth
more on one engine than the other, and the app cannot currently tell you which.
That contradicts "the UI cannot tell engines apart, so anything asymmetric is a
bug", and it is recorded here rather than papered over. Forcing `servername` on
mysql2 would close it and would also refuse the self-signed local server above,
so it is a real change with a real cost, not a one-liner. The UI's copy is
deliberately written to be true of both: the certificate is one this machine
trusts, and no promise is made that the server proved *which* server it is.

---

## Completion: the grammar's words and the server's catalog, and nothing guessed

**This reverses "there is no autocomplete, so nothing may be offered".**
`quickSuggestions` and `suggestOnTriggerCharacters` were off, and the entry below
them said word-based suggestions were off "until it can ask the database". It
can, so they are on. **Word-based suggestions are still off, permanently**: they
offer the identifiers already in the document, which is a schema-blind guess
dressed as knowledge. That was never a stopgap — it was the same rule as "show
what the server sent", one level up, and having something real to offer is what
retires the *stopgap*, not the rule.

**The two halves are the bridge test, drawn through one popup.** `SELECT` is the
grammar's word and never crossed; `email` is the server's and did. So the words
come from Monaco's own grammar modules and the catalog comes from a slice, and
neither is invented in between.

**The words are read out of the grammar rather than typed out.** Monaco ships a
grammar per dialect and no completion provider: it knows `SELECT` is a keyword
well enough to paint it and will never offer it to you. Importing
`basic-languages/*/mysql.js` for the very list the tokenizer uses means a word
the editor highlights is a word it suggests, with no second list to drift from
the first. The cost is an import past the package's entry point at a file with no
types — declared in `src/monaco-languages.d.ts`, the same shape of problem as
`neutralino.d.ts`. *Rejected: writing out a good-enough set of SQL words*, which
is the drift being volunteered for.

The one asymmetry: `AND`, `IN`, `LIKE`, `NOT` and `JOIN` are in the grammars'
`operators`, not `keywords`, so the obvious `keywords`-only read offers `SELECT`
and not `AND`. `monaco.ts` already pays for this exact quirk.

**Rejected: a SQL parser.** The text is a query *being typed* — half a statement,
an unclosed paren, a `FROM` with nothing after it yet. A parser answers "not
valid SQL" for almost every keystroke that matters, which is precisely when the
popup has to have an answer, so it would have to be error-recovering, per
dialect, a dependency, and still wrong about the same partial text. `sqlScope.ts`
is a regex, it is right far more often, and its failures are the harmless
direction: a suggestion missing, never a wrong one. **The line that keeps this
honest is that nothing but suggestions may lean on it** — it never decides what
runs. It does not strip comments either, so a `-- FROM users` contributes a
table; the cost is one name in a popup.

**Columns are fetched when a table is named, not when the dot is typed.** By the
time you type `.` after `users` they have to be *there*; starting then buys an
empty popup and a round trip. So the scan runs per keystroke and dispatches
`loadColumns` for whatever is in the `FROM` — which is only affordable because
the thunk marks a table asked **before its first await**. Without that the
`condition` is not enough: two keystrokes in a row both pass it and both fetch.
A failure leaves the marker, so a table is asked exactly once, ever; a retry per
keystroke against a server that says no is worse than no suggestions.

**`db.columns` answers `[]` for a table that does not exist, and that is load-
bearing.** The caller reads a query as it is typed, so it asks about `use` a
keystroke before `users`: a name that is not a table is the *normal* case. Both
engines do this for free and there is a test pinning it, because turning it into
a throw means the editor erroring on every keystroke.

**Bare columns are offered, not only qualified ones.** The backlog item asked for
`u.` → columns; `SELECT ema…` after `FROM users` offering `email` is the case the
feature is actually for — demanding `users.email` first asks the reader to type
the thing they came here not to remember. The columns are already fetched and
cached by the scan, so it costs nothing.

**The column cache is keyed by connection, and the tree's is not.** Chosen
knowingly: `tables` carries no connection so it must be wiped when a session
opens, while `columns` names one and has nothing to clear. Two connections both
holding an `app` is the collision it refuses — unreachable at the time, since
only one connection could be open and a disconnect reset the slice anyway.
*Rejected: keying it by database to match the tree*, which would have been
consistent and would have had to be unpicked by the multiple-connections work;
that item moved `tables` to this shape instead, exactly as forecast. See
*Multiple connections*, below.

**Monaco's relevance beats `sortText`**, so `FROM user|` offers the `user`
keyword above the `users` table — an exact prefix match outranks the group.
Accepted: the groups are for ties, and fighting Monaco's ranking to reorder a
list the next keystroke fixes is not worth a special case.

**Verified against both real servers and the real window.** `format_type` and
`COLUMN_TYPE` were read back off the fixtures rather than trusted (`varchar(50)`,
`timestamp with time zone`, `bigint` — including the view and
`reporting.daily_stats`). The UI suite drives the popup on both engines, and
`ILIKE` is the pair that makes it mean something: Postgres offers it, MySQL must
not, so the words are demonstrably the dialect's and not one list. The widget's
`box-shadow: none` and its `--bg`/`--border-strong` were read off the live DOM,
because "it looks right" is exactly the claim that is wrong in a build.

---

## Multiple connections, and what "a session opened" came to mean

The extension needed nothing: `establish` already minted a UUID per connect into
a map, and every command already took a `connectionId`. The whole feature was the
UI catching up with a registry it had been talking to all along.

**The load-bearing part was not the rail.** `sessionOpened` meant *wipe every
slice* — `tabs` cleared, `explorer.tables` emptied, `results` reset to initial —
and `disconnect` meant *reset to initial*. Both are correct only while one
connection can be open, because then "a session opened" and "the last session
ended" are the same instant. They are now two events, and every one of those
reducers inverted: opening adds, disconnecting drops **that connection's** rows
and no others. Nothing about this is visible in a type; each one is a slice that
would silently take the other servers down with it.

**A tab carries its `connectionId`, and thunks read the connection off the tab.**
`runQuery` and `browseTable` used to read it off the session, which is "whatever
the rail points at *now*". The strip only draws the active connection's tabs, so
the two agree today and the bug is not currently reachable — it is still wrong,
and it is wrong in the direction where the tab looks identical and the server
underneath it is not. The tab is the target; the session is a pointer.

**`tabs` is flat and `nextId` is global**, both for one reason: `results` is
keyed by a bare tab id. Nesting tabs under their connection, or numbering them
per connection, would put the connection in one key and not the other — the exact
disagreement the two explorer caches had to be talked out of. `nextQueryNo` *is*
per connection, because it is a label rather than a key: a second server's first
query is Query 1.

**`--env-*` is its own ramp, not the semantic hues.** Four environments needed
four colours and every hue was spoken for — red is error, green is success, amber
is warning. Colouring QA green would have it mean "success" in the one place
it must mean "QA". Same argument, and the same shape, as `--syntax-*`: a
string is not a success and an environment is not a status, so retuning `--red`
for a callout must not repaint the rail. They land on the same Radix steps today,
which is not the same as being the same token. *Rejected: Production red and the
rest grayscale* — cheaper, and it makes "which of my three dev boxes is this"
unanswerable, which is the question the rail exists for. The order is the ramp
(neutral, go, caution, danger) so that the colour means something rather than
decorates.

**The environment is asked for even when nothing is saved**, reversing the
connect form's own rule that an unnamed connection "is never in that list, so it
has no environment to be true of". True while an environment was only a heading
in a workspace's list. It is the rail's colour now, and every open connection is
on the rail — and the connection you opened once by hand to check something is
exactly the one worth colouring red.

**The rail is the reference's icon rail, un-dropped.** `design-system.md` listed
it under *Dropped* with the reason "this is a two-pane app with nothing to
navigate". That was true and is not. It came back at 44px rather than 68px and
without the flyout, which is the design system's own instruction being followed:
*add the component, do not redesign*.

**The rail names the connection; the titlebar names the server.** Two facts, so
neither repeats the other — the same split as the titlebar naming the server
while the sidebar's picker names the database. *Considered: dropping the
titlebar's label* on the grounds that the rail had taken it over; it had not,
because a name and a `user@host:port` are different things and an ad-hoc
connection has only the second. The rail says which, the titlebar says what.

**`connected` stopped being the whole of routing.** The rail's "+" must reach the
connect screen with connections still open, so "there is a connection" and "show
the shell" became different questions. `adding` is local state in `App`: it never
crossed the bridge, and it is not a key anything crossed is held under. It is
dismissed by watching `activeConnectionId` change rather than by hooking the
connect handler — there are already two connect paths, and a third would have
been a third place to remember.

**Verified against both real servers.** The fixtures are what made the headline
bug testable: both seed a database called `shop`, and only Postgres's has
`reporting.daily_stats`. The UI suite opens both connections and asserts MySQL's
`shop` does not offer it. That test was then run against a deliberately
re-broken cache — keyed by database alone, as it used to be — and it failed with
MySQL's tree listing `reporting.daily_stats`, which is the original bug exactly.
A test for a cache key that has never been seen to fail is a test that proves
nothing.

---

## SQL formatting is Monaco's Format Document, backed by sql-formatter

**Why.** Monaco already ships a Format Document action — bound to Shift+Alt+F,
sitting in the context menu, and reachable from any command palette added later
— and it does nothing until something registers a formatter for the language.
So the whole feature is one registration: `useSqlFormatter` registers a
`DocumentFormattingEditProvider` per dialect, and the toolbar's *Format* button
runs that same `editor.action.formatDocument`. The button, the shortcut and the
menu entry are one action rather than three that could drift.

**sql-formatter, not a formatter of ours.** It knows both engines' dialects and
is battle-tested; writing one would be re-deriving a SQL parser to indent text.

**Keywords are uppercased; nothing else is.** `keywordCase: 'upper'` touches
SQL's own words and leaves identifiers, string literals and everything the server
named exactly as written. That is the value-handling line drawn one field over:
casing a keyword is presentation, casing anything the database gave us would be
the same class of lie as a shifted date.

**The dialect is adapted in exactly one place.** sql-formatter names Postgres
`postgresql`; the protocol carries `pgsql` for Monaco's sake. `format.ts` holds
the one map from `SqlDialect` to sql-formatter's language — the same shape as
`keywords.ts` reading the grammar. *The extension must not grow a second dialect
field to feed the formatter*: it reports one dialect and both the editor and the
formatter read it, or the two tables disagree the day an engine is added.

**A parse error is a no-op, not a popup.** sql-formatter throws on input it
cannot parse — a half-written statement, a quirk it does not cover. The provider
catches and returns no edits, leaving the text exactly as typed. Surfacing the
parser error would be Monaco popping a notification about a query the user is
still writing; saying nothing is the honest answer to "I could not format this".

**It writes through an edit, not `setValue`.** The provider returns a full-range
replace, which Monaco applies as an edit, so the change flows *out* through
`onDidChangeModelContent` like a keystroke. This is the "text flows one way: out"
rule holding on the first outside writer the editor grew — reaching for
`setModel`/`setValue` here would be the cursor-to-top-of-document trap.

---

## Read-only is the server's refusal, applied per client

**Why the server and not us.** The point of read-only is that nothing of ours
decides what is a write. Both engines have a session read-only mode
(`SET SESSION TRANSACTION READ ONLY`, `SET SESSION CHARACTERISTICS AS TRANSACTION
READ ONLY`), so the engine refuses the `UPDATE`, the CTE that writes, the
procedure that writes — there is no SQL of the user's for a parser of ours to be
wrong about. *Rejected: inspecting the statement.* A read-only mode you enforce
by reading the SQL is one a `WITH ... AS (DELETE ...)` walks straight through, and
being confidently wrong about that is worse than not offering it.

**It is not a security boundary, and the docs say so out loud.** Neither engine's
read-only session reliably covers DDL — MySQL's does not, and the two differ — so
a genuinely locked connection needs a read-only database *user*. This feature is
about the stray `UPDATE` against the wrong tab, not about making a server safe
from someone trying. Claiming more would be the timezone-`Date` lie one layer up:
a guarantee that is not one.

**Per client, and reaching the ones opened afterwards, is the whole
implementation.** A connection holds one client per database (see the
client-per-database rule), and the mode is per client. So a toggle reaches every
open client *and* the handle remembers it so every client opened later is born
read-only. Missing the second half is invisible until someone switches to a
database they had not opened yet and the connection is quietly writable again —
which is exactly the accident the feature exists to prevent, reintroduced by the
feature. There is a test that opens read-only and writes to a database opened
*after* the connection was, on both engines.

**The Production default lives in the UI, not the extension.** The extension is
told a boolean and obeys it — `db.connect` and `db.saved.connect` both carry
`readOnly`, and `db.readonly` toggles it live. "Production defaults to read-only"
is a policy about environments, and the environment is the UI's for the connect
path (it never crosses for an unsaved one). Putting the policy in the extension
would be a second place that has to know what Production means. The stored bit is
the row's, echoed back like `environment`; the extension carries it, and here
uniquely also acts on it.

**Persisted like `ssl`: a column, a plain `ADD COLUMN`, defaulting off.** A row
that predates read-only connected read-write, so any other default breaks a
working connection on the launch after an update — the same argument as `ssl`
off and `local` for a migrated environment, and downgraded from the live store in
the same test.

**The first modal in the app, and it is allowed to float.** `SavedConnectionList`
records why the app had no modal: a saved connection is cheap enough to lose that
an overlay costs more than the mistake. Leaving read-only inverts that — the thing
guarded is a stray write against production, which is neither cheap nor undoable.
So `ReadOnlyConfirm` is the one overlay, and it obeys the design system rather
than bending it: the card is outlined with `--border-strong`, not raised with a
shadow, the same as the menu and the find widget. The one new device is the
scrim (`--scrim`), which is not a lighter surface *inside* the app breaking "one
background" — it is the app itself pushed back so a blocking dialog reads as
blocking.

**Locking is free, unlocking costs, and the cost is uniform.** Turning read-only
*on* is the safe direction and is immediate. Turning it *off* asks the
environment's name typed back — for every environment, not just Production.
*Rejected: only Production demands it.* The muscle memory of clicking through the
confirmation is what makes an accident, and a Local connection that trains you to
click through without reading is training you for the Production one. The friction
is the point, and it has to be everywhere the habit forms.

---

## Releases: release-please on `dev`, and the build rides the same run

**Conventional commits, read straight off `dev`.** The app version lived in two
files — `package.json` and `neutralino.config.json` — with nothing keeping them
in step. release-please owns both now: `release-type: node` bumps the package and
an `extra-files` JSON updater bumps `neutralino.config.json`'s `$.version` in the
same release. Commits go directly to `dev` in conventional format; the only PR is
the release PR release-please raises itself. *Rejected: syncing the workspace
`package.json`s too* — they are private and unpublished, so their version is
cosmetic, and the drift the item named was the two files that are "the app
version", not those.

**Why the build is a second job, not an `on: release` workflow.** A Release
created by the default `GITHUB_TOKEN` deliberately does not trigger further
workflows — GitHub's recursion guard — so an `on: release` build would silently
never fire. Gating a downstream `build` job on
`release-please.outputs.release_created` keeps it in the same run and needs no
personal access token. This is the exact "a path that never fires looks identical
to one that passed" trap the codebase keeps hitting; here it is prevented rather
than discovered.

**The extension is compiled, not shipped as source.** `neu build` copied
`extensions/` verbatim, so a packaged app shelled out to `bun` on the user's PATH
and looked for its deps in a `node_modules` full of Bun symlinks that the copy
into the bundle broke. The result launched and then hung: the extension process
died on its first `import`, and the UI sat on the 15s `extensionReady` timeout
showing "the database extension failed to start". `bun build --compile` folds the
runtime and every dependency into one native binary the config runs directly — no
PATH dependency, no `node_modules` to break. *Rejected: bundling a standalone Bun
binary + a dereferenced `node_modules`* — same number of moving parts, still two
things to keep in step, and it leaves the raw source in the bundle. The compiled
binary is per-OS, so each release runner builds its own; the build then slims
`extensions/db` to just that binary, which also retires the Windows
admin-shell/`EPERM` requirement (no symlinks left to copy).

**The Windows extension `command` must use backslashes.** With the program a bare
executable path rather than `bun.exe` with an argument, a forward-slash *absolute*
path (`C:/…/squeal-db-ext.exe`) silently never spawns — Neutralino runs, the
process never appears, and the app hangs on the readiness timeout. The Windows
`command` uses `${NL_PATH}\extensions\db\squeal-db-ext.exe`; macOS/Linux keep
forward slashes. This cost a full round of "the binary is fine, so why won't it
start" before the process-list showed it was never launched at all.

**The binaries ship, Windows verified and installer-backed; mac/Linux still not.**
Windows now launches and connects from a packaged build, and the build also emits
an Inno Setup Setup.exe beside the portable zip (the installer is the path the
auto-updater will lean on). macOS and Linux have still never been launched, so
their binaries remain unverified; `fail-fast: false` keeps one platform's failure
from withholding the others. Chosen over waiting for all three: a release that
works on the one verified platform beats a manual one that drifts its two version
files.

---

## The updater is user-initiated, applies through the installer, and verifies twice

**Why it checks but never acts on its own.** A stale install is the failure the
feature exists to fix, so the app asks GitHub for the latest release on launch.
But an app that downloads and swaps itself unbidden is a worse failure than a
stale one — so the check is the *only* thing that happens without the user. It
finds; the banner offers; nothing downloads or restarts until the user says so.
A check that finds nothing, is offline, or is rate-limited says nothing at all:
it reports `hasUpdate: false`, never an error, because an update the user did not
ask about must not surface as a failure they did not cause.

**Why the whole app, not the resources.** Neutralino ships a resources-only
updater, and it is not enough: the native binary, `resources`, and the compiled
Bun extension can each change between versions. So the unit that is replaced is
the whole install, which is exactly what the Inno installer already does.

**Why the installer is the swap mechanism.** Windows cannot overwrite a running
`.exe`, so something other than the app has to do the swap. The release already
carries a Setup.exe, and Inno's Restart Manager closes the running instance (and
its extension), replaces every file, and relaunches — the "helper that swaps the
files" the backlog asked for, already built and already shipped. `update.apply`
launches it detached (`cmd /c start`, so it outlives the app) with
`/SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS`, then the UI exits. *Rejected: a
bespoke helper unzipping the portable build over the install* — same swap, but
re-derived, and it leaves the installer that already does it unused.

**Why it lives in the extension.** Reaching GitHub, streaming a download to disk,
verifying it, and launching a process are all native calls the webview cannot
make. This is the same rule the connections and the frame paint already follow:
the extension is the process that makes the calls the webview cannot, and the
updater is the third instance of it, not a database command in the wrong place.
The UI only asks and shows state. `update.progress` is the one broadcast that is
not a reply to a request — a download outlasts a single call, so the bar fills on
its own channel while the call resolves separately.

**Why two checks, and in this order.** The backlog set the bar: a checksum
against a *corruption* and a signature against a *forgery*, and neither alone is
enough — a checksum proves the bytes arrived intact, not that they are the
maintainer's, and a signature is the expensive check to run on a truncated file.
So the app verifies SHA-256 first (cheap, catches a bad download) then the
signature (proves origin), and **both must pass or nothing is staged** — an
unverified download is discarded, never offered for apply. `verifyEd25519` fails
closed on a bad key, a bad signature, or an empty baked key, because a
verification that throws its way to "true" is worse than none.

**Why detached ed25519 over Authenticode.** Authenticode is the "right" Windows
answer and also clears SmartScreen, but it needs a real code-signing certificate
that carries cost and lead time — and it would need `WinVerifyTrust` or a shell
out to `signtool` to check. A detached ed25519 signature is verifiable with
`node:crypto` and no dependency at all, free, and shippable today. So the app
verifies a `.sig` asset against a public key baked into the build
(`updateKey.ts`); the private key is a GitHub Actions secret and lives nowhere
else. Authenticode is a later upgrade layered on top, not a replacement for this.

**Why the public key is committed empty.** `keygen.ts` mints the pair, writes the
public key into the committed constant, and prints the private key for the
operator to store as `UPDATE_SIGNING_KEY`. Until that is run the constant is
empty and verification fails closed — no update can be applied — which is the safe
default. The CI sign step is guarded on the secret being set, so a release still
cuts before the key exists; it just carries no update assets, and a newer release
without its signing assets is not offered. The one manual step the feature has —
run `keygen.ts`, commit the public key, set the secret — keeps the private key out
of the repo entirely, which is the whole point of splitting the pair.

**Why Windows-only for now.** The swap-on-restart flow leans on the Inno
installer, and Windows is the only platform that installer, and the app itself,
are verified for. Off Windows `update.check` reports `supported: false` and the
banner never appears — the same shape as `window.matchFrame`'s `applied: false`,
a capability quietly absent rather than an error. macOS and Linux get an updater
when they get a verified build to update.

**Why the current version is injected, not read at runtime.** The compiled
extension carries no `neutralino.config.json`, so it has no version to read. Vite
bakes the root package.json's version — the one release-please bumps in lockstep
with the config — in as `__APP_VERSION__`, and the UI passes it to `update.check`.
The version is fixed the moment the frontend is built, so a constant is the honest
shape, not a lookup.

**The releases have to be public, and this was found the hard way.** The check is
an *unauthenticated* fetch — no credential may ship in an app handed to users, or
it hands every user that credential — and GitHub answers `releases/latest` with a
**404** for a private repo, not a 403. So while the repo was private every check
came back empty and the app reported "you're up to date" against a release it
literally could not see. A private repo's assets are not downloadable without auth
either. The repo was made public; the alternative is publishing the installer, its
signature and a version manifest to a public channel (a releases-only repo, Pages,
S3) and pointing the updater there. Either way the updater's premise is a *public*
source of releases, which is not a code decision but a distribution one.

**Which is why `checked` exists.** The 404 above returned `hasUpdate: false` —
indistinguishable from a genuine "nothing newer" — so a manual "Check for updates"
cheerfully said "you're on the latest version" while it had reached nobody. The
status now carries `checked`: false when the request failed at all, and the UI
draws "Couldn't check for updates" for a manual check rather than the up-to-date
note. A failed check stays silent on *launch* as before; the honesty is owed only
to the user who asked. "You are current" and "I could not check" are different
answers and must read differently — the same rule as never reporting a shifted
`Date` as the stored one.

---

## AWS IAM auth is a config variation, not a new connect path

**Why it is not a new command.** The obvious shape for "a new way to connect" is a
third connect command beside `db.connect` and `db.saved.connect`, and the
`sessionOpened` decision even names IAM as the next one to add to its matcher. It
turned out cheaper to make it *not* a new path: an IAM connection is an ordinary
`ServerConfig` with an `iam: { profile, region }` on it, so it rides `db.connect`
(ad-hoc) and `db.saved.connect` (saved) unchanged, and no thunk, matcher or slice
learned a new case. The one thing the extra path would have bought — a place to
mint the token — is a two-line branch in `getClient` instead. `sessionOpened`
stayed a two-thunk matcher.

**The token is the password, minted per client and never stored.** RDS IAM auth
*is* password auth where the password is a signed, ~15-minute token. So the token
is resolved in `connection.ts::getClient` and handed to the driver as
`config.password`; the drivers never learned IAM exists. It is minted **per client
opened**, not once at connect, because a connection opens a new client each time
the user visits an untouched database (the client-per-database rule) and that can
be long after the token that connected would have expired. Minting again is
affordable because it is a *local* SigV4 presign over cached credentials — the
same reason browsing re-asks the server rather than caching rows: cheap and always
current beats stored and stale. What is stored is only the profile and region;
the token never touches the SQLite file or the bridge.

**Its presence is the auth method — there is no `auth_method` column.** `iam`
being set is the whole discriminator, top to bottom: `aws_profile`/`aws_region`
on the row, `config.iam` in the protocol, `form.authMethod` in the UI. A separate
`auth: 'password' | 'iam'` flag would be a second thing saying what these already
say — two sources for one fact, which is the disagreement `tabs`, the caches and
the read-only bit were each talked out of. The two AWS columns are set together or
not at all, so `aws_profile` alone is the test everywhere it is read.

**IAM carries TLS with it, verified against Amazon's own bundled RDS CAs.** An IAM
token is a bearer secret, so sending it plaintext hands it to anyone on the wire —
`openConnection` refuses `iam && !ssl` and the connect form forces the box on and
disables it.

**This reverses the first cut, which reused the OS trust store, and did so
because that cut failed in practice.** The bet was that modern RDS certificates
chain to Amazon Root CA 1, which a default trust store carries — so IAM could ride
the existing verified-TLS flag with no bundled CA. It does not hold: RDS presents
certificates signed by Amazon's *own* RDS authorities (`rds-ca-2019`,
`rds-ca-rsa2048-g1`, …), whose roots are in neither Node/Bun's bundled Mozilla set
nor, for a direct DB socket, the OS store — so a real RDS connect came back
`unable to get local issuer certificate`, exactly the "silently doesn't deliver"
risk the choice was known to carry. The fix is the option that was deferred:
`rds-global-bundle.pem` (Amazon's published bundle of every RDS regional CA) is
committed and folded into the compiled binary, and `drivers/common.ts::tlsOptions` makes
it the `ca` for an IAM connection. `rejectUnauthorized` stays on — it is the
*trusted set* that changed, not whether trust is checked, so an RDS certificate
now verifies without weakening anything.

**Only IAM gets the bundle**, not every SSL connection. A password connection may
be reaching anything, so it keeps the machine's trust store; the RDS bundle is
added exactly where the target is known to be RDS. Trusting Amazon's roots for
*all* SSL connections would be a wider change than IAM needs, and the general
"name a CA file" backlog item is still the home for reaching an arbitrary private
CA. The one thing that shipped here is the RDS-specific anchor IAM cannot work
without.

**An expired SSO session says "log in again", not "access denied".** This is the
one behaviour the backlog item insisted on: a lapsed SSO token must not surface as
a database error. `iam.ts::mapAwsError` catches the SDK's credentials failure and,
when it is an expired/absent SSO session, rewrites it to name `aws sso login
--profile X`. Because the first client opens eagerly in `openConnection`, this
lands as a failed *Connect* with an actionable message, not a mystery later in the
tree — the same "surface it where the action was taken" rule the eager connect
already serves. Detection is best-effort on the SDK's error name and text (there
is no stable typed code across the provider chain); the fallback still carries the
raw message with context rather than swallowing it.

**Why `@aws-sdk/rds-signer`, a real dependency.** Mainstream over minimal, the
same call as Redux Toolkit and Remix. The token is a SigV4-signed presigned URL,
and hand-rolling that against `node:crypto` is exactly the "wrong in a build,
invisible to a mock" class this codebase avoids — while the SDK also resolves and
*refreshes* the SSO-backed profile for free (`fromIni`), which is most of the
feature. The feared cost — bulk in the compiled binary — did not materialise:
measured, the `bun build --compile` output grew ~0.8MB (95.3 → 96.1MB), because
tree-shaking keeps only the signer and the credential chain, and the binary is
already ~95MB of Bun runtime regardless. The sprawling *unbundled* `node_modules`
footprint never ships. *Rejected: shelling out
to the AWS CLI* — zero dependencies, but it reintroduces exactly the
external-binary-on-PATH requirement the compiled extension was built to remove
(`bun` on PATH), for a tool not every RDS user has installed.

**Verified as far as it can be without AWS.** The store round-trips an IAM row
(profile/region kept, no password, `hasPassword: false`), refuses it without SSL,
and does *not* send it down the password-prompt path — all against the real SQLite
store and over the real bridge. `mapAwsError` is unit-tested pure. The token-mint
happy path needs an SSO profile and a live RDS instance, neither of which the
fixtures have, so it is the one thing verified by hand rather than in CI — flagged,
not papered over.

---

## A workspace has a colour, chosen the way its icon is

**Why.** The rail groups open connections by workspace (next entry), and a group
needs something to be tinted with. A workspace had only an icon to tell it apart,
so it grew a colour — picked the same way the icon already is, because the icon
had already solved this exact problem.

**It is the icon's twin, top to bottom.** A fixed palette (`WorkspaceColorId`, nine
swatches), stored as an *id* the extension carries and never reads, resolved to a
value by the UI — the `SqlDialect` rule the icon already follows. `workspaceColors.ts`
is the lookup, and it is the same *sanctioned* lookup `workspaceIcons.ts` is: the
ban is on a `Record` over an icon *package* (all ~3000 glyphs shipped), not on a
list over values that are already tokens. The colour is *data* — the user picks
it — so a lookup is unavoidable for the same reason the icon's is.

**The hue lives in `tokens.css`, this file names the token.** `workspaceColors.ts`
maps each id to a `var(--ws-*)` *reference*, not a hex, so the one place a colour
is written stays `tokens.css` — the same discipline as `--syntax-keyword:
var(--accent)`. The component sets `--ws-tint`/`--swatch` from it and CSS spends it;
no hue is written in a component.

**`--ws-*` is its own ramp, not the semantic hues or `--env-*`.** Same argument as
every ramp before it: a workspace's identity is not a status, so retuning `--green`
for a callout must not repaint a green workspace. Unlike `--env-*` it is *not*
ordered — a colour means "this project" and nothing more, so the set is a palette,
not a pipeline. `--ws-slate` is the neutral default.

**Stored with a default, migrated with a plain `ADD COLUMN`.** `color TEXT NOT NULL
DEFAULT 'slate'`, backfilled onto an older `workspaces` table the same way `ssl`
and `read_only` were onto `saved_connections`: nothing became wrong, a column is
simply missing, and the neutral default means a workspace made before the column
is never colourless. Same guess-that-costs-least as `local` for a migrated
environment.

---

## Rail grouped by workspace, and the environment stops being a colour

**This reverses "`--env-*` is the rail's colour", and the reversal is the point.**
The rail used to pack a connection into a 32px square: two derived letters, tinted
by environment. Same-environment connections looked alike and the letters read as
cryptic. Grouping by *workspace* and colouring by the workspace fixes both — the
group says whose project, the chip says which connection and (as a small grayscale
tag) which environment.

**So the environment becomes a word, in two places.** An abbreviation on the chip
(`Local`, `Dev.`, `Stag.`, `Prod.`) and the full label in the status bar for the
active connection. That is a deliberate double, not a violation of "one place names
a thing": it is two *resolutions* of one fact, the way the rail's name and the
titlebar's `user@host:port` are two views of "which connection". `--env-*` is
retired — nothing reads it, and a defined-but-unused colour ramp is exactly the
drift the token file warns against.

**The rail's colour is the workspace's, and now the whole group wears it — not
just the heading.** The pills started grayscale (only the heading tinted, the
active one on the accent `--selected` wash) on the argument that two hues fighting
over one row leave neither legible. In practice the opposite read better: a pill is
already inside its tinted heading, so a 1px border of the same hue over a lighter
wash of it does not *compete* with the heading, it *belongs* to it — the group
reads as one coloured object. The active pill fills solid with `--ws-tint` and
takes dark `--bg` text (the accent-primary pattern applied to the workspace hue),
which stays "this one" without reintroducing the accent into an already-tinted row.
*Rejected: keeping the accent for the active pill* — an accent-coloured active pill
among workspace-coloured ones fights the group's hue, and for a workspace whose own
colour sits near the accent it vanishes into it. The wash is a `color-mix` onto transparent so it still lands over
the one background rather than an opaque surface; the pills are completely flat
(1px border, no shadow, no elevation), which is the one-background rule intact.

**Every open connection must belong to a workspace, so the throwaway connection
closed.** The grouping has no "ungrouped" bucket, so the unnamed, workspace-less
quick-connect could not survive it. *Rejected: an "ungrouped" heading for it* —
that is the flat list the workspaces feature exists to kill, wearing a hat. So a
name is now **required**: the form disables *Connect* until one is typed and saves
the row before connecting, and every open connection is a named member of a
workspace. The cost is real and accepted: there is no longer a one-off connection
you open without saving. It was the lightest of the connect paths and the only one
that produced a connection the rail could not place.

**`workspaceId` rides onto the session the way `name` already did.** For a saved
connection it echoes back from the row on `db.saved.connect`, beside `name` and
`environment`. For a just-typed one it is threaded through the `connect` thunk as a
UI-side fact — `db.connect` never hears it, exactly as it never hears the name or
the environment. The rail reads it off `useSession().connections` and joins it
against `selectWorkspaces` (a store selector, because the rail is a feature and
features never import `features/connections`).

**Verified against both real servers.** The UI suite opens two connections in one
workspace and asserts the chips carry both *names* (not initials) and their
environment abbreviations, and that the group heads with the workspace. A colour is
still asserted as the *fact* the CSS spends (the stored id / the `--ws-tint`), never
a computed pixel — testing the stylesheet is not testing the app.

## The rail's colour is muted, and every bar is one height

**This reverses the entry above — the second reversal of the same surface, and
that is worth saying plainly.** The pills went grayscale → fully tinted (above) →
tinted but muted (here). The argument above still holds: a chip inside its tinted
heading *belongs* to that heading rather than competing with it, and the group
reads as one coloured object. What it did not account for is what the rail is
*next to*. It sits above the editor and the results, which are the two things the
app exists to show, and a full-strength workspace hue across the top wins the eye
against both. The group can read as one coloured object at a lower volume.

**So the structure is untouched and only the intensity moved.** Heading, chip
border, chip wash and the active fill are all blends toward `--bg`, at four ratios
named as constants at the top of `ConnectionRail.tsx` — 0.6, 0.3, 0.07, 0.72. The
active chip still fills and still takes dark text (the accent-primary pattern on
the workspace hue), so "this one" is said the same way; it is simply said quieter.
Nothing about which element carries colour changed, which is what makes this a
volume knob rather than a third design.

*Rejected: grayscale chips with only the heading tinted* — that is the original
design, and it was built and compared rather than argued about — a stash per
candidate, so both could be seen. It lost for the reason it lost the first time: the active chip has to say "this one" without the accent
(which fights the group's hue), and a border-only chip does not say it loudly
enough at a glance.

**Every horizontal bar in the stack is now `--tab-h` (32px).** The rail was 48,
the editor toolbar 44, the tab strip and sidebar head 32. Stacked directly on one
another, three heights read as a misalignment rather than as a hierarchy. `BAR_H`
is deleted rather than left unused — the same rule the retired `--env-*` ramp went
by — and `RAIL_H` is now defined *as* `TAB_H`, so the relationship is in the code
and cannot drift.

**The rail's group had to go horizontal to fit.** It stacked the workspace heading
over its chips, which 32px has no room for. The heading now sits inline to the
left of the chips it heads, and the 1px rule between groups is what separates
them — which it already was.

**`--button-h-bar` (24px) exists because of the toolbar.** A 30px button in a 32px
bar leaves one pixel either side and reads as the button *being* the bar. This is
the kind of thing that looks like a fussy detail written down and is actually the
reason the bar looked wrong at first.

---

## The accent is teal, and the token is `--accent`

**The one chrome accent moved from the reference's blue to teal, because the stock
blue read as generic.** It is `#0eb39e` (Radix dark **teal-10**), and teal-10 was
chosen on purpose over a brighter teal or a cyan: its luminance sits almost exactly
where `#669cff` did, so every contrast the design was tuned for survives untouched
— dark text (`--on-accent`) on the solid fill, and the accent as text on the one
dark ground. It is also darker and bluer than the green `--syntax-string`, so teal
keywords do not collide with green strings in the editor, and it is distinct from
the brighter `--ws-cyan`, so a cyan workspace is not mistaken for the accent.

**The token was renamed `--blue → --accent` (and `--on-blue → --on-accent`,
`--blue-bg → --accent-bg`, `.badge--blue → .badge--accent`), not just revalued.**
A token named `--blue` holding a teal is exactly the naming lie this system forbids
elsewhere; `--on-blue` and a "solid blue takes dark text" rule would all read false.
The name is now hue-neutral, so the next retune is a one-line value change with no
rename. The `--selected` wash (accent at 14%) and `--syntax-keyword` follow the
token, since both are `var(--accent)` or derived from it, and Monaco reads the same
tokens — the editor's cursor, selection, find-match border and typed-letter
highlight all turned teal for free.

**Rejected: teal in the chrome but the blue seal left in the app icon.** The seal in
`icon.svg` is a hardcoded `#669cff` and does not track `--accent`, and it stayed
blue in this change — not because a two-hue split is wanted, but because the
committed `icon.png` has no automated regeneration step (see the icon decision
above) and the mark is only ever seen at 16px in the taskbar, never beside the
chrome. Moving it is a redraw-and-re-export, tracked separately; until then the
split is tolerable precisely because the two are never in view together.

## The table context menu, and the DDL that seeds an editor tab

**Right-clicking a table now opens a menu; it did nothing before.** The menu is
deliberately *the surface* the per-table actions hang off, rather than each
growing a button somewhere: copy the name, open the definition, drop it. It
appears on views too — a view is a relation with a name to copy, a definition
(`SHOW CREATE VIEW` / `pg_get_viewdef`) and a `DROP VIEW` — because the complaint
was "right-click does nothing", and a menu that skipped views would leave it
half-true.

**`db.ddl` and `db.drop` are driver methods, not `db.query` the UI wrote.** Same
rule as `db.browse`: the SQL is per-engine and only the extension may author it.
The MySQL DDL is `SHOW CREATE TABLE` verbatim; the Postgres DDL is reassembled,
but every part is Postgres rendering itself (`format_type`,
`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef`) — the `format_type`
rule carried all the way up, so the app never spells a type or a constraint. A
`serial` comes back as its stored `nextval(…)` default, not re-invented; showing
what the catalog holds is the value-handling line one level up. See
`docs/extension.md`.

**Drop is refused on a read-only connection, and that guard is the UI's.** The
extension does *not* gate `db.drop` on the session's read-only mode, because that
mode is the server refusing writes and neither engine's covers DDL reliably (the
read-only entry above says so out loud). So a locked connection could drop a
table server-side — which contradicts the intent of having locked it. The menu
disables Drop when the connection is read-only, honouring that intent where the
server will not. It is a UI policy, like "Production defaults to read-only", and
it lives in the UI for the same reason.

**Rejected: `DROP … CASCADE`.** A guarded, unrepeatable action must not take
things the user did not name. Without `CASCADE`, dropping a relation something
depends on fails at the server and the reason renders in the confirm modal —
which is the honest outcome. `CASCADE` would make the typed-name guard a lie:
you confirmed one name and lost several.

**The definition opens in an editor tab, seeded at the model's birth — the one
inbound write the editor allows.** "Text flows one way: out" has held since
`previewSql` was removed; the formatter obeyed it by writing an *edit*. This is
the first writer that genuinely puts new text on screen, and it does it without
ever calling `setValue` on a live model: `EditorPane.modelFor` seeds the new
tab's model from `EditorContext.peekSql(tabId)` when the model is *created*, so
the seed and `sqlByTab` agree from the first frame.

**`peekSql` reads a synchronous ref, and that is the whole subtlety.** The shell
opens the tab and sets its text in the same turn, and the model is created in an
effect a beat later. Reading `sqlByTab` (React state) there gave an **empty
model** — caught by the UI suite, not by reading the code — because the state
update and the tab-open dispatch did not reliably land in the same commit, so the
model was created before the text arrived. The ref is written by `setSql`
*synchronously*, before any effect can run, so it is populated by the time the
model is born regardless of how React batches the renders. `sqlByTab` (state)
still drives everything that renders; the ref is only the birth read, and it is
pruned alongside the state so a reused tab id (the counter survives a disconnect)
cannot seed a fresh tab with a dead one's text.

**Rejected: opening the tab first, then writing the DDL in.** That is the
`setValue`-on-a-live-model trap the standing warning is about — it fires on every
keystroke and throws the cursor to the top. Seeding at creation is the way an
outside writer is *supposed* to work here, and it means a failed DDL fetch still
opens a tab carrying the reason as a comment: there is no ambient notification
surface, and the tab is where the answer would have gone.

**Verified against both real servers.** The extension suite asserts the DDL names
the table, its columns and its primary key on both engines, renders a view, and
resolves a schema-qualified relation; and that a real drop removes a
create-then-dropped throwaway table without touching the fixture. The UI suite
drives the menu, opens a definition tab and reads `CREATE TABLE` back out of
Monaco (the assertion that caught the empty-model bug), gates the drop modal on
the typed name, and confirms a read-only connection disables Drop.

---

## The result grid writes back, and the extension owns row identity

The grid could only read. Editing a value meant leaving for another client, which
is the one thing a SQL editor is for. So a browsed grid now writes back — edit a
cell, delete a row, copy rows as TSV, and one **Save** issues the batch — but
only where a write is *safe*, which is the whole of the design.

**Only browse mode, never a query's result.** `db.query` runs the user's
statement as written and is never rewritten — the same rule that made browsing its
own command. Write-back is offered only for rows the extension itself paged and
can identify, so it rides on `db.browse` (which now returns `keyColumns`) and a new
`db.write`, not on anything wrapping the editor's SQL.

**Row identity is the extension's to compute, not the UI's to choose.** The
primary key, else a unique index over columns that are all `NOT NULL`. A nullable
unique column is refused on purpose: two rows may both be NULL there, so a `WHERE`
over it is not a single-row target. A keyless table (or a view) reports `null` and
stays read-only, saying why — there is nothing to target. This is the quoting rule
again: which columns legitimately name a row is a per-engine catalog fact, and the
UI may no more decide it than it may write the SQL. `db.write` recomputes the key
itself and refuses a keyless table even if a caller hands it column names.

**Values are parameters, and that is *Value handling* on the write path.** Every
edited value is bound (`?` / `$n`), so the server parses the text — a BIGINT edited
to `9007199254740993` reaches the column exact, never through a JS `Number`, the
same corruption `dateStrings`/`supportBigNumbers` prevent on the way *in*. **Setting
NULL is distinct from clearing a cell**: `null` is a null parameter (SQL NULL), an
empty box is the empty string. Conflating them would be the timezone-`Date` lie one
field over — a value the app decided rather than the one the user meant.

**One Save is one transaction.** The batch is atomic — `BEGIN` → ops → `COMMIT`,
`ROLLBACK` on any error — so edits and deletes land together or not at all, and a
failure leaves the connection usable like a failed query. An op that matches more
than one row aborts the batch: a properly unique key matches at most one, so `> 1`
means it was not unique and editing rows the user never saw is the worse outcome.
A `0`-row update is tolerated — a no-op update legitimately changes nothing.

**Read-only is the server's refusal here too**, not a parser of ours: under a
read-only session the transaction's first write is refused by the engine and rolls
back. The UI also disables editing on a read-only connection, so it is defence in
depth — the same shape as Drop being gated in the UI while the server is the real
guard.

**The staged edits are a context, not a slice — the bridge test, unbent.** They
have not crossed until Save (only the `db.write` arguments do), so they live in
`ResultsContext`, keyed by tab exactly like the editor's `sqlByTab`, pruned by
diffing the tab list. Rows have no id, so an edit is keyed by its **row index into
the page on screen**, and each entry stamps the `table@offset` it belongs to: a
different page starts fresh, so paging discards staging while switching tabs keeps
it. The original key values are read from the browsed row at Save, so editing a key
column is just another staged cell while the `WHERE` targets the original. **A save
error is kept in the context, beside the save bar, never in the slice's `error`** —
that field makes `ResultsTable` replace the grid, and a failed save must leave the
grid and the edits still on screen.

**A pre-existing bug fell out of building this: copy never worked.** The tree's
*Copy name* and the grid's copy both use `Neutralino.clipboard`, which was **not in
`nativeAllowList`** — so the native call was refused and the `void`-swallowed
rejection hid it. Added `clipboard.*`; the read-back is now testable, which is how
this was found.

**Verified on real servers and the real app.** The extension suite proves, on both
engines, that `db.browse` reports the right `keyColumns` (`['id']`, a unique key,
`null` for a keyless table and a view), that `db.write` updates text into the right
type, sets NULL, deletes, keeps a BIGINT exact, rolls the whole batch back on a bad
op, refuses a keyless table, and refuses a write under read-only while surviving it.
A focused real-app driver connects, edits `tags` and confirms the value persists
after a re-browse, stages a NULL and a delete and discards them, copies TSV off the
clipboard, and confirms the keyless `logs` table is read-only with its reason —
end to end through the shipped UI.

---

## Maximise is the OS's, and the extension clamps it onto the work area

**This finishes the borderless-window trap the titlebar entry opened.** Re-adding
`WS_THICKFRAME` brought snapping back and cost the 7px frame band, which the frame
paint answered. It also left one thing unaddressed: the OS *maximise* of a
borderless window is wrong. With no `WM_GETMINMAXINFO` to rein it in, Windows
maximises a window that has `WS_THICKFRAME` but no `WS_CAPTION` to the **whole
monitor** rather than the work area — measured live: work area `0,30..1920,1200`,
"maximised" window `-7,-7..1927,1207`. So it sits 7px past every screen edge
(clipping our own close button off the right and the status bar off the bottom)
and covers the taskbar, reading as fullscreen. All three were reported as separate
bugs; they are one.

**We cannot handle `WM_GETMINMAXINFO`, but we can correct its outcome.** That
message is answered in the window's *own* process, and subclassing another
process's window proc is refused by Windows — so neither the webview nor the
extension can make the maximise land right in the first place. What the extension
*can* do is move it afterwards: `SetWindowPos` on a maximised window repositions
it without clearing the maximised state — verified: `IsZoomed` stays true and
Restore still returns to the exact pre-maximise rect, with no bookkeeping of ours.
`window.fitMaximized` finds the window by pid (as `matchFrame` does), reads
`MonitorFromWindow` → `GetMonitorInfoW`'s `rcWork`, and clamps. The same rule as
the frame paint: the extension is *the process that makes the native calls the
webview cannot*, and window-against-monitor geometry is one of them.

**The clamp targets the work area grown by the frame insets, because the webview
is the *client* area, not the window.** `WS_THICKFRAME` insets the client by the
resize border (7px a side here), and a window rect equal to `rcWork` was measured
leaving the content at `7,37..1913,1193` — nothing clipped any more, but the app
floating a frame-wide strip inside every edge, with the close button no longer
*in* the screen corner a thrown mouse lands on. The fix is what the OS's own
maximise of a captioned window does: overshoot by exactly the invisible frame
(`GetClientRect` + `ClientToScreen` against `GetWindowRect`), so the frame hangs
off-screen and the content lands on `rcWork` to the pixel. A second reading of
the borderless trap: the window is bigger than what you see, on maximise as on
the 7px band the frame paint answers.

**The UI triggers it from `sync`, not from its own button.** The OS has maximise
gestures that never touch our titlebar — snap-to-top, Win+Up — and every one of
them resizes the webview, which is what routes them all through `sync`. That is
also why this beat the rejected alternative below: hooking the button fixes the
button, hooking the resize covers every path. The clamp itself moves the window
and echoes one more resize, so the extension no-ops when the rect already matches
the target — that check is what keeps the echo from becoming a loop.

**Rejected: emulating maximise in the UI** — reading the work area over the
bridge and sizing the window there with `window.move` + `window.setSize`, with
the prior bounds remembered so Restore works. It was designed (an earlier version
of this entry described it) and it loses on every count that matters: the window
is never *really* maximised, so `isMaximized()` stops being the OS's answer and
the UI has to carry a parallel state and saved-bounds bookkeeping; a bare
`setSize` also drops `resizable: true`, the very bit snapping hangs off; and
snap-to-top still runs the real OS maximise underneath it, so the gesture the
button cannot see stayed broken. The clamp keeps the OS owning maximise and
corrects the one thing it gets wrong.

**Verified against the real window**, because "it maximises correctly" is exactly
the claim a webview screenshot cannot make — the content looks identical whether
or not the window hangs off-screen. Maximised through the live app (the webview's
own resize → `sync` → bridge → `SetWindowPos` path, driven by an external
`SW_MAXIMIZE` the button never saw): the window lands at `-7,23..1927,1207`, the
client and DWM-visible bounds land on `0,30..1920,1200` — the work area to the
pixel, taskbar visible, on a top-taskbar machine. Restore returns to the exact
prior rect, a second maximise clamps identically, and the rect holds still
afterwards — the no-op guard observed doing its job.

---

## The webview is refitted at startup, because the frame arrives after it

**The third face of the borderless trap** (after the 7px band the frame paint
answers and the maximise the clamp answers): the window is *created* without
`WS_THICKFRAME`, so the webview child is created at the full window size — and
when the startup `setSize({ resizable: true })` puts the frame back, the client
area shrinks by 7px a side and nobody tells the child. Measured live on a fresh
launch: client area 988×722, webview child 1002×736, its right and bottom edges
14px past the client — which is exactly the close button clipped off the right
and the status bar clipped off the bottom, *until the first manual resize*,
because a real resize is what makes Neutralino refit the child to the client.

**So startup causes a real resize: one pixel out, one pixel back.** Two
`setSize` calls right after the `resizable` one. Nothing subtler works —
`GetClientRect` already reports the shrunken client, so a style-refresh nudge
(`SWP_FRAMECHANGED`) has no size change to announce, and a `setSize` to the
size the window already has sends no `WM_SIZE` at all. The webview can do this
for itself, which by the extension's own admission test ("can the webview do
this itself?") is why it is two lines in `useWindowChrome` and not a native
call in `chrome.ts`.

**Both nudge calls carry `resizable: true`.** That option is what holds
`WS_THICKFRAME` on — a bare `setSize` drops the very bit the first call exists
to set, and with it snapping.

**Verified on a fresh launch**: the child lands exactly on the client
(988×722, no overhang), the window rect is byte-identical to before the nudge
(so `getSize`/`setSize` round-trip in the same units and nothing visibly
jumps), the buttons render complete in a screenshot, and maximise → restore
still clamps and refits through the same `WM_SIZE` path.

---

## The store's schema is a numbered sequence, not a pile of column checks

**What it replaced:** one `migrate()` that probed the file every launch — does
`saved_connections` have `workspace_id`, does it have `ssl`, does `workspaces`
have `color` — and did whatever was missing. It worked, and it was correct for
every column it had. The problem was the shape, not any one branch:

- **Every column added a probe to every launch, forever.** Six columns in, the
  function was more archaeology than schema, and the cost was permanent rather
  than paid once per store.
- **There was no total order**, so nothing said whether `color` came before or
  after `read_only`. It did not matter while every step was an independent `ADD
  COLUMN`, and it would have mattered the first time one step depended on
  another — silently, and only on the machines that had the intermediate schema.
- **The fresh path and the upgrade path were different code.** A `CREATE TABLE`
  carried the current shape and the probes carried the history, so a column added
  to one and not the other produces two schemas that are both "correct" and are
  not the same. Nothing catches that; the tests all run against fresh stores.

**Now:** `migrations/` holds one file per change, named `<epoch>-what-it-does.ts`,
each step recorded in a `schema_migrations` table in the file itself. There is **no current-schema `CREATE TABLE` anywhere**
— the schema is what the list produces from nothing, which is what forces the
fresh and upgrade paths to be the same walk. Migrations are frozen once shipped
and spell their own SQL out in full, values included: one that reaches for a
shared constant rewrites its own history the day that constant changes.

**A file each, and a timestamp rather than an ordinal.** The file boundary is
what makes "frozen once shipped" physically obvious — you append a file, you do
not edit a list. The timestamp is the weaker half of the choice and worth being
honest about: its usual justification is avoiding collisions when two branches
each add migration `007`, which a single-developer project does not have. It was
taken anyway because it is what every migration tool does, so it is what the next
reader expects, and because it removes the only remaining reason to renumber
anything. The six existing files carry the commit epochs of the changes they
represent, so the number means something rather than being the clock at the
moment of extraction.

**Unix epoch seconds, over the `YYYYMMDDHHMMSS` the Rails family uses.** Both
were written; epoch was chosen. It is a smaller number, it is what `date +%s`
hands you with no formatting step, and it is unambiguous where a bare digit run
in date order is not — `20260716074136` has to be parsed by eye before it is a
date at all. The cost is that neither is readable at a glance, so nothing was
lost by taking the shorter one. Ten digits holds until 2286, which is what keeps
a lexicographic sort of the filenames agreeing with a numeric sort of the
versions; the suite pins the width so milliseconds cannot creep in later and
break that agreement silently.

**`index.ts` imports each file by name, and that must not become a directory
scan.** The extension ships as a `bun build --compile` binary and the release
then deletes every source file beside it, so only statically imported modules
survive. The trap is that **the tests cannot catch this**: they spawn `bun
main.ts` against the source tree, where a scan finds every file and passes, while
the packaged app gets a store with no tables. Verified from the other end — the
compiled binary is grepped for the migrations' SQL and names, which is the direct
evidence that the static imports were bundled.

**The cost, taken deliberately: a fresh install builds the 2023 table and
immediately rebuilds it.** Migration 1 creates the original flat
`saved_connections`, and migration 2 renames it away to add `workspace_id`. The
alternative — migration 1 creates today's schema, and old stores are adopted
around it — makes a store from before workspaces unrepresentable on the ladder,
because its schema is not a prefix of anything. Two table writes on an empty file
is a rounding error against the two paths provably converging.

**The one probe that survives is `adopt`, and it runs once.** Stores exist that
were written before there was a version to record, so their version is inferred
from the file's shape and stamped — after which the file knows, and the inference
is dead for that store forever. That is the difference from what it replaced:
same reading of the schema, once per store rather than once per launch. It gets
one chance to be right about a file it did not write — too low is a
duplicate-column crash on launch, too high is a migration silently skipped — so
`schema_migrations.origin` records `adopted` against `applied`, which is what
makes a wrong inference diagnosable instead of mystifying.

**Each migration carries its own probe** (`applied`) rather than there being a
separate ladder of column checks. The probe sits in the same file as the SQL it
looks for, so the two cannot drift; a central ladder goes stale the first time
someone adds a file and forgets its other half. Since what is on disk is always a
*prefix* of the list, adoption walks until the first migration that cannot see
its own work. **New migrations leave `applied` off** — every store from here
records its own version, so the inference burden ends with the six files that
predate the mechanism rather than growing with each one.

**Rejected: `PRAGMA user_version`.** SQLite's own counter, free, and one integer
instead of a table. It records only how far the file got, which is the part that
matters — but not which migrations ran, when, or whether a version was inferred
rather than applied. Since `adopt` guesses, the row that says so is the whole
audit trail, and a single integer has nowhere to put it. It is also a 32-bit
signed field, which a 14-digit timestamp does not fit in.

**Rejected: discovering the migration files at runtime.** The obvious follow-on
to a file each, and it ships a silently empty store — see above. The hand step it
forces is watched from the *tests* instead, which may read the directory because
they are never packaged: `saved.test.ts` lists the real files and requires them
to match `MIGRATIONS` exactly, so a file added without an import fails by name.
Verified by planting one.

**Verified against real stores, downgraded rather than fabricated**, at every
rung: pre-workspaces (adoption at rung 1, plus the table rebuild), pre-SSL,
pre-read-only, pre-colour, and — the one that matters most — a v0.1.1–v0.2.1
store with no `schema_migrations` at all, which is what the largest number of
real files on disk actually are. Each asserts the connection still opens
afterwards, so the passwords are real ciphertext meeting real migrations.

---

## The protocol is split by domain, imported as one contract

**Why.** `shared/protocol.ts` reached 644 lines holding five unrelated things:
what it takes to reach a server, what comes back from one, the updater's two
shapes, the `Commands` map, and the channel's own event names. Nothing in it was
wrong — it had simply stopped being a file you could open to answer a question,
because every question landed in the middle of four other domains. It is now
`shared/protocol/`, one file each: `config`, `results`, `updater`, `commands`,
`events`.

**Both sides still import the barrel, `protocol/index.ts`, and that is the load-
bearing half.** The ~45 import sites name the contract, not the domain a type
happens to sit in today — so moving a type between the five files is a change to
this directory and nowhere else. Let one consumer import `protocol/config.ts`
directly and that stops being true: the split becomes a public layout that has to
be kept still, which is the opposite of what splitting it was for.

**The `.ts` extension in the specifier is why the barrel is named in full**
(`shared/protocol/index.ts`, not `shared/protocol`). The repo imports with
explicit extensions throughout — `allowImportingTsExtensions` is on for both
tsconfigs — and directory-index resolution would be a second convention living
beside it.

**Rejected: keeping a `protocol.ts` beside the directory as the barrel.** It
resolves (the specifiers name the file explicitly, so nothing is ambiguous to the
compiler) and it would have made the diff a handful of lines instead of 45. But a
`protocol.ts` and a `protocol/` sitting side by side is exactly the layout a
reader has to be told about, and the thing being fixed was a reader's problem.

**No behaviour changed and nothing crossed the bridge differently** — every
comment moved verbatim with the type it documents. Verified by typecheck, both
builds, and the extension suite against a real Postgres.

---

## The tab strip reorders, and closing takes a set

Drag-to-reorder, and a right-click menu with *Duplicate*, *Close All Except
Current*, *Close Tabs to the Right* and *Close All*.

**Closing is one action taking a set of ids, not a loop over the single close.**
`tabClosed({ id })` became `tabsClosed({ ids })`, and closing one tab is now the
set of one. The loop is the obvious implementation and it is wrong twice: it
re-picks the active tab once per id, which walks it along the survivors instead of
landing it where the menu was summoned from, and every reader keyed by tab id sees
N events for one gesture. Carrying the set means the active tab is chosen once,
from the shape after all of them are gone — and the existing rule for choosing it
(right neighbour, else left, else nothing) needed no change to serve all four
menu items.

**A reorder is written back into the slots it came from.** `tabs` is flat across
every connection — `results` is keyed by a bare tab id, which is why it is flat and
not nested — so `tabMoved` reorders only the moving tab's own connection's tabs and
writes them into the very indices they already occupied. **Rejected: splicing the
flat array**, which is shorter and passes every test you would think to write.
It slides another connection's tabs past each other whenever one sits between two
of these, and the way you find out is switching to that server and seeing a strip
shuffled by a drag you did somewhere else. This is the explorer-cache lesson in a
third place: a structure keyed by less than what identifies its contents does not
look broken until a second thing shares it.

**What is being dragged is React state, not the drag payload.** Nothing reads
`e.dataTransfer` back — the id is set on `dragstart` and the drop reads state.
`dataTransfer` is still written, because some browsers will not start a drag
without it, but nothing depends on reading it. That is also what makes the drag
drivable from the UI suite, which dispatches three plain `MouseEvent`s that carry
no `dataTransfer` at all; a handler reading `getData()` would be untestable from
there.

**Duplicate is the composition root's, because a tab's text is not in the tab.**
A tab is a store row plus an `EditorContext` entry joined by id — the split above —
so copying one spans two features and `Shell` owns it, handing `TabStrip` an
`onDuplicateTab`. The copy is seeded through `peekSql` at model creation, the same
inbound-write seam the definition tab uses, so text still only ever flows *out* of
Monaco. The three closes stay inside the strip: they are the tab list changing and
nothing else.

**The copy takes the next `Query N`, not the original's name.** Two tabs both
called `Query 3` is a strip you cannot navigate, and the app already answered this
question the same way when it let the tree open one table twice.

## The context menu became a primitive at the third caller

`CellContextMenu` and `TableContextMenu` were the same component: the same fixed
positioning, the same viewport clamp, the same close-on-Escape/outside-click/
scroll/resize, the same hover styling. The tab strip would have been the third
copy, so the chrome moved to `common/components/ContextMenu.tsx` and both callers
now build `items` instead.

**Items are data, not children.** `CellContextMenu` was already shaped that way
and `TableContextMenu` was not, so the merge is the former's shape winning: every
caller writes its own labels and disabled rules, and none of them owns dismissal.
`MenuItem` grew a `title` for the one thing the props-based version could say that
the data-based one could not — *why* an item is disabled, which is how the tree
explains that a read-only connection will not drop a table.

**It lives in `common/` and not in whichever feature grew it first**, because a
feature may not import a sibling — the tree, the grid and the strip all summon one.

---

## The About menu, and what got left out of it

The titlebar grew a second dropdown: **File** (Exit) and **About** (check for
updates, version, open app data). `FileMenu` became `Menu` taking its label as a
prop — two components differing only in a word and a list is one component.

**Rejected: a shared "which menu is open" state.** Each `Menu` keeps its own, and
they cooperate for free: pressing the other trigger lands outside this one's root,
so the `pointerdown` listener that already handles an outside click closes it in
the same gesture. A coordinator would be a second source for a fact each menu
already holds.

**`app.dataDir` answers where, and the webview does the opening.** This looks like
`window.matchFrame` and is its mirror image. There the extension exists to make a
native call the webview cannot; here `Neutralino.os.open` opens the folder fine and
the only missing piece is the path — a per-platform rule that belongs beside the
database it names. **Rejected: having the extension shell out to Explorer/`open`/
`xdg-open`**, which would be a second answer to a question the webview already has
an API for, plus three platform branches to keep.

**Dropped from the item: a Debug mode toggling devtools and verbose logging.**
Neither half survived contact with the code, and each failed differently.

*Devtools cannot be toggled at all.* `debug.log` is the only debug-related native
API in the Neutralino binary — nothing turns the inspector on or off at runtime.
The single lever is the launch flag `--window-enable-inspector`, one of the
command-line overrides Neutralino accepts for every config key, and reaching it
means relaunching the app. Rewriting the config instead is not an option worth
weighing: `neutralino.config.json` is packed into `resources.neu` and installed
under Program Files, so it is neither loose on disk nor writable. A restart was
judged too high a price for a debug switch, which leaves no toggle to build.

**So the inspector was turned off instead** (`enableInspector: false`) — control
was the point, and with no toggle available, off is the half that can be chosen.
The split is per-invocation rather than per-config: `bun start` and `bun run dev`
pass `--window-enable-inspector=true` through `neu run --`, so dev has devtools
and a packaged build does not. This is the only reason the config value can be
`false` without costing anyone their inspector. **The UI suite is
unaffected, and that is worth knowing before someone reverts this in a panic:**
the suite attaches through `--remote-debugging-port` passed to WebView2 via
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, which is a browser-level argument and
independent of Neutralino's setting. Verified, not assumed — the suite runs green
with the inspector off.

*Verbose logging had nothing to be verbose about.* The extension writes three
diagnostics to stderr and no more, and stderr has no destination: it is spawned
through a shell, so in an installed app the line explaining why it shut itself
down is written and discarded. That is a bug rather than a missing switch, and it
is the one that costs the symptom worth diagnosing — the app going dead. It and a
real logging layer are two entries in `backlog.md` now, deliberately apart, so
giving stderr somewhere to land does not wait on levels, rotation and a policy for
keeping query results out of the log.

## A select that names something is bare, and its focus is grayscale

The sidebar's database picker was an outlined input sitting in a 32px strip, with
an outlined collapse button beside it. Two boxes across a 200px header, for a
control that is not collecting a value from you — it is *naming the thing the tree
below it is showing*. `variant="bare"` on `<Select>` is that reading: no box at
rest, semibold text, a 1px `--border-strong` outline appearing only on hover and
focus. The collapse toggle became a ghost `<Button>` for the same reason, so the
strip reads as the tree's title rather than as a toolbar.

**A bare select is 24px, not the input's 32.** It is the first control the system
put *inside* a bar rather than in a form, and that is a different constraint:
`box-sizing: border-box` means a `TAB_H` strip carrying a 1px rule has 31px of
room, so an input-height control overflows it by a pixel and the box it grows on
hover sits on the divider. Sizing a bar's contents to the bar is the bug; they
have to fit within it.

**Its focus outline is `--border-strong`, not `--accent`, and that is the part
worth defending.** Rule 2 lists the focus ring among the accent's jobs, and the
default `<Select>` still spends it there. But a native `<select>` matches
`:focus-visible` on a plain mouse click, so a chrome control that lives in a
header flashed teal every time it was opened — the accent announcing "active" for
what is only "you clicked this". Grayscale still indicates focus (a box appears
where there was none), and the accent stays worth something. The rule is unchanged
for form fields, where focus is a real state and the field is why you are on the
screen.

**Rejected: `--hover` as the bare select's hover background.** It is the obvious
reach and it is a trap — `--hover` is translucent white, and a `<select>`'s
browser-drawn popup derives its background from the select's own computed
`background-color`. A translucent value there is the transparent-background bug
one step removed. The box on hover keeps the background flatly `--bg`, which is
what that widget has to be able to read back.

---

## Result-set filtering is browse-only, and the builder binds while raw does not

A grid could show a table's first page and nothing narrower. Filtering now
re-runs the page against the server with a `WHERE` the extension authors.

**Rejected: filtering a query's result.** The backlog item said filters "re-run
the query against the database", and for a statement the user wrote there is no
way to do that without wrapping it — `SELECT * FROM (their sql) WHERE …`. That is
the same rewrite refused when paging arbitrary results was rejected, and refused
again when write-back was built: the editor must not run something other than
what is on screen. So the filter bar is offered exactly where the extension
already authored the SQL — a grid tab — and an editor tab's result has no bar at
all, the same boundary as the pager and the editable grid.

**Rejected: client-side filtering for query results as a consolation.** It would
filter the rows that happen to be in memory and report a count that answers
neither "how many match" nor "how many are there". A number that cannot be
honestly labelled is worse than an absent feature.

**The builder binds every value; the raw clause is interpolated.** These look
inconsistent and are the same rule applied to two different things. A builder
condition is *structure the UI assembled*, so its value is data and binds as a
parameter — quoting is the extension's, and a value of `' OR 1=1 --` matches
nothing. A raw clause is *text the user wrote*, the same category as the
statement they type in the editor, and there is no structure in it to bind. The
UI is not authoring SQL in either case, which is the invariant that actually
matters.

**Rejected: parse-checking the raw clause.** Meaningful validation needs a
per-engine SQL parser, and `sqlScope.ts` is explicitly a scan that nothing but
suggestions may lean on. A wrong clause fails as a failed page, which is how a
wrong statement already fails.

**One conjunction, not per-row `AND`/`OR`.** Mixed operators without parentheses
are precedence-bound to `AND` in a way nobody predicts from a stack of rows, so
the builder joins its whole set with one choice and stays unambiguous. Mixed
logic is precisely what the raw box is for — the two forms are complements, not
alternatives.

**Switching form must not discard either side's work — it shipped once
discarding one, and that was a bug, not an accepted asymmetry.** The first cut
made raw → builder a hard reset (`{ kind: 'builder', conjunction: 'AND',
conditions: [] }`), on the reasoning that reading raw text back into rows is
parsing SQL and this repo does not do that. True as far as it went, but it
proved too much: it reset the conditions even when the user had never touched
the raw box at all, so building a filter, glancing at its `WHERE` text, and
clicking back to the builder threw the filter away. The parser problem is real
for reading *text a person typed by hand* back into structure; it says nothing
about conditions the app already had that a glance at raw never touched.

**Fixed by not making the draft a `TableFilter`.** The protocol's `TableFilter`
is a union — one form or the other — and that shape is what forced the reset:
there was nowhere to keep the builder's conditions once `kind` flipped to
`'raw'`. `FilterDraft` (`ResultsContext.tsx`) holds `conditions`/`conjunction`
*and* `where` together, with `mode` saying only which one is currently shown.
`toBuilder` now touches `mode` alone. `toRaw` still recomputes `where` from the
conditions every time — safe to do unconditionally, because rendering rows into
text is a fold over data already held, never a read of the text back out.

Rendering that text is the one place the UI writes something SQL-shaped, so it is
careful about exactly one thing: **values become quoted literals**
(`name = 'O''Hara'`, embedded quotes doubled), because the builder *binds* them
and raw text does not — concatenating them bare would hand over an identifier
where a value was meant. Column names are quoted too, per `quoteIdentifier` —
see the entry below for why that was not the first cut, and what it broke.

**The bar is keyed off the tab's table, not off `browse` — and that is the one
thing here found by running it.** `browseTable.rejected` clears `browse`, so the
first draft of the bar disappeared the moment a filter was rejected, taking the
control that fixes it along with the error and leaving re-opening the table as
the only way out. A grid tab knows its own table independently of the last page
it fetched; keying the bar there means a bad filter leaves the bar, the text and
the fix in place. It is also why the bar renders above every early return in
`ResultsTable` rather than beside the pager in the results bar.

**The staging page key grew the filter** (`table@offset@filter`). Row indices name
different rows once a `WHERE` applies, so the old `table@offset` key would carry
staged edits across a filter change and issue them against rows the user never
saw — the failure the whole row-identity design exists to prevent.

### The bar is always open, and exactly as tall as it has rows

**Rejected: a *Filter* button that reveals the bar.** It shipped that way first,
collapsed to a summary of what was in force. A filter you have to go and find is
one you do not use, and the button bought nothing back — the row it hid is a
single line. The bar is now always present with one blank condition on it, which
is also the shortest possible statement of what it does.

**A blank row therefore cannot be a filter.** The bar always shows a row, so a
half-filled one is its resting state rather than an error, and `pruneFilter` drops
conditions with no value (`IS NULL` needs only a column) before anything runs.
Apply compares the *pruned* draft to what is applied, so an untouched bar has
nothing to apply and says so by being disabled. Emptiness is `length`, not
`trim()`: one space is a value, and second-guessing what was typed is the thing
this app does not do.

**Rejected: a second row of buttons under the conditions.** `+ Add condition`,
the form toggle and Apply sat on their own line, which doubled the bar's height
to hold controls that fit on the line already there. They moved onto the first
row's trailing cell and the value box was capped to make room; *Clear* moved down
into the results bar, which also stopped naming the table — the tab and the filter
bar above both already do, and one place names a thing.

**Apply stays on the row while Clear does not, and that is the recovery rule
again**: an error replaces the results bar, so anything needed to fix a rejected
filter must live where it survives. Clear is not needed to recover — emptying the
value and applying does the same — and it is genuinely about the result on screen.

### A rejected filter used to empty the column dropdown it exists to let you fix

Keying the bar off the tab's table (above) kept the *bar* alive across a
rejected filter, but not what it needs to be useful: `columnInfo` lived only on
`BrowseState`, and `browseTable.rejected` sets `browse` to `null` — a failed
page leaves nothing to page from. The column `<select>` read `columnInfo` too,
so the one control offering the way out of the error emptied out at exactly the
moment it mattered.

**Fixed by giving `ResultsState` a second, longer-lived field.** `columns` is
written only on a *successful* browse (and only when that page's own
`columnInfo` came back non-empty, so a successful-but-unreadable answer cannot
overwrite a known-good list — the same caution `browseTable.fulfilled` already
took for the write side) and a failure never touches it. Which columns a table
has did not stop being true because one `WHERE` was malformed, so that fact
is held apart from the page it happened to arrive on. The grid header still
reads `browse.columnInfo`, which is correct to go empty with the grid it
describes — the header has nothing to show once there is no grid, but the
filter bar's dropdown is not describing the grid, it is offering the fix.

### The conjunction select reads as chrome, not as a field

Narrowing the `AND`/`OR` `<select>`'s box was not enough on its own — it still
matched the bar's 12px body type, so a narrower box holding the same-sized word
still drew the eye as another value next to column/operator/value rather than
the connective it is. It now steps outside the shared type scale: 10px,
unbolded, `TEXT_FAINT`. That is a literal pixel value, not a token, and
deliberately so — `TEXT_MICRO` (10px) is documented at its declaration as *the
connection rail's, never body copy*, and reaching for it here would be quietly
widening what that token means rather than deciding to. The same file already
had a precedent for exactly this kind of one-off (`iconBtn`'s 15px for the `+`/`−`
glyphs), so this follows the pattern already established rather than setting a
new one.

### Leaving identifiers bare was a bug, reported against a real column

`conditionsToWhere` shipped quoting values and leaving column names bare, on
the reasoning written down at the time: "quoting is per-engine and belongs to
the extension; guessing at it here is how the UI would start authoring SQL."
That reasoning was wrong on its own terms — it treated identifier quoting as
if it were arbitrary SQL logic the frontend has no business inventing, when it
is neither arbitrary nor an invention. A user hit it directly: filtering on a
column named `eventType` and switching to raw produced `column "eventtype"
does not exist`, because Postgres folds an unquoted identifier to lowercase
before it looks the name up.

**What the original reasoning got backwards.** "Quoting is per-engine" is true
and was never the problem — the fix does not guess at it, it reads
`SqlDialect`, which the frontend already legitimately holds (`useSession()`
carries it for the connection, `EditorPane` already reads it to pick Monaco's
grammar, `format.ts` already reads it to pick the formatter's language). Adding
a fourth reader — "which character quotes an identifier" — follows a pattern
this file already uses three times over; it does not start a new one. What was
actually being decided is not *how* to quote, which the extension's own
`Driver.quoteIdent` had already answered per engine, but *whether the frontend
is allowed to reuse an answer it already knows*. It is: this is the same
category as `format.ts`'s dialect table, not the same category as writing a
`WHERE` clause's logic from scratch.

**Fixed by `quoteIdentifier`, a direct mirror of `Driver.quoteIdent`** — backtick
for MySQL, double quote otherwise, each escaping its own quote character by
doubling it — applied unconditionally to every column name `conditionsToWhere`
renders, the same "always quote, never judge whether it is needed" call
`quoteIdent` itself already makes. The column came from the catalog
(`filterColumns`), so this is never a guess at spelling — only at whether
quoting was needed, and unconditional quoting removes that question rather
than answering it.

**Verification added a column, not just a test.** `users."eventType"` was added
to the Postgres and MySQL fixtures specifically to make the failure
reproducible against a real server rather than only against reasoning about how
Postgres folds case — this codebase's own rule (`docs/testing.md`,
`CLAUDE.md`) is that a bug like this is proven fixed by a real database, not by
a mock. MySQL cannot reproduce the case-folding half of the bug (its column
names are case-insensitive throughout), so the fixture also carries a paired UI
test proving the *other* half: that MySQL's raw text is quoted with a backtick
and not silently sharing Postgres' double quote — proof that the quoting
branches on the dialect rather than happening to look right on whichever engine
was tested first.

---

## The UI harness reaps a stale app before launching one

The UI suite failed 21-for-21 on a clean checkout, at the connect form, with
`Illegal invocation` and `Runtime.evaluate timed out`. Neither message named the
cause: an app orphaned by an earlier killed run was still holding debug port
9333, and `findPage` matches its target by window **title** — so the harness
attached to the survivor. That instance had a different `SQUEAL_DATA_DIR` and was
already past the connect screen, so `#type` was absent, `setSelect` called a
setter with `null` as `this` (which is what spells `Illegal invocation`), and
every later test cascaded.

**Why it read as an app bug rather than a harness bug.** It reproduced on a clean
tree, every test failed at once, and no message mentioned a process. The tell is
`0 pass` — the fail count tracks the suite's size, so the zero is the signal, not
any particular number. Confirming it took stashing the feature under test and
watching a clean tree fail identically.

**Fixed by making a run independent of the one before it**, rather than by
documenting a manual kill: `launchApp` kills any app *and* extension answering on
the port and waits for it to go quiet before spawning. `stop()` now reaps the
extension too — it is built to outlive the app by the heartbeat timeout, which is
correct in production and wrong between two runs, where it keeps the previous
run's store open.

**Rejected: a random debug port per run.** It would avoid the collision without
killing anything, but the port is also baked into
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and the orphan would simply survive to
accumulate. Reaping fixes the leak; a fresh port would only hide it.

**Accepted cost: this kills a copy of the app the developer has open.** `stop()`
already did that, so a fixed port had already bought it.

**A second, quieter failure fell out of the same run:** the Monaco highlighting
test slept a fixed 800ms for tokenizing, which is latency that depends on what
ran *before* it — adding two tests upstream was enough to break it. `app.waitFor`
is the primitive that replaces a sleep with the condition it was standing in for;
the connect form's `#type` moved to it for the same reason. The rest of the
suite's sleeps stay until one of them actually bites, since converting them all
at once is a large untested change to the thing that does the testing.

## The macOS release is one arm64 .dmg, ad-hoc signed

CI shipped macOS as a zip of the raw `neu build` output: a bare executable and a
resources folder, no bundle, no signature. That is not something macOS knows how
to install, and it is why the release was documented as unverified.

**`neu build --macos-bundle` was not the fix.** It renames the executable to
`squeal-editor-mac_arm64.app` and stops — no `Contents/`, no `Info.plist`, no
icon. Finder treats the result as a plain binary, so it buys nothing the zip did
not already have. `scripts/package-macos.sh` writes the bundle instead.

**arm64 only, rejecting universal.** Neutralino ships a universal shell binary,
so a universal `.app` looks free. It is not: the extension is compiled by `bun
build --compile` on an Apple Silicon runner and is arm64 whatever the shell is.
An Intel Mac would launch the window and then sit on the 15s `extensionReady`
timeout with no database — the exact hang that shipping raw TypeScript used to
cause, arrived at from a different direction. Cross-compiling the extension with
`--target=bun-darwin-x64` and `lipo`-ing the two together would close it, but CI
cannot launch either arch to check, so it would trade a known gap for an
unverifiable claim. One arch that is honestly one arch is the better floor.

**Rejected: keeping the bare zip beside the `.dmg`.** Windows ships an installer
*and* a portable zip because the zip is a real way to run it. The macOS zip was
never that — it was the absence of packaging.

**Ad-hoc signed, deliberately, and this will not change.** There is no Apple
Developer account and there will not be one, so notarization is out of reach.
Gatekeeper's "unidentified developer" on first launch, cleared with
right-click-Open, is the accepted cost. Ad-hoc still earns its place: without any
signature at all, macOS refuses a downloaded bundle outright rather than offering
the override.

## macOS embeds resources.neu because codesign reads Contents/MacOS as code

The first `.dmg` build failed at `codesign --verify --deep --strict`:

```
dist/Squeal Editor.app: code object is not signed at all
In subcomponent: .../Contents/MacOS/resources.neu
```

Signing itself succeeded; only verification failed. `Contents/MacOS/` is for
executables, and codesign treats every file there as nested code that must carry
its own signature — which a resource bundle cannot. The file could not simply
move, either: `NL_PATH` is the executable's directory, so `Contents/MacOS/` is
the only place a loose `resources.neu` is findable at all.

**Fixed by removing the file rather than the check**: macOS builds with `neu
build --embed-resources`, which injects the bundle into the binary with postject
and deletes it from disk. `Contents/MacOS/` is then executables only.

**Rejected: dropping `--deep` from the verify.** It makes the error go away
without changing the bundle, and the bundle is what ships. Ad-hoc signing already
means Gatekeeper stops the first launch, so the one thing worth knowing is that
the signature is *structurally* sound once the user gets past that — which is
exactly what `--deep --strict` was there to tell us. Silencing the only check
that can catch a malformed bundle, on the one platform CI cannot launch, trades a
build failure for a user-visible one.

**This is why the arch choice earns a second time.** `neu`'s embedder needs a
Mach-O sentinel patch for `mac_universal` and takes the plain postject path for
`mac_arm64`, so shipping one arch avoids the fragile branch as well as the dead
extension.

**Accepted cost: macOS diverges from the other two `neu build` invocations.** The
alternative was every platform embedding, which would change the Windows artifact
the installer and the signed updater are built around, to fix a macOS-only
problem.

## macOS launches through a shell shim because NL_PATH follows the CWD

The first `.dmg` that installed opened its window and then failed with *"The
database extension failed to start"* — the 15s `extensionReady` timeout. The app
was fine; nothing had spawned the extension.

`NL_PATH` on macOS is derived from the **working directory**, not from the
executable's location, and Finder launches an app with the working directory set
to `/`. So `commandDarwin` resolved to `/extensions/db/squeal-db-ext`. Confirmed
by launching the same bundle two ways: `cd Contents/MacOS && ./squeal-editor`
connects, `cd / && Contents/MacOS/squeal-editor` does not.

**Fixed by making `CFBundleExecutable` a shell script** that `cd`s to its own
directory and `exec`s `squeal-editor-bin` beside it. It `exec`s rather than
spawns: the extension heartbeats against the app and the UI suite reaps by
process, and both assume the app is one process rather than a shell wrapping one.

**Why this was invisible until macOS was packaged properly.** Every other way of
running the app — `bun start`, `neu run`, CI — has the repo root as the working
directory, which *is* `NL_PATH`, so the distinction never came up. It takes a
`.app` launched by Finder to separate the two.

**Why it presented as a dead extension rather than a blank window.** Embedding
`resources.neu` into the binary (see above) means the UI now loads no matter what
`NL_PATH` is. That removed the loud symptom of a wrong `NL_PATH` and left only the
quiet one. The two changes are independent but their symptoms are not: if the
extension ever dies on a platform where resources are embedded, `NL_PATH` is the
first thing to suspect, not the last.

**The error message it surfaced as is wrong and predates all of this** — "Is Bun
on your PATH?" in `bridge.ts` is from when the extension shipped as raw
TypeScript. Nothing has needed Bun on PATH since it became a compiled binary.

---

## macOS gets its titlebar from an injected dylib, because borderless can never be key

**The macOS face of the borderless trap.** Neutralino's `setBorderless` on
Darwin is `styleMask & ~NSWindowStyleMaskTitled`, and AppKit answers **NO** from
`canBecomeKeyWindow` for a window without that bit. A window that cannot become
key receives no keyboard input, ever — `window.focus()` runs
`makeKeyAndOrderFront:` and AppKit refuses it, every time. The native resize
border goes with the titlebar too. This is upstream and open
([neutralinojs#1197](https://github.com/neutralinojs/neutralinojs/issues/1197)),
still present in v6.8.0, the latest release. Every JS-level attempt — focus on
mousedown, focusing `#root`, custom resize strips — was treating symptoms of a
style mask nothing in JS can reach.

**Why the extension could not fix it, unlike on Windows.** The Windows frame
paint and maximise clamp work because Win32 lets one process recolour and move
another's `HWND`. AppKit has no cross-process equivalent: an `NSWindow` is
touchable only from inside the process that owns it, and Neutralino exposes none
of the flags that matter.

**The macOS shape of a custom titlebar is a titled window, not a borderless
one.** `scripts/macos-window-chrome.m` restyles the window in-process:
`Titled | FullSizeContentView` back into the mask, `titlebarAppearsTransparent`,
`titleVisibility` hidden, native traffic lights hidden (`TitlebarMacos.tsx`
draws its own). Keyboard focus, native edge resize and zoom return because the
window is, structurally, a perfectly normal titled window — the titlebar is
simply invisible, with the webview painted underneath it. This is what
Electron's `hiddenInset` is.

**Injection via `DYLD_INSERT_LIBRARIES` in the launcher shim**, which already
existed for `NL_PATH`. The export must happen *inside* the shim: dyld deletes
`DYLD_*` variables when starting a SIP-protected binary, and `/bin/sh` is one.
The same rule keeps the dylib out of the extension for free — Neutralino spawns
extensions through `/bin/sh`, and the variable dies at that boundary. Injection
works at all only because the bundle is ad-hoc signed without hardened runtime;
a future Developer ID build would need the
`com.apple.security.cs.allow-dyld-environment-variables` entitlement.

**The window must never be borderless at any instant, so the dylib intercepts
`setStyleMask:` rather than restyling after the fact.** The first shipped
version watched `NSWindowDidUpdateNotification` and restyled the window once it
appeared — and produced a white, unresponsive app: changing the style mask
under a live WKWebView rebuilds the window's frame view the webview is already
rendering into. The current version swaps `NSWindow`'s `setStyleMask:`
implementation at load (dyld runs the constructor before `main`, before any
window exists). Neutralino creates the window *titled* and strips `Titled`
during startup, before the window is shown; the intercept catches exactly that
titled-to-borderless transition, keeps `Titled`, adds `FullSizeContentView`,
and hides the titlebar instead — so the webview is born into, and only ever
lives in, a stable titled window. Every other `setStyleMask:` call (WKWebView's
borderless dropdown popups never had `Titled`; fullscreen transitions keep it)
passes through untouched. `SQUEAL_NO_WINDOW_CHROME=1` at launch disables the
intercept entirely, for telling a chrome bug from an app bug on hardware CI
cannot reach.

**Rejected: patching Neutralino and building the shell from source.** It is the
"proper" fix and the wrong trade: a fork of the shell to maintain and a C++
build in CI, against sixty lines of Objective-C compiled by `clang` in the
packaging script the release already runs.

**Rejected: `borderless: false` on macOS.** It works — that is what proved the
problem was the style mask — but it ships the native titlebar, which is the
opposite of the goal.

**Accepted cost: dev runs on a Mac are not injected** and keep the broken
borderless behaviour. Only the packaged `.app` carries the launcher. **And this
is reasoned, not verified**: written from a Windows machine against the
Neutralino source; the first packaged build on real hardware is the test.

---

## The dropdown is a hand-rolled listbox, so it can hold a search field

The database picker was a native `<select>`, and finding a database on a server
holding more than a screenful meant hunting it by eye. A native select's popup is
browser DOM: it takes no CSS and it cannot hold a field, so there is no version of
"type to filter it" that keeps the native element.

**This reverses the checkbox/radio/select rule for one of the three, and only
one.** That rule stands as written for the other two: a single choice from a fixed
set is what a radio group *is*, and a rebuilt checkbox loses the platform's focus
and keyboard behaviour for nothing. The select is the case where the platform's
own widget has a hard ceiling the design has to go through.

**What the native element was giving away had to be rebuilt, and listing it is the
point** — arrow keys, Home/End, Enter/Escape, dismissal on an outside click or a
scroll, and type-a-few-letters-to-jump. That last one is the one that gets
forgotten, because it is invisible until a keyboard user reaches for it; it is
implemented on the trigger and on a list *without* a search field, and
deliberately not on one with a field, where the letters belong in the field and
jumping the highlight too is two answers to one keystroke.

**Searching happens in the trigger, not in a field above the list.** A separate
box under the trigger was the first cut and it is the wrong shape twice: the
trigger already shows the current value and is already where you clicked, so a
second box is a second place to look for one answer — and it costs the popup a
row of height on every open, searched or not. Typing replaces the value in place,
with the current one left as the placeholder so the box reads as the same control
it was a moment ago.

**That is why the trigger is a focusable `<div role="combobox">` and not a
`<button>`.** A button may not contain an input, which is the tab strip's
constraint exactly. The cost is real and worth naming: `.disabled` is gone in
favour of `aria-disabled`, and the UI suite had to follow.

Two behaviours fall out of searching in place, and both are the same rule — one
keystroke, one answer. Typeahead is **off** on a searchable list, because typing
`u` to mean "narrow to users" must not also jump the highlight. And Home/End stay
with the text caret rather than jumping the list, because while you are typing
they are the caret's.

**Search is opt-in per usage, and every other usage declined it.** Engine,
Environment, Authentication, filter column, filter operator and the `AND`/`OR`
conjunction are all fixed, short lists where a search box is noise. They moved to
the listbox anyway so there is one dropdown in the app rather than two that drift
— the same argument `ContextMenu` settled — and they took `options`-as-data with
them.

**Rejected: keeping the native `<select>` for the fixed lists and adding a second
searchable component beside it.** It is the smaller diff and it buys a real thing
(the platform's typeahead, for free, on six of seven usages). It loses on the
count that matters: two components that must look identical, one of which is
skinned to a native element whose metrics are the browser's, is the drift the
shared primitive exists to prevent.

### `display: undefined` in a passed-in `style` deletes the component's own

The picker's caret stopped sitting at the right edge, and the cause was not the
caret. `Sidebar` passed `style={{ display: collapsed ? 'none' : undefined }}`, and
`<Select>` spreads the caller's `style` last — so the key `display` **exists, with
the value `undefined`**, and overwrites the component's own `display: 'flex'`.
React then omits an `undefined` value from the inline style entirely, so the
element computed to `display: block`: the label could not grow, and the caret sat
against the text with 125px of empty box beside it.

**It survived the native `<select>` because a replaced element does not lay its
children out.** Nothing about the old markup depended on the box being a flex
container, so the bug was already there and had nothing to break. Spread the
conditional case (`...(collapsed ? { display: 'none' } : {})`) rather than writing
a key whose value may be `undefined`.

The general form is worth keeping: **a `style` prop merged last can silently
delete any property the component sets on itself**, and `undefined` is the case
that looks like "leave it alone" and means the opposite. It is the inline-style
cousin of the `display`-inline rule in `design-system.md`.

### Two things closed the popup the instant it opened

Both were found by the UI suite failing intermittently, and neither is obvious
from reading the component.

**`scrollIntoView` on the active row scrolls every scrollable ancestor.** Keeping
the highlighted option in view is the obvious one-liner, and on a form long enough
to scroll it moves the page *behind* a popup that is `position: fixed` and does
not follow — and the scroll it causes is heard by the dismiss-on-scroll listener,
which shuts the popup. The listbox now scrolls its own `scrollTop` and nothing
else, and the scroll listener ignores anything originating inside the popup, so
the two are independent rather than one patching the other.

**A resize must re-measure, not dismiss.** Closing on resize is what `ContextMenu`
does and it looks like the same situation. It is not: the trigger is still right
there, so there is nothing to protect the user from — and this app resizes itself
at startup, twice, to keep Aero Snap and to make the webview refit its frame (see
the window entry above). A picker opened while that was still settling was being
shut by the app's own window management, which reads as a click that did nothing
and reproduces only sometimes.

### The UI suite drives it by clicking, and the clicks are asynchronous

`setSelect` — assigning through `HTMLSelectElement.prototype`'s setter — is gone,
and it was never as good as it looked: it fired a synthetic `change` that no real
click could produce, so it would sail straight past a *disabled* picker, and a
test that used it passed while the app stranded the user on one. `pickOption`
clicks, which a disabled trigger ignores. A searchable one is typed into at
`[data-testid="<id>-search"]`, inside the trigger and present only while open.

**The clicks do not flush synchronously, and that is the part worth writing
down.** A `click()` dispatched from an injected script is not a trusted event, so
React does not flush it the way it flushes a real one: the popup is *not* in the
DOM on the next line. `pickOption` and `optionsOf` therefore return promises that
poll for the listbox, and every caller must make one the completion value of its
`evaluate` — the harness passes `awaitPromise`, so a trailing `true;` is what
turns the wait off and brings back "no option X" for a list that had simply not
rendered yet.

**Choosing an option and typing into the same form cannot share one script.** An
option's click handler closes over the render that opened the popup, so anything
typed between the open and the choose is discarded when the choose lands. Pick,
await, then type.

---

## A relation's schema is a field, not a prefix on its name

**Why.** The tree had to group by schema, and there was nothing to group by: the
extension reported `reporting.daily_stats` as a display *name* and left `public`
bare, so "which schema is this in" was answerable only by looking for a dot.

Splitting a display string is a guess, and the case that proves it is not
hypothetical: a relation may have a dot in its own name. `reporting."daily.stats"`
renders as `reporting.daily.stats`, which has no correct split — and it sits
beside `reporting.daily_stats`, so a wrong one reads the wrong table rather than
failing. The fixture now holds both, and the test that browses one and asserts
its single row is the whole argument in one place.

**What it cost.** `Relation` (`{ table, schema? }`) travels on every command
about a relation, on a grid tab, and on the browsed page. `Driver.qualify`
became the one place a relation turns into SQL — which also fixed `quoteIdent`,
which used to split on dots and therefore mangled any *column* containing one.

**What survived, and why it is not the same thing.** `splitRelation` is still
there, and `schema` is optional on those commands, for one caller: the editor's
completion scans a name out of SQL being typed and has no catalog row behind it.
That is a guess confined to the only case with no alternative, and it is
one-directional in the way `sqlScope` already is — a suggestion missing, never a
statement aimed somewhere the user did not ask for. Everything from the tree
carries both halves and never reaches it.

**The part that was not obvious.** Moving the qualification out of the driver
moved a *presentation* decision into the UI, and the first cut printed
`public.users` on every row of an ordinary database — the driver had been hiding
`public` deliberately. The fix is not for the UI to learn that Postgres calls its
default schema `public`: the driver reports `defaultSchema` and the UI leaves off
whatever it names, the same shape as `dialect`. That split a name in two —
`relationName` always qualifies and is what caches and tab ids are keyed by,
`relationLabel` is what is printed — and they must not be swapped. Print the key
and the common case is noise; key by the label and two schemas holding a `users`
share one cache entry.

**The editor completion later broke ranks with the tree on this, deliberately.**
The reasoning that keeps `public.` off the *tree* does not carry to a flat
completion list: the tree shows a relation's schema as the heading it sits under,
so the name beneath can drop it; the completion list has no headings, so a bare
`users` beside a `reporting.hits` reads as "one schema is special and the rest are
not". So the completion **offers a default-schema relation both ways** — the
qualified `public.users` *and* the bare `users`, since either resolves — and a
relation in any other schema only qualified, because a bare name there would go
through `search_path` and not resolve. That names every schema in the list
without taking away the bare form the reader often wants, which is what a user
comparing it to the tree asked for. The first cut offered *only* the qualified
form; the bare one was added back because typing `users` and getting only
`public.users` (a weaker, fuzzy match) was a worse everyday experience than the
uniformity was worth. `defaultSchema` reaches the completion for exactly this
decision — which relations get the second, bare entry — the same fact the tree
reads to drop a heading. The `schema.` case is untouched: after a dot the schema
is already typed, so those relations are offered bare there regardless.

---

## User settings live in the extension's store, not in the webview

**Why.** The tree's grouping is the first preference the app has, and it needed
somewhere to be remembered. `localStorage` is one line and was the obvious
answer.

It was rejected for the reason the connection store was: durable state belongs on
the side that owns the disk. A preference in `localStorage` is a fourth category
in a state model whose whole rule is "did it cross the bridge", it sits outside
the file the About menu opens and the backup story covers, and Settings — which
Light theme and French/English UI both bring with them — would have had to either
duplicate it or migrate it later.

**The shape.** A `settings` key/value table, `settings.list` reading the lot at
launch, `settings.set` writing one. The store keeps **text and no vocabulary of
keys**: a value's meaning belongs to the feature that reads it, so a new
preference is not a migration, which is exactly what a column per preference
would have made it. An unwritten key is *absent* rather than defaulted, so the
reader's own default is the only one there is — a default stored here would be
this file having an opinion about a feature it knows nothing about.

**The cost, accepted.** A preference is a round trip away rather than
synchronous, so a control reads its own default until the launch read lands, and
a failed write leaves the app holding a setting the store does not have. That is
the right way round for something cosmetic: re-toggling retries it, while a
control that snapped back on an unreadable failure would just look broken.

---

## SQLite carries its path in `database`, not in a field of its own

**Why.** A file engine has no host, port or user, and the obvious move was a new
`file?: string` on `ServerConfig` plus a column in the store to match.

It was rejected because `database` already means exactly that. For SQLite the
file *is* the database — there is no server holding several and no name to pick
one out of — so a `file` field would only ever hold what `database` already says,
and every reader would have to know which of the two to consult per engine. It
also costs a migration for one engine, on a store whose schema is the migration
list.

**What it costs, accepted.** A SQLite row writes `host: ''`, `port: 0`,
`user: ''`, which reads oddly in the table. The alternative was a field that is
null for two engines out of three and a second answer to "where is this
database?", which is worse than three empty columns.

**The part that was not obvious.** `listDatabases` had to answer with the *path*
rather than `main`. `connection.ts` keys one client per database name and opens a
new client for any name it has not seen, so answering `main` while
`config.database` held a path would have opened a **second** handle onto the same
file for every table browsed — two connections to one SQLite file, quietly, for
the life of the session. Reporting the path keys the whole connection to one
client. The cost is a database picker showing a full path, which is cosmetic and
true; the alternative was a duplicate handle, which is neither.

**The other three that cost time**, all of them SQLite being SQLite rather than
anything about this app:

- `notnull` is an *operator* (`expr NOTNULL`), so selecting that column from
  `pragma_table_info` unquoted is a syntax error, not a column reference.
- `columnTypes` **throws** on a statement that returns no grid, so it cannot be
  the probe for "is this DML" — `columnNames` is, and `columnTypes` is only
  reached afterwards, for width.
- `INTEGER PRIMARY KEY` — the rowid alias, which cannot be null — reports
  `notnull = 0`. Taking the catalog at its word makes `pickRowKey` reject it and
  leaves the grid read-only for almost every SQLite table in existence, so a
  declared primary key is treated as `NOT NULL` regardless. This is the one place
  a driver contradicts its own catalog; the more-than-one-row abort in
  `runWrites` is the backstop if a key turns out not to identify a row.

**Not done, and not an oversight.** *Creating* a database file is not offered —
`create: false` is passed deliberately, so a mistyped path is a failed *Connect*
naming a file that is not there rather than a silently conjured empty database
that then shows an empty tree and reads as the app having lost the data. Creating
one is its own backlog item.

**The one that shipped broken.** `hasPassword: false` has three causes and only
one of them means "prompt": a password connection that stores none, an IAM
connection that mints a token, and a file engine with no authentication at all.
The first cut taught the *UI* the third case and left `store.ts::resolveSaved`
knowing only the second — so the connect form saved a SQLite connection happily
and clicking it came back *"does not store a password; one is needed to
connect"*. The fix is not another exemption in the store: it is that
`isFileEngine` lives in `shared/protocol/config.ts`, which is the only place a
predicate both sides act on can be answered once. `tests/saved.test.ts` pins it
by connecting to a saved SQLite row end to end, and that test fails with exactly
the user-visible message if the exemption is removed.

---

## Starred tables key off the saved connection, not the runtime one

**Why not the id `db.connect` hands out.** That id is minted fresh in
`establish` every time a connection opens and means nothing the next session —
exactly the id `explorerSlice`'s caches already key by, and exactly the one a
star cannot use, because a star has to outlive the session that set it. The
saved row's own id is the only one that does; `db.saved.connect`'s caller
already holds it as `id`, and `submitNew` gets it back from `saveConnection`
before `session.connect` ever runs, so `OpenConnection` carries it as
`savedConnectionId` beside the runtime one.

**The frontend cache still keys by the runtime connection, not the saved one.**
`explorerSlice.stars` is `Record<runtime connectionId, ...>`, the same shape as
`tables` and `columns` — because the rail, the tabs and every other cache
already address a session by that id, and a second addressing scheme for one
slice would be the two-tables-that-disagree failure the whole `explorerSlice`
history (`docs/frontend.md`, *the caches in `explorerSlice` are all keyed by
connection first*) exists to prevent. `loadStars`'s thunk reads
`savedConnectionId` off the session purely to make the one bridge call; nothing
downstream of that ever sees it again.

**One fetch per session, not per database.** Stars are cheap and rare, so
`db.stars.list` answers with every database a saved connection has ever starred
in, the same shape `db.saved.connect` already hands back `databases` in. A
per-database call would have made switching databases in the tree cost a round
trip it does not need to.

**`schema` is `NOT NULL DEFAULT ''` in the store, not nullable.** SQLite's
`UNIQUE` treats every `NULL` as distinct from every other `NULL`, so a nullable
schema column would have let a MySQL table — which never carries one — be
starred twice over, silently, the exact shape of bug `docs/frontend.md`'s
schema-key lesson is about one layer up. The empty string is a real value the
constraint can compare, which is the whole point of choosing it over `NULL`
here.

**Idempotent by construction, not by checking first.** `db.stars.set` takes the
state the UI wants (`starred: true/false`) rather than a toggle, and the store
side is `INSERT ... ON CONFLICT DO NOTHING` / a plain `DELETE` — both no-ops on
a row already in the state asked for. A context menu opened twice, or a click
racing a slow response, cannot flip a star backwards by asking for the same
thing twice.

---

## Foreign-key navigation only ever reports a single-column key

**Why not report it on the first column of a composite one.** A cell holds one
value; a composite foreign key needs every one of its columns to name a single
row. Reporting `ForeignKeyRef` on the first column anyway would let the grid
filter the related table by a fraction of the key — landing on every row that
shares that fraction, silently, with no way for the reader to tell a genuine
single match from an accidental one. That is the same category of wrong answer
`pickRowKey` already refuses for a nullable unique column, one layer over: a
guess dressed as a fact is worse than no icon at all.

**`pickForeignKeys` groups by constraint name and drops any group of more than
one**, shared by all three drivers so the rule cannot drift per engine — the
same shape as `pickRowKey` beside it. A table with only composite foreign keys
simply offers no navigation on those columns; that is accepted rather than
solved, because solving it means asking the reader to click a *row*, not a
*cell*, and that is a different feature this backlog item did not ask for.

**Verified against a real gotcha, not just the drivers.** `neu run` (and
therefore the CDP-driven manual check this shipped with) spawns the *compiled*
`extensions/db/squeal-db-ext.exe`, never `main.ts` from source — only the test
harness (`tests/helpers/harness.ts`) runs the source directly. `bun start` and
`bun run test:ui` both rebuild the binary first (`build:ext`) for exactly this
reason; a driver change checked by eye against a running `neu run` without that
rebuild reads as the feature not working when it is only the binary that is
stale. `docs/extension.md`'s "no build step" is still true of `bun start`'s own
pipeline — it is only a trap for a manual run that calls `neu run` on its own.

**SQLite's column-less `REFERENCES parent`** (no explicit referenced column)
means "the parent's primary key," not "nothing to report" — `pragma_foreign_key_
list` answers a null `to` for it, resolved with one `pragma_table_info` lookup
per distinct referenced table rather than left as a gap.

---

## Session restore moved the editor's text into a slice

**Why now, and not before.** The frontend's one state rule is the *bridge test*:
state that crossed the bridge is a slice, state that never left the webview is a
feature context. The editor's text was the standing exception — a query had never
been sent to or received from the extension, so `sqlByTab` lived in an
`EditorContext`, and both that file and `docs/frontend.md` named the day it would
change: *"the day a query has to survive a quit, the extension stores it, it
crosses the bridge, and it earns a slice."* Per-connection session restore is that
day. It is not a taste change reversing the earlier "editor text stays a context"
call; it is that call's own stated trigger firing. The text now lives in
`tabsSlice.sqlByTab`, and a tab is wholly a store row rather than a store row plus
a context entry joined by id.

**It was also forced, not merely allowed.** The save half is a listener
middleware — it watches state outside React so a burst of keystrokes debounces
into one write. A listener cannot read a React context, so persisting the text
*requires* it to be in the store. The rule and the mechanism agreed.

**Why an opaque blob, not a typed snapshot in the protocol.** The store keeps one
TEXT string per saved connection and never parses it — the settings rule, applied
to a whole session: the meaning is the UI's, so a tab shape has no business in the
shared contract or the store's schema. `SessionSnapshot` lives in the frontend
(`store/sessionSnapshot.ts`), JSON-encoded on the way out and decoded on the way
in. Only the UI reads it, so a typed column would be a vocabulary two layers that
never inspect it would have to carry.

**Why bundle the restore onto `db.saved.connect` rather than a separate
`db.session.get`.** Stars are fetched separately because they *annotate* a tree
that renders fine without them. A session *replaces* the default "Query 1" tab
`sessionOpened` would otherwise mint, so fetching it a beat later would flash an
empty tab and race the mint. Bundling it into the connect response lands the shape
with the connection in one synchronous reducer, no ordering to get wrong. The
typed `connect` path carries no session — it saves a brand-new row that has none —
so only the saved path restores.

**Why continuous debounced saving, not a save-on-quit.** The whole point is
surviving a quit, and a quit is not always clean — the extension heartbeats and
the app can be hard-killed. A hook on "quit" would be the one moment it cannot
rely on. So the shape is written ~600ms after it settles, throughout the session,
and once more immediately on `disconnect.pending` (while the tabs still exist —
`fulfilled` removes them, and serialising then would save an empty session over a
good one). The listener only ever serialises connections still open, so a
teardown never overwrites a stored snapshot with the empty shape it leaves behind.

**Why lazy re-browse, and why the filter seeds on the tab.** Restoring ten table
tabs must not fire ten browses at a server the instant a connection reopens, so a
grid tab refetches only when it is first in front — the `Shell` effect that
catches a tab with a `table` but no `results` entry, which is only ever a restored
one (a hand-opened tab browses imperatively and already has an entry by then).
That browse needs the filter the tab was reopened on, but the restored tab has no
`browse` yet to read it from — so it rides on `Tab.filter` as a one-shot seed,
consumed by that first browse, after which `results[tabId].browse.filter` is
authoritative again. The serialiser reads the live filter for a browsed tab and
falls back to the seed for one never viewed, so an untouched restored tab keeps
its filter across quits.

**Keyed by the saved connection, like stars, with the same accepted limit.**
Opening the same saved connection twice shares one snapshot; the runtime id is
minted fresh each session and could not persist. Not solved, for stars' reasons.

---

## `staging` renamed to `qa`

**Why.** QA is the standard name for the pre-production tier; `staging` was not
what any team using this app actually called it.

**Why a data migration, not a schema one.** Unlike `ssl`, `read_only` or the
workspace colour, `environment` needed no new column — it has always been a
bare `TEXT` with no `CHECK` constraint, so the extension never validated it
against `ENVIRONMENTS` at the store layer, only the UI's fixed dropdown did.
The migration is therefore a single `UPDATE ... WHERE environment = 'staging'`,
not a rebuild.

**The old value is spelled out in the migration itself, not read from a
shared constant.** Same rule as every migration before it: `'staging'` is what
this migration is rewriting away from, and it must keep saying so even after
`ENVIRONMENTS` no longer lists it — reaching for a constant would rewrite the
migration's own history the day someone tries to delete the last trace of the
old name.

---

## Colour moved off the workspace and onto the connection, outright

**Why.** The rail's colour was the workspace's, so every connection in a
project looked the same — but people work with *connections*, not workspaces:
the one they mean to be on right now is a specific server, not a specific
project. The first cut kept the workspace's colour as a fallback a connection
could override; the workspace's own colour was cut entirely instead; only a
connection has one now, and `Workspace` carries no `color` field at all.

**Overridable-with-a-fallback was rejected once it was built, not before.**
It worked — a connection wore its own swatch or inherited the workspace's —
but it meant two colours doing one job, a "Match workspace" tile that had to
be visually unlike a tenth swatch, and a nullable column whose `NULL` meant
something other than "unset." Cutting the workspace's colour outright removes
all three at once: one identity, one picker, one required column. The same
lesson `--env-*`'s retirement already taught — a fact that turned out to
belong to one place stops needing a second place to also hold it.

**Every connection has a colour; there is no "no colour" state left to
represent.** `saved_connections.color` is `TEXT NOT NULL DEFAULT 'slate'`,
the same shape as the workspace's own column was, not the nullable
"inherit" column the first cut gave connections. The picker is the ordinary
nine-swatch grid `WorkspaceForm`'s used to be, with no leading tile: slate is
what a new connection starts on, exactly as it was what an uncoloured
workspace used to fall back to.

**The workspace's `color` column is dropped, not merely unread.** It had
already shipped (`workspace-colour`, an earlier release), so retiring it is a
second, append-only migration — `ALTER TABLE workspaces DROP COLUMN color` —
never an edit to the one that added it. SQLite has supported `DROP COLUMN`
since 3.35, well inside Bun's bundled version, so this is a plain drop rather
than the table-rebuild `workspaces` needed the one time an actual constraint
had to change.

**The rail's heading stays plain text — a fact the earlier "muted tint"
design got right by accident.** That entry tinted the heading on the argument
that a chip's border and wash were derived from the same colour as the
heading above it, so painting the heading was "free." The chips were already
capable of disagreeing with each other by the time that was written — a
connection could already override its workspace — which means the heading
was already asserting a single colour for a row that could hold several. Now
that a workspace has no colour of its own to assert, there is nothing left to
paint the heading with, and the accidental fix becomes the honest state: the
heading names *whose* group this is, the chips say what colour each
connection actually is.

**Renamed to match: `WorkspaceColorId` → `ConnectionColorId`,
`workspaceColors.ts` → `connectionColors.ts`, `--ws-*` → `--conn-*`.** A type
and a lookup named for the entity that no longer owns the concept is exactly
the naming lie this codebase's own conventions forbid elsewhere — the same
reason `--blue` was renamed to `--accent` when the accent hue changed. The
palette itself (the nine hexes) is untouched; only what it is named after
moved.

**The colour picker is guaranteed one row, not merely usually one.** The
connect screen's card is a fixed 420px, so nine 34px swatches at the
`WorkspaceForm` gap (`GAP_SM`, 8px) total 370px against 372px of content
width — two pixels of slack, and the tenth "Match workspace" tile the first
cut added was what pushed it over into a wrap. Removing that tile alone would
have left the fit at that same two-pixel margin; the gap was tightened to
`GAP_XS` (4px) instead, landing at 338px, so the row does not wrap the day a
tenth swatch or a slightly wider font metric is added. `flexWrap: 'nowrap'`
is set explicitly alongside it, so a future regression fails as a clipped row
rather than silently wrapping again.

**A colour strip in the saved-connection list, so a connection's colour is
visible before it is ever opened.** The rail only shows what is already
open; the list a workspace's connections are picked from had nothing at all
marking one from another beyond its name. A 3px bar at the left edge of each
row, filled from the same `connectionColor()` the rail spends, answers "which
one is this" at the point the user is actually choosing.

**Verified against a real connection, not a computed pixel.** Two saved
connections in one workspace, opened against the fixture Postgres server: one
given an explicit swatch, the other left on the default. The rail shows the
first wearing its own hue and the second wearing the neutral default, side by
side under one plain-text heading; the saved list shows both strips before
either is opened; the workspace form shows no colour control at all — all
four read off the running app's own screenshots.

---

## The busy-wait mark is the `thinking-orbs` package, not hand-rolled

**Why it took two hand-rolled attempts first.** The first cut was a solid
`clip-path` square → triangle → circle, which shipped looking wrong: filled
polygons interpolate straight lines between mismatched vertices, so a
mid-morph frame is a kite-shaped blob, not a shape settling into another one.
The second cut read `thinking-orbs`' own source for its technique — a dotted
outline walked by arc length so dots stay evenly spaced at every instant —
and reimplemented it on a plain `<canvas>`. That version had two real bugs
before it worked at all: the dot count and radius, tuned against a 160px test
probe, painted nothing visible at the real 16px size; and a query fast enough
to resolve before the first `requestAnimationFrame` callback fired could
unmount the canvas having painted zero frames, ever.

**Then the ask changed to using the real package.** Once told to just install
it, the second cut's hand-rolled `<canvas>` component was deleted outright
rather than kept as a fallback — two implementations of the same animation is
exactly the kind of unrequested option this project's conventions warn
against, and the package is now the one place this logic lives.

**`theme` is pinned to `"dark"`, not left `"auto"`.** The package resolves
light-vs-dark from `prefers-color-scheme` or an ancestor `data-theme`
attribute, and this app has neither: it is Radix dark with no light mode yet
(see "Light theme" in the backlog). Leaving it `"auto"` would read a signal
that says nothing about this chrome and risk flipping ink colour the day
someone's OS theme does.

**`size` is `20`, the package's tuned "inline-text" preset, not `64`.** The
two sizes are separate hand-tuned designs, not one scaled by CSS — asking for
an in-between size was never on the table.

---

## The JSON cell drawer is a second Monaco instance, not a hand-rolled highlighter

**Why.** A JSON/JSONB cell's drawer needs syntax highlighting, pretty-print and
validation. Monaco is already the app's one dependency for exactly this shape
of problem (`features/editor`), and it ships a JSON language service — a
Monarch-free, hand-written tokenizer for highlighting plus a worker-backed
formatter and validator — that a bespoke regex highlighter and a hand-rolled
pretty-printer would only reimplement worse. `JsonCellDrawer.tsx` creates and
disposes its own `monaco.editor.create()`, independent of the tab editor's
singleton: it is not a second violation of "one editor, one model per tab" (see
*The editor* in `frontend.md`), because that rule is about the SQL tab editor
specifically holding one model per tab, not a ban on Monaco appearing twice in
the app. This editor's whole lifetime is the drawer being open.

**The JSON worker had to be wired, not skipped.** Importing `monaco-editor` at
all registers JSON's full language service unconditionally (validation,
formatting, completion) — there is no opt-out short of not creating a `json`
model. Before this feature, `MonacoEnvironment.getWorker` in
`features/editor/monaco.ts` always handed back the base editor worker,
because every model in the app was SQL, which needs no worker (its Monarch
grammar runs on the main thread). A `json` model asks for a worker keyed by
the label `'json'`, and handing it the base one silently fails every
validation and format-document RPC it makes — not a crash, but a `Format`
button that no-ops and diagnostics that never arrive. `getWorker` now branches
on the label and imports `json.worker` the same way `editor.worker` is
already bundled (`?worker`, so Vite ships it locally rather than Monaco
resolving one from a CDN — the same reasoning as the base worker).

**Validity is tracked with a plain `JSON.parse` in a `try`/`catch`, not by
reading Monaco's own diagnostics.** The worker's markers are what light up
the red squiggly in the editor, which is a nice-to-have this wiring earns for
free, but they arrive asynchronously and are the wrong thing to gate *Save*
on: a synchronous parse on every keystroke is what decides whether the button
is enabled, so the gate never lags the worker by even one debounce cycle.

**Pretty-print is Monaco's own `editor.action.formatDocument`, run through
`getAction(...).run()` — the same call the SQL toolbar's `Format` button
already makes, not a second bespoke transform** (contrast `features/editor`'s
`format.ts`, a hand-written pure function, which exists *because* SQL has no
language service to delegate to). JSON does, so writing a second formatter
here would be the two-tables-that-disagree outcome this codebase keeps
calling out elsewhere.

**Verified against the real Postgres fixture** (`users.meta`, jsonb): the
drawer opens showing the server's own value, `Format` re-indents it, typing
invalid JSON disables *Save* and shows the parser's own error text, and a
full edit → drawer *Save* (stages) → grid *Save* (writes) → re-browse round
trip landed the new value under the row's actual primary key — confirmed by
name, not by screen position, because a write shifts a row's place in
Postgres's unordered natural scan (see *Browsing a table* in
`extension.md`) and an earlier pass of this same check briefly read as a
bug for exactly that reason before the row was re-identified by name.

---

## The database moved off the tab and onto the connection

**Why.** "Tabs are in the store, and the bridge test does not decide it
alone" (above) put a `database` on every tab deliberately, so that switching
database to check one thing could never drag every other tab along with it.
Built and shipped, that isolation read as the opposite of a feature: the
sidebar picker and the tree jumped to a different database every time you
switched tabs, because each tab was quietly remembering its own. A user
reported it as confusing before ever being told it was intentional — the
isolation cost more surprise than it was saving.

**What changed.** `Tab` no longer carries a `database` field at all.
`tabsSlice.database` is one value per connection (`Record<connectionId,
string | null>`, the promotion of what used to be the empty-state-only
`defaultDatabase`), set by the picker and read by `runQuery`, `browseTable`
and `saveEdits` off the connection rather than off the tab. `useExplorer`'s
`database` is that value alone, with no `activeTab?.database` to fall back
from — which also deletes the empty-state special case `changeDatabase` used
to need: `setDatabase` works identically whether or not a tab is open,
because there was never anything tab-shaped in the fact to begin with.

**The tradeoff, accepted with eyes open.** The database can now change
underneath a tab that never touched the picker: switching it re-browses the
*active* grid tab immediately (so what's on screen never lies about what
it's showing), but a **background** tab's next query or browse — run only
when you get back to it — targets whatever the connection is on by then, not
whatever it was on when that tab was opened. This is exactly the drag the
original design forbade. It's kept because the alternative — the picker
correctly, confusingly, showing a different database per tab — was worse in
practice, and because the failure mode is mild: a stale grid tab that
re-browses into a missing table surfaces a normal "no such table" error in
its own grid, not silent wrong data, and a stale editor tab's `SELECT` just
fails or runs somewhere the user can immediately see and correct.

**Rejected: keep the per-tab database, and give the picker a separate
connection-level "what to show while browsing" value that tab switches don't
touch.** This was the second data point that made the reversal read as
correct rather than as caving to one complaint: it is two sources for one
fact — a tab's own database and the connection's displayed one — with no
principled answer for which one a freshly typed query should run against.
That is the same "slices reaching into each other" shape the original tabs
design spent real effort avoiding, worn as a compromise instead of resolved.

**`SessionSnapshot.tabs[].database` and `.defaultDatabase` are gone from the
persisted shape too**, replaced by one top-level `database`. The extension
never parses the blob (see "Session restore moved the editor's text into a
slice", above), so this needed no migration — a session saved by the old UI
simply parses with an absent `database`, which falls back to the connection's
first database the same way a brand-new session does.

---

## Environments became a user-managed list, and lost their capitalising along the way

**Why.** `Environment` was a fixed union (`'local' | 'dev' | 'qa' |
'production'`), so a team whose pipeline is named differently was stuck
retyping the app's own names onto their servers. The fix is the same shape as
workspaces: a small managed list in the store, add and remove from a screen,
reached from the File menu rather than from inside the connect screen — it
is app-wide reference data, not a step in connecting.

**A connection stores the name as text, not a foreign key to the list.**
This is the load-bearing choice, not a simplification: the whole point of
"removed from the list" is that a name stops being *offered* to a new
connection, never that it stops having been true of one already using it.
A foreign key would force a choice on delete — cascade (silently retitles or
strands existing connections) or refuse (you can never remove a name a
departed project still uses) — that a bare `TEXT` column sidesteps entirely,
exactly as it already did before this feature existed. `deleteEnvironment`
therefore only ever touches the `environments` table; `saved_connections` is
not consulted and cannot be.

**`SavedConnectionList` groups the managed list's names first, in its
`position` order, then anything left over — one heading per distinct value a
connection carries that the list no longer offers — sorted alphabetically
after.** Rejected: hiding a connection whose environment fell off the list.
Nothing else in this app hides a row because a label went stale (see "Errors
render where the action was taken"), and a connection is not less real for
having outlived the name it was filed under.

**Display shows exactly what is stored, and the old Title Case and the rail's
two-letter abbreviation (`Dev.`, `Prod.`) both went with it.** Those existed
because the four names were a closed set a lookup table could spell nicely.
Arbitrary user text has no such table to consult — `environmentLabel`/
`environmentAbbrev` could only ever answer for the four they were written for,
and inventing a capitalisation or truncation rule for text nobody asked to be
reformatted is the same lie as a shifted `Date`: a value that looks handled
when it has actually been guessed at. The shipped defaults (`local`, `dev`,
`qa`, `production`) therefore render lowercase now, same as anything a user
types in. Cosmetic cost, accepted knowingly, in exchange for one property that
matters more: what the rail, the status bar and the connect screen show is
never something this app made up on a connection's behalf.

**The last environment cannot be deleted.** Same guard, same reason, as the
last workspace: `ConnectionForm`'s select needs at least one entry to offer a
brand-new connection, and the migration seeds the four so a fresh store is
never one short of that floor.

**`readOnlyDefault` (production defaults to read-only) still checks a literal
`'production'`** rather than reading the managed list. It has exactly one
name to match against — its own shipped default — because there is no
principled way to ask a user-managed list "which of these is the dangerous
one." A renamed or custom production-like environment simply does not trigger
the default; that is the cost of naming freedom stated plainly rather than
hidden behind a heuristic that would guess wrong at least as often as right.

---

## A hand-typed query is editable when its own result carries the key, not when it is shaped `SELECT *`

**Why.** Editing was offered only for a table opened from the tree, because
that path alone gave the grid a row identity. The first design considered
here detected a narrow shape — `SELECT * FROM table`, nothing else — and fed
it to `browseTable` so it would page and edit exactly like the tree's own
open. **Rejected**, on the user's own correction mid-build: it made every
column list, `WHERE`, `ORDER BY` or `LIMIT` the difference between an
editable grid and a read-only one, for a reason that has nothing to do with
whether the row can actually be identified. The question that matters is
narrower and more useful: *does this result already carry the table's key
columns?* `SELECT id, name FROM users WHERE active` answers yes; `SELECT
name FROM users` answers no — and only the second should have to explain
itself.

**The shape is `db.query`, run exactly as typed, plus a side lookup.**
`runQuery` (`resultsSlice.ts`) scans the SQL for one named table
(`detectSingleTable`, `common/db/`) and, only then, asks the extension for
that table's row identity alone (`db.tableKey`, backed by `Driver.rowKey` —
the same call `db.browse`/`db.write` already make, never a second way to
compute it). This is deliberately not a repaging: `db.query` still runs the
statement byte-for-byte, so a `WHERE`, a `LIMIT`, an `ORDER BY` all reach the
server unchanged. `db.browse`'s own rule — "the UI may not author SQL, and
the extension never rewrites the user's" — holds exactly as before; this adds
a read of the catalog beside it, not a rewrite of the query.

**`detectSingleTable` is stricter than `editor/sqlScope.ts`, on purpose.**
The completion scanner is right to be loose — a table it misses just costs an
absent suggestion. Here a wrong answer costs a write landing on a table the
query never really touched, so every check fails toward "not simple": a
`WITH`, any `JOIN`, more than one `FROM` (a subquery, a CTE, a UNION), or an
old-style comma join all say no rather than guess. A `schema.table` form is
only accepted when the connection's dialect actually has schemas (Postgres);
MySQL's database *is* its schema, so a `other.table` there names a second
database this app has no way to check the key columns of, and guessing would
mean silently trusting the wrong catalog entry.

**A real key that was simply not selected gets its own message, not silent
refusal.** `useResults` checks the fetched key columns against
`result.columns`: present, and the grid behaves exactly as a browsed table
does; a real key that exists but was left out of the `SELECT` list says so
("Select `id` to make this result editable.") rather than leaving the user to
guess why Save never appears. A table with no key at all still gets the
existing "no primary or unique key" message — that fact does not change
depending on how the table was reached.

**That message shows only on an actual edit attempt, not unprompted —
changed after the first cut shipped it in the results bar alongside
`readOnlyReason`.** The two read the same at a glance but are not the same
kind of fact: a keyless table or a read-only connection is true regardless of
what anyone does, so stating it up front is simply informative. "You didn't
select the key" is true only of a query that was never meant to be edited in
the first place — most `SELECT` statements are read for a reason that has
nothing to do with editing — and greeting every one of them with a warning
about an id column nobody asked to change reads as the app scolding a report.
`missingKeyHint` is exported separately from `readOnlyReason` for exactly
this split, and `ResultsTable.startEdit` is the one place that turns it into
something shown: a double-click on a non-editable cell displays it for a few
seconds, the same shape a toast takes, then lets it go. Nothing else may
trigger it — the hint answers a question only a real attempt asked.

**The lookup rides inside the same thunk invocation as the query, never a
second dispatched action.** `browseTable` elsewhere accepts a documented
last-arrival-wins race — a slow page landing after the picker moved on is
merely a wrong render, corrected by the next fetch. A stale answer here would
be worse: it would let an old table's key columns gate a *write* issued
against whatever the grid now shows. Folding the `db.tableKey` call into
`runQuery` and returning both in one `fulfilled` payload makes that
unreachable by construction — an older run's answer can only ever apply
together with that same run's result, never mixed with a newer one.

**Paging and the filter bar are deliberately not extended to this path.**
Both are gated on the tab being a `grid` tab (`gridTable` in `useResults`,
`FilterBar`'s own early return); a hand query stays an `editor` tab, so
neither shows. This is not an oversight to fix later: paging a query the user
wrote by hand would mean the extension silently adding a `LIMIT/OFFSET` to
SQL it promised never to rewrite, and a filter bar implies a `WHERE` this app
can re-author — neither is true of a hand-typed statement. `Save` on this
path re-runs the original SQL rather than re-browsing, for the same reason:
there is no page to read back, only the statement that produced this one.

---

## The Windows release drops the portable zip; the installer is its only download

**Why.** Two Windows assets on the release page meant a choice with no good
default: the zip runs without installing but never self-updates, the installer
does both and is free either way. The zip earned its keep for exactly as long
as it was the *only* verified way to run the app on Windows; once the
installer was verified too, the zip was one more download to explain for no
capability it alone provided. Dropped, along with the `Zip the bundle
(Windows)` CI step that made it.

**Why the installer could just absorb the role: it never depended on the
zip.** `installer/squeal-editor.iss`'s `[Files]` section reads straight out of
`dist\squeal-editor`, the same `neu build` output the zip step archived — the
two were siblings in the same job, not a pipeline where one fed the other.
Removing the zip step changes nothing the installer step reads.

**Why the output file also lost "setup" from its name.**
`squeal-editor-setup-vX.Y.Z.exe` carried "setup" to distinguish it from the
portable zip sitting beside it on the release page. With the zip gone there is
only one Windows file, and the word describing what made it different from
the other option is now describing nothing — so it is renamed to
`squeal-editor-vX.Y.Z.exe`. That rename reaches everywhere the old name was
load-bearing, not just cosmetic: the updater's `INSTALLER_PATTERNS.win32`
regex, `sign-release.ts`'s two output filenames (`.sig` and the `SHA256SUMS`
line), and the asset names `docs/architecture.md` and the README's download
table both quote.

---

## The Linux release ships nothing, for now — CI still builds it

The zip was the only thing CI ever produced for Linux, and it was a bare `neu
build` output with no desktop integration: no launcher entry, no icon, nothing
a Linux user would recognize as an installable app — the same complaint the
Linux AppImage backlog item names. Attaching that zip to every release gave
Linux a download link that looked like support and delivered a worse first run
than no download at all.

**Why not drop the Linux leg entirely instead.** The matrix still builds and
packages Linux on every release (`fail-fast: false` keeps its failure from
withholding Windows or macOS) — that is the only signal this project has that
`neu build` still works there at all, unverified as the launch itself remains.
Losing the build would lose the one check standing between "unverified" and
"unknown". Only the zip step and its release upload are gone; compiling,
slimming and `neu build` are untouched.

**This is explicitly temporary.** The AppImage backlog item is the real fix —
desktop integration, not just an archive — and when it lands Linux gets a
release asset again, this time one worth shipping.

---

## The installer needs `PrivilegesRequired=lowest`, and `close` needs a deadline

**Found on a real machine, not in review.** The close button silently did
nothing. UI Automation invoking it directly proved the click landed and the
handler ran — `Neutralino.app.exit()` itself was the thing not completing.
Windows Event Viewer had the rest: `squeal-editor-win_x64.exe` had access-
violated (`0xc0000005`) during an earlier close attempt, and the install
directory's ACL gave the unelevated process `ReadAndExecute` only. Relaunching
the identical `.exe` elevated made the same click close the window
immediately — confirming the native shutdown path needs to write something
next to the binary (the log, at minimum — `writeToLogFile` is on) and does not
fail gracefully when it can't.

**The installer already intended to avoid this.** `installer/squeal-editor.iss`
says "per-user install" and uses `{autopf}`, which only resolves to a
user-writable `%LocalAppData%\Programs` when Setup itself is running
unelevated. Inno Setup's default `PrivilegesRequired` is `admin`, which was
never overridden — so Setup always ran elevated, `{autopf}` always resolved to
the real, restrictive Program Files, and the comment described a mode the
config never actually put into effect. `PrivilegesRequired=lowest` is the fix:
one line, and it is the only thing standing between the stated intent and what
the script did.

**Why `close` also got a deadline, not just the installer fix.** The installer
change stops this specific cause, but the handler had no way to notice *any*
failure of `Neutralino.app.exit()` — `void`-ing the call was indistinguishable
from success. `useWindowChrome.ts`'s `close` now races `exit()` against a 2s
timeout and calls `Neutralino.app.killProcess()` if it loses, logging through
`Neutralino.debug.log` so a future instance of this is a line in
`neutralinojs.log` rather than a silent report of "won't close."

**Why 2s and not a `.catch`.** The observed failure mode was the promise never
settling at all, not rejecting — the native side went silent partway through
its own shutdown. A `.catch` only fires on rejection; only a race against a
clock catches "never answers."

## A dropped connection reopens itself; it does not end the session

A connection the server hangs up on — an idle timeout, a failover, an
administrator's `KILL`, a load balancer reaping a quiet socket — used to present
as the app looking perfectly connected while nothing worked, and *Disconnect*
sitting for a minute before failing. Both halves had the same root and it was
not the one it looked like.

**The extension was dying, not the connection.** mysql2 and pg are both
EventEmitters that `emit('error')` when their socket fails with nothing in
flight, and an `error` event with no listener is Node's spelling of `throw`. That
reached `main.ts`'s `uncaughtException` handler, which shut the whole extension
down — **every other connection with it** — over one dropped socket. From the
UI, which is told nothing when the extension stops existing, that is a session
that looks open and answers nothing: every command waits out the bridge's 60s
timeout, *Disconnect* included. That is the entire "it takes ages to disconnect"
report; the disconnect was never slow, it was waiting on a process that had gone.

The mutation is worth keeping in mind, because the fix is one line per driver
and reads like housekeeping: deleting the `client.on('error', …)` registration
turns 178 passing tests into a suite where a killed Postgres backend logs
`uncaught exception` and every test after it — including every MySQL one — times
out. That is the failure the user sees, reproduced.

**Rejected: treating a drop as a disconnect.** Tidy, and it is what the session
slice already knows how to do. It also throws away every tab, every result and
every expanded tree node the user had open, over an event they did not cause and
that resolves itself. A connection is a piece of configuration plus a socket;
only the socket died.

**Rejected: an explicit Reconnect button.** The honest version of "we noticed,
you fix it". It buys nothing: the extension already opens a client per database
on demand, so reopening after a drop is an operation it performs several times in
a normal session anyway, and for IAM it was *already* minting a fresh token per
client for exactly this reason — a client outliving the ~15-minute token is the
case that design was written for. A button whose only effect is to do what the
next query does anyway is a step, not a safeguard.

**Not rejected, and the line that matters: the failed statement is never
retried.** Reopening happens on the *next* command, never as a second attempt at
the one that failed. The extension cannot know whether a statement reached the
server before the socket went, and a retried `INSERT` that had already committed
writes the row twice. This is the same instinct as *show what the server sent*:
being helpful about something you cannot verify is worse than surfacing it.

**Why two detections rather than one.** `Driver.onClientLost` catches a client
dropped while idle — the crash case, and the common one. It cannot catch a
client dropped *during* a query, because both libraries hand a network failure to
the waiting command when there is one to hand it to, and emit nothing. That path
left the dead client cached, so every command after it failed the same way for
the rest of the session — the other half of "everything looks fine but queries
don't work". `Driver.isConnectionLost`, asked of every failure, is the second
reading. Both are needed and neither subsumes the other.

**Postgres is why that predicate reads SQLSTATEs and not error classes.** The
first cut said "a `DatabaseError` came from the server, so the statement was
wrong; anything else is the transport". A backend killed by
`pg_terminate_backend` arrives as a perfectly ordinary `DatabaseError` — the
connection is over and the server said so politely — so that rule classified the
one case the feature exists for as a syntax error, and the real database test
caught it on the first run. It reads class `08` and `57P01`/`02`/`03` now, and
reads the *code* rather than the `severity` sitting next to it because a SQLSTATE
is five fixed characters while the severity is localised into the server's
`lc_messages`. mysql2 needs none of this: it marks every connection-ending error
`fatal` and marks nothing else that way, which is the library answering the exact
question being asked.

**Why the close got a deadline, and why 2s.** The same shape as
`useWindowChrome`'s `close` further up this file, arrived at independently: a
polite close waits to be told the connection is over, and a half-open socket has
nobody left to tell it. Only a race against a clock catches "never answers"; a
`.catch` fires on rejection, which is not what happens. 2s is long enough that a
healthy server always wins and short enough that a dead one is not a wait anybody
notices.

**Keepalive is prevention and is not the fix.** Both drivers set a 30s keepalive,
well under the ~350s an AWS network load balancer gives an idle connection — the
standard mitigation, and it makes the drop rarer. Everything above still exists,
because "rarer" is not "never" and the failure mode was catastrophic.

---

## Sorting wraps the user's query, which is the one rewrite this app allows

**Why this needs an entry.** Three earlier decisions in this file refuse to
rewrite a statement the user typed: paging arbitrary results, filtering them, and
write-back all landed on "the editor must not run something other than what is on
screen". Sorting a query's result needs exactly that rewrite —
`SELECT * FROM (<their sql>) squeal_sorted ORDER BY <col> <dir>` — so the refusal
is either wrong or this feature is. It is neither: the refusal was never about
wrapping, it was about **changing which rows come back**, and that is the line
being drawn properly now rather than moved.

**The distinction that carries it: a sort changes no rows.** Paging shows a
hundred of them and hides the rest. A filter shows the ones that matched. Both
make the grid a claim about a subset of what was asked for, which is why a count
beside them could not be honestly labelled and why both are still refused. A
wrapped `ORDER BY` returns the *same multiset* — the statement runs whole, inside
the parenthesis, and every row it produced comes back. There is nothing hidden to
be wrong about, which is the whole of the licence. There is a test that says so
directly (*sorting a query changes the order and never the rows*), and it is the
test that would fail first if this ever crept toward paging.

**It is also the user's own gesture, not the app being clever.** The rejected
rewrites were all things the app would have done on its behalf to make a control
work. A click on a header is a request, the arrow says which column and which way,
and a third click puts it back. The editor's text is never touched — it still
holds the statement as typed, and the wrap exists only for the length of one call.

**Rejected: sorting the rows already in the grid.** Tempting, because a query's
result has no paging, so every row is in memory and a comparator would need no
round trip at all. It is the same mistake as rendering a value through `Date` or
`Number`, pointed at the order instead of the value: a BIGINT arrives as a string
(`'9'` sorts after `'10'`), a timestamp arrives as the engine's own text, and text
collation is the server's rather than JavaScript's. The app would be reordering
rows by rules the database does not use and then showing the result as if the
database had produced it. Ordering is the server's answer for the same reason the
value is. The cost is a round trip per click, knowingly paid.

**Rejected: appending `ORDER BY` instead of wrapping.** Cheaper-looking, and
wrong for statements that are common rather than exotic: a query that already ends
in an `ORDER BY` becomes a syntax error, and a `UNION` takes the appended clause
as belonging to its last branch. Wrapping is the only form that works regardless
of what the statement does, which is what the backlog item asked for and what the
CTE/union case makes non-negotiable. The trailing semicolon has to be stripped for
the same reason — it would terminate the wrapper.

**Rejected: sorting by more than one column.** The gesture is a click, and a
second click has to mean something. Making it *add* a column needs a modifier
nobody discovers and a chip row to show what accumulated; making it replace is
what a header click means everywhere else. Clicking the same header cycles
asc → desc → off, and the third state is the one that matters: an unsorted browse
and an unsorted query are both real orders — the server's natural one, and
whatever the statement itself asked for — so "no sort" has to be reachable and has
to mean *the app adds nothing*, not *the app imposes ascending*.

**A browsed grid does not use the wrap, and that is not an inconsistency.** The
extension already authors the page SQL there, so the `ORDER BY` goes into it,
before the `LIMIT` — the whole table is ordered and the page is cut from that.
Wrapping the page instead would sort a hundred rows within themselves and leave
the pages in natural order, which looks correct on page one and is wrong from page
two. This is also why paging, applying a filter and the re-read after Save all
carry the sort: each is a fresh page, and a page cut under a different order than
the one on screen shows rows repeating across the boundary.

**The sort is in the staging page key.** `table@offset@filter@sort`, for the
reason the filter joined it: an edit is staged against a *row index*, and row 3 of
a table ordered by name is not row 3 of the same table in natural order. Leave it
out and re-sorting carries staged cells onto whatever landed in those positions —
a write to rows the user never saw, which is the exact failure the row-identity
design exists to prevent. A hand-typed query needs no such term because sorting
one re-runs it, and `runSeq` has already moved.

**The sort is not in the session snapshot, and the filter still is.** They look
alike and are not. A restored grid tab re-browses, so its filter has to ride along
or the tab comes back showing a *different set of rows* than it was left holding.
A sort changes no rows, so a restored tab without it shows the same table it
always did, in the server's order — the same thing every tab shows before anyone
clicks. Persisting it would also have to answer what a restored *editor* tab's
sort means, which is nothing until the query is run again.

**SQLite will not fail an unorderable sort, and the contract test says so.** A
double-quoted name it cannot resolve to a column becomes a **string literal**
rather than an error — the engine's oldest wart — so `ORDER BY "no_such_column"`
orders by a constant and is inert, where MySQL and Postgres both reject the
statement. Unreachable from the UI, which only ever sorts by a header it drew, so
the test asserts what is true on all three (the connection is still standing)
rather than asserting which engine it is talking to.

---

## Windows names its own processes, and it takes two mechanisms to do it

Task Manager labels a row with the executable's `FileDescription`, falling back
to the file name. Nothing here set one worth reading: `neu build` writes "A
Neutralinojs application" onto the shell binary, and `bun build --compile` leaves
the extension calling itself "Bun", carrying the Bun logo. So the app appeared as
a generic Neutralino row, an unrelated-looking Bun row, and a handful of WebView2
rows — nothing a user searching "squeal" could find. Naming both binaries makes
every row read "Squeal Editor" (and the webview ones "WebView2: Squeal Editor",
which Task Manager derives from its host).

**This names the rows; it does not merge them.** See the entry below for why
nothing can.

**Why two mechanisms rather than one.** `bun build --compile` accepts
`--windows-title`/`-description`/`-publisher`/`-version`/`-icon` and writes the
resource itself, which is also the only way to replace the Bun icon it embeds —
so the extension is named where it is built (`scripts/build-extension.ts`). The
Neutralino binary has no such switch and is not ours to compile, so
`scripts/stamp-version-info.ts` builds a `VS_VERSIONINFO` blob by hand and writes
it with `UpdateResourceW`. One binary each, each by the only route it has.

**The trap that makes a correct-looking stamp do nothing.** `neu build` files its
version resource under the **neutral** language, and `GetFileVersionInfo` reads
whichever it finds first — neutral sorts ahead of en-US. A resource written under
en-US therefore lands in the binary, verifies as written, and is never read: the
file still reports "A Neutralinojs application". The stamp has to overwrite the
neutral entry, not add a better one beside it.

**Ordering is load-bearing.** `neu build` rewrites the shell binary from `bin/`
every time, so stamping before it is thrown away; the installer reads the stamped
file, so stamping after it is too late. It runs between the two, and only on
Windows.

**Why the icon is wrapped rather than converted.** `--windows-icon` needs an
`.ico`, and there is no image library in this build. Windows has read
PNG-compressed icon entries since Vista, so the 256px source PNG is wrapped in an
ICO container as-is and Windows downscales it for the 16px row. Re-encoding to a
DIB would need a PNG decoder for no visible gain.

**What this does not fix: `cmd.exe` and `conhost.exe`.** Neutralino spawns an
extension through `cmd.exe /c`, so the real tree is app → `cmd.exe` → extension,
and cmd's console brings a `conhost.exe` with it. Both sit *inside* the group,
where they read as "Windows Command Processor" and "Console Window Host". Neither
is reachable from `neutralino.config.json` — the shell wrapper is how Neutralino
launches extensions, not something the `commandWindows` value chooses — so the
group is one entry with two rows in it that the app did not name.

---

## Task Manager cannot show this app as one entry, and the reason is the image path

The obvious ask — one "Squeal Editor" row that expands to the app's other
processes, the way Chrome and VS Code look — was tried and abandoned. Task
Manager's Processes tab groups **processes that run the same executable image**.
Chrome and VS Code get one entry because every helper is the same binary
re-invoked with different arguments, not because of anything they declare.

The app cannot be that shape. The shell is Neutralino's C++ binary and the
extension is a Bun binary, and that they are separate programs is the constraint
the whole architecture rests on. So they are two images, and Task Manager gives
two rows — plus `cmd.exe`, its `conhost.exe`, and the WebView2 processes, each a
further image of its own.

**What was tested and does not work: `AppUserModelID`.** It is the identity
Electron sets with `app.setAppUserModelId`, child processes inherit it, and a
shortcut can carry one (Inno Setup exposes it as `[Icons] ... AppUserModelID`).
Launching the app from a process holding an explicit AppUserModelID changed
nothing — the rows stayed exactly as they were. It governs taskbar and jump-list
grouping, not this list. There was also no way to reach the shell process with it
anyway: the Neutralino binary's startup is not ours to edit, so inheritance and a
shortcut property were the only vectors, and they are the same mechanism.

**The counterexample that settles it, visible on any machine with Docker
installed.** Docker Desktop is an installed app with Start Menu shortcuts, and it
still appears as two entries — `Docker Desktop (5)` and `Docker Desktop Backend
(2)` — because those are two different executables. If declaring an identity
could bridge images, Docker would not split.

**What is achievable, and was done, is naming** — see the entry above. It buys
the part of the complaint that had teeth: the app is now findable. Searching
"squeal" in Task Manager returns every process it owns, which is what someone
trying to force-quit it actually needs. Do not reopen this expecting the rows to
merge.

---

## An open connection's saved row cannot be edited

**The bug it fixes.** The edit form was reachable from the list while the
connection was open, and saving reached the stored row only — the running
connection had already read its host, user, password and read-only flag at
connect time and never reads them again. So the edit landed, the form closed on a
success, and everything on screen kept behaving the way it did before. Nothing
failed; the row and the session simply disagreed until the next connect.

**Refused at the list, not warned about in the form.** The form is a dead end
once its Save cannot mean anything, and offering the trip into it only to say no
at the bottom is the same shape as a server error about a statement the user did
not type. The row is where the decision belongs, so the row carries an `Open`
badge and a disabled *Edit*.

**The badge is the whole reason a disabled button is allowed here.** A control
that is off with no visible reason is a worse bug than the one being fixed. The
badge states the fact unprompted; the tooltip names what to do about it. It also
answers a question the connect screen could not answer before — the rail's "+"
lands you on a list that says nothing about which of these you are already on.

*Rejected: keeping the row's connection in step with the edit instead*, by
re-applying the changed fields to the live connection. Host, port and user cannot
be changed under an open socket at all, so it would have to reconnect — which is
a disconnect the user did not ask for, taking its tabs, its tree and its results
with it, dressed up as saving a form.

**`Delete` deliberately stays available on an open row.** Deleting says the row is
gone, which is true the moment it lands; editing says the connection is now this,
which is not. They are different claims and only one of them is false while the
connection is open. The session keeps running off a `savedConnectionId` that no
longer resolves, and what that costs — a session snapshot with nowhere to land,
orphaned stars — is a separate question from this one.

**Marked by `savedConnectionId`, never the runtime `connectionId`.** The latter is
minted fresh per session and is not what a row knows itself as; this is the same
distinction stars already draw.

---

## The grid trades native text selection for cell selection

**Why.** Dragging across cells has to mean "select these cells". The browser's
own answer to a press-and-sweep over a table is a text selection, and the two
cannot both have the gesture — so the grid's cells are `user-select: none` and
the sweep is ours. That costs the one thing the native selection was good for:
highlighting *part* of a value to copy it, a substring out of a long JSON blob
or a UUID's tail.

Accepted, because the thing it costs is already reachable and the thing it buys
was not. A whole cell copies with Ctrl+C, a rectangle of them copies as TSV, a
row copies from the menu, and a JSON cell opens in a drawer holding a real
editor where text selects normally. Every data grid this app is measured
against — DataGrip, TablePlus — makes the same trade for the same reason.

*Rejected: `preventDefault` on mousedown instead*, which suppresses the native
selection only once the press has already happened. It also cancels the focus
that press was going to give `grid-scroll`, and the keyboard surface — the arrow
keys, Ctrl+C, Delete — hangs off that focus, so it would have had to be handed
back by hand. One declarative rule beats an imperative cancel plus a repair.

*Rejected: turning `user-select` off only while a drag is in flight.* By the
time a drag is known to be one, the native selection has already started from
the mousedown — the rule would arrive a frame late, every time.

**`CellEditor` opts back in, and that is not optional.** `user-select` inherits,
and an `<input>` under a `none` ancestor cannot have its text selected in
Chromium — including by the `select()` the editor runs when it opens, which is
what makes double-click-and-retype work. The wrapper sets `userSelect: 'text'`
back on for exactly that.

---

## Testing a connection is its own command, and it keeps nothing

**Why a command and not `db.connect` with a flag.** A test is the opposite of a
connect in the two ways that matter: it answers no `connectionId`, and it never
touches the store. `db.test` opens a connection, asks the server its version, and
closes it in a `finally` before it resolves — so a draft that turns out to be
wrong cannot leave a half-made connection in the registry or a half-made row in
the list. A flag on `db.connect` would have made "register it" a runtime question
in the one function whose whole job is that `establish` means one thing.

**The version is the answer, not "connected".** "Something replied" is not the
question anyone has when they press Test; "did I reach the box I meant" is. So
the response is the server's own version string and nothing else, and the UI
prints it after the engine's label from `ENGINES` — the only engine knowledge the
renderer is allowed to hold. *Rejected: composing the product name in the
extension*, which would have to decide what to call a MariaDB server answering
under the MySQL driver. It passes the string on untouched instead, which is
*show what the server sent* pointed at a version. *Rejected: Postgres's
`version()`*, whose banner carries the compiler and the architecture — a
paragraph where a number was wanted; `current_setting('server_version')` is the
same fact without the build notes.

**`TestPassword` has a `stored` arm, and that is the feature.** Testing a
connection *while editing it* is the case with no other answer: the edit form is
never sent the password it is editing, so without this you could only test an
edit by retyping the secret you came here not to retype. It names a saved row and
the extension decrypts that one field — deliberately not `resolveSaved`, which
would also hand back the row's config, and the config is exactly what the form is
in the middle of changing. Same shape as `PasswordUpdate.keep`, pointed the other
way down the wire.

**The result is a slice, and the rule decided it rather than taste.** The version
crossed the bridge, so it is a slice; that it has one reader is not an argument
against one, the same answer `dialect` already got. What it is *not* is part of
`session`: a test holds no connection, so there is nothing for the rail, the tree
or a thunk to read off it, and letting it borrow that vocabulary would put
"connecting" state in a slice about connections that are open.

**Any edit withdraws the result**, keyed on the whole form rather than hung off
each handler. A green "Connected to PostgreSQL 16.13" sitting under a host that
has since been retyped is the app vouching for something it never reached — the
same class of lie as a stale badge, and the fix-a-field-and-try-again loop is
precisely when it would happen.

**No connect-progress broadcast.** `CONNECT_PROGRESS_EVENT` means "the connect
you started is at this phase". A test would set a phase that outlives it and
describes a connection that never opened, for a wait the button's own label
already covers.

**What it cost to find: `<Button>` had no `type`.** A `<button>` inside a
`<form>` is a submit button unless it says otherwise, so the first cut of *Test*
submitted the form as well as testing it. On the *new* form that was invisible —
the submit was disabled for want of a name and the save failed anyway. On the
*edit* form it saved the row and navigated to the list, so the result never
rendered and the failure read as "the test never answered". The fix is one line
in the primitive — `type = 'button'` as the default, with `type="submit"` stated
by the one button that means it, which every submit in the app already did. It
also silently fixes every Cancel in every form here, each of which had been
submitting its form and getting away with it because the handler navigated away
first.

## A connection's name is a label, not a key

**Why.** `UNIQUE (workspace_id, name)` made the name do two jobs, and the second
one was never true. Two rows in a workspace may honestly be the same server
twice — a reader and a writer, a replica and its primary, the same host under two
credentials — and the app already tells them apart by their colour strip and by
the server each row names. Refusing the second one made the store the authority
on a question only the user can answer.

**Rejected: keeping it and offering a suffix.** `api (2)` is the app naming
something on the user's behalf, and it names it worse than they would have.

**Rejected: dropping it and adding the host under each row.** Considered, and it
is the obvious mitigation — but the list already carries a colour strip and an
environment heading, and a second line of grey text on every row to disambiguate
a case most people never hit is paying for the exception in the common path. It
stays available if duplicates turn out to be confusing in practice.

**What it cost: SQLite cannot drop a constraint, and this table has children.**
`connection-names-not-unique` is long for reasons worth writing down, because
every shorter version of it silently destroys data.

- **The rename-aside dance no longer works here.** It is what `workspaces` did
  the last time this table was rebuilt, and modern SQLite rewrites the
  `REFERENCES` clauses in *other* tables to follow a rename — so `stars` and
  `connection_sessions` would come out pointing at `saved_connections_old` and
  lose their parent when it is dropped. `PRAGMA legacy_alter_table = ON` is the
  documented switch for that and **does not take effect**, because the runner
  wraps every migration in a transaction. Tried, and the evidence was two empty
  child tables.
- **`DROP TABLE` is an implicit `DELETE FROM`.** `store.open()` sets
  `PRAGMA foreign_keys = ON` before the migrations deliberately, so dropping the
  parent cascades into every star and every saved session. That pragma cannot be
  turned off from inside a transaction either.

So the children are lifted into carry tables, dropped, and rebuilt around the new
parent — with their DDL spelled out in full rather than reached for from the
migrations that made them, per the freezing rule. `PRAGMA foreign_key_check` runs
at the end, inside the transaction, so a rebuild that orphaned anything fails the
migration instead of shipping a store that is quietly wrong.

**The test is the point of the whole exercise.** *the rebuild keeps the stars and
sessions hanging off it* (`saved.test.ts`) is the only thing standing between a
future edit here and a release where everyone keeps their connections and loses
every star and every restored tab. The rewind's `UNDO` entry is the same dance
inverted, and it is much shorter — `rewindTo` runs with `foreign_keys = OFF`,
which is exactly the pragma the migration could not reach.

## The connect form allows the submit and says what is missing

**Why.** A disabled *Connect* states that something is wrong and nothing about
what. On a form this long — engine, name, environment, colour, host, port,
database, method, user, password, two toggles — that leaves the user comparing
the form against itself to find the empty box. Pressing the button and being told
is one step; hunting is unbounded.

**Rejected: a summary callout listing what is missing.** It duplicates
information that belongs beside the fields, and it makes the reader map names
back onto controls. Considered together with per-field marks and dropped as noise
on top of the answer.

**Rejected: validating on blur.** It reddens a field the moment you tab out of it
on the way to filling in the next one, which is the same scolding the `submitted`
gate exists to prevent, just earlier.

**The mark lives in the label's hint slot.** `<Field hint>` already draws text
beside the label, so `required` in `--red-text` goes there rather than into a new
line under the control — the row does not change height when a field is marked,
and nothing below it moves. The control gets `borderColor: RED` and
`aria-invalid`; `style` is applied last in `<Input>`/`<Select>`, so the red beats
the focus accent on the field being focused.

**`missingFields` returns a list, not a set.** The first entry is focused, and
"first" has to mean the topmost field on screen. A `Set` would focus whichever one
it happened to iterate to, which reads as the form picking at random.

**Only the exceptions are labelled.** Nearly everything here is required, so
`(required)` on eight fields is eight labels carrying no information;
`(optional)` on the three that are is the same fact stated where it is
surprising.

**What it cost to find: `required` and the browser's bubble.** The inputs carried
`required`, which meant the browser refused the submit and popped its own
validation tooltip *before* the handler ran — the very "you may not submit this"
being replaced, in a style this app has no control over. Removing the attributes
and adding `noValidate` to the `<form>` are part of the change, not tidying.

## The colour picker expands in place, rather than opening a panel

**Why.** Nine swatches always visible is a wall of colour above the fields that
actually address a server, and it puts the least consequential choice on the form
in the most prominent state. A floating panel is the other reflex and it is a
dropdown wearing a different hat: a layer to dismiss, an outside click to handle,
and a popup that has to be placed.

**The row is the sub-menu.** At rest the field is one 32px tile showing the
current hue, beside the environment select. Clicking it expands the nine swatches
across that same row; picking one, or the trailing `×`, collapses it back. The
tiles are the same 32px as the select they replace, so the row is exactly as tall
in both states — nothing below it moves, which is what makes the expansion read
as the row changing its mind rather than as the form reflowing.

**It shares a row with the environment because they are the same kind of fact.**
Both say *which connection this is*, not how to reach it — the colour is what the
rail chip and the saved-list strip spend, and the environment is its heading.
Host and port are the other question entirely.

## AWS SSO signs in through the user's own CLI, not inside the app

**Why.** An expired SSO session is the common, recoverable failure on an IAM
connection, and the only fix used to be a terminal the app never mentions again.
*Sign in to AWS* on the connect form runs `aws sso login --profile X` in the
extension and reports what it said.

**Rejected outright: rendering the login in an iframe or a webview panel.** Asked
for, and it is the wrong shape twice over. Identity providers send
`X-Frame-Options` / `frame-ancestors` precisely to stop being framed, so most
corporate IdPs would refuse to render at all — but the reason it stays refused
even where it works is that an app-controlled frame around an identity provider's
login page is indistinguishable, to the person typing into it, from a
credential-phishing page. The browser's own URL bar is the thing being taken
away, and it is the only thing that makes the page trustworthy.

**Rejected: the OIDC device flow in the extension.** It is what the CLI does, it
needs no CLI installed, and it was the better answer on paper. The CLI owns the
SSO token cache that `fromIni` reads — where it lives, how the files are named,
what a refresh writes into it — so a second implementation would be a second
writer of that cache that has to keep agreeing with the first one forever, and
would be wrong the first time AWS changed any of it. Shelling out costs a
dependency on the CLI being installed and buys never having to track that.

**The answer is a slice of its own, beside `connectionTest`.** Both crossed the
bridge, so both are slices; they are two because a test describes the whole form
and is withdrawn by any edit, while a sign-in describes one profile and survives
everything except that profile being retyped. `signedIn` holds the profile name
rather than `true`, so a success message cannot vouch for a profile the field no
longer names.

## The checkbox is drawn by the app, because two platforms drew it differently

**Why.** The recipe was a native `<input type="checkbox">` with
`accentColor: ACCENT`, which is the right instinct — the platform's control, one
token for the hue. It is only right on one platform at a time. WebView2 and
WKWebView each draw the box at their own size, with their own corner radius and
their own tick, and honour nothing but the fill: the same checked state wore two
different marks on Windows and macOS, which is the one thing a design system
cannot express.

**`appearance: none` takes away the paint and nothing else.** It is still a real
`<input type="checkbox">` — focus, Space, the label association and the form
value are the platform's and stay so. The standing rule ("do not rebuild it out
of divs and lose the platform's focus and keyboard behaviour") is about giving up
the input, not about drawing the box.

**The tick is a sibling `<span>`, not a `::after`.** The obvious implementation is
a pseudo-element on the input, and Safari renders no pseudo-element on an
`<input>` at all — which would have been the same cross-platform inconsistency one
layer down, discovered later. A sibling positioned over the box works everywhere
and costs one element.

## The AWS sign-in shows the URL and the code, because that *is* the sign-in

An addendum to *AWS SSO signs in through the user's own CLI*, above, and the
reason the first cut of it did not work.

**What was missed.** `aws sso login` was treated as a command that either
succeeds or fails, so its output was collected and shown only once it exited. It
is not one. The CLI runs **device authorization**: it prints a verification URL
and a user code, *attempts* to open a browser, and then polls until someone
approves them. The URL and the code are the entire interaction, they arrive
seconds in, and the command does not exit until minutes later — so collecting
them meant hiding them for exactly as long as they were the only things that
could let the login finish. A browser that failed to open was indistinguishable
from an app that had hung, until the 5-minute kill.

Verified rather than assumed: a spawned CLI with a piped stdout was observed
calling `StartDeviceAuthorization`, which is the flow that prints a code.

**So the prompt is a broadcast**, `AWS_SSO_PROMPT_EVENT` — the fourth, and the
same shape and the same reason as `connect.progress`: it describes something the
command is still doing, so it cannot ride back on the command's reply.

**The UI opens the URL, not the extension.** The extension already spawned the
CLI and could open a browser itself, but that is the call `app.dataDir` already
decided the other way: the webview has `Neutralino.os.open` and the extension
should hand back what it knows rather than grow a second answer. The CLI's own
browser attempt stays in place, so the button is the fallback rather than the
route — and passing `--no-browser` to guarantee we are the only opener was
rejected for that reason: it would trade a working common case for a click.

**What it cost to find: the last line has no newline.** The code is the final
thing the CLI prints and its newline only arrives when the login completes, so a
reader that splits on newlines and drops the remainder never reports the code at
all — while the login is exactly the thing waiting on it. `readPrompts` buffers
partial lines and flushes the remainder at end of stream, and `iam.test.ts`
pins it at one byte per chunk.

## Cancelling a connect belongs in the form's own actions row

**Why.** `ConnectScreen` renders one abort, under everything else on the card.
Every screen it serves is short enough for that to be fine except the one that
matters most: the connect form is taller than the window, so the button that
stops the attempt sat below the fold at the moment it was the only control worth
having. Measured, not guessed — 905px down a 786px viewport.

**So the form takes the job over while an attempt is in flight**, and the screen
suppresses its own block for that one view. The actions row is where the user
just clicked, which is the same rule as *errors render where the action was
taken*. It also scrolls itself into view, for the submit that came from Enter in
a field near the top rather than from the button.

**What it cost to find: a cancelled attempt leaves a saved row.** `submitNew`
saves before it connects, so aborting leaves a real connection behind — and
pressing *Connect* again saved *another* one. The store's duplicate-name check
used to catch that by accident, and dropping it (see *A connection's name is a
label, not a key*) removed the accident along with the rule. `draftRowId` is the
fix: the first submit remembers the row it wrote and every retry edits it.
**Two changes that were each right made a third thing wrong**, which is the only
interesting part of this entry — the abort is what made retrying common enough to
notice.

## Which leg a connect died on is the phase, not the message

The AWS sign-in had to be offered beside a *failed* saved connection, not only on
the form — a stored IAM connection whose SSO session lapsed is the case that
actually happens, and the fix used to be a message telling the user to go and
find a button on another screen.

**The question is "did this fail at AWS or at the database", and there are two
places to read it from.** The error string is the obvious one and the wrong one:
`mapAwsError` composes that text in the extension, and matching on it in the
webview would be the same fact written twice in two files that nothing keeps in
step. A reworded message would silently stop offering the fix, and no test would
notice.

**`connectingPhase` already answers it, structurally.** The extension emits
`iam-token` immediately before minting the token and `connecting` immediately
after, so a rejection arriving while the phase still says `iam-token` *is* a
credentials failure — by construction, not by inference. `awsCredentialsFailed`
is that comparison, made in the rejection reducer before the phase is cleared.
It was already broadcast for the progress line; this is the same fact read for a
second purpose rather than a second fact.

*Rejected: carrying a typed error code across the bridge.* `DbResponse` is
`{ ok: false, error: string }` and widening it to classify failures would touch
every command to serve one. The phase was already there.

**A cancel is excluded.** Stopping an attempt mid-token is the user withdrawing
the question, not the credentials being wrong, and offering a sign-in for it
would be answering something nobody asked.

**The profile is resolved from the saved row, not carried through the store.**
`ConnectScreen` holds the connection it was connecting (`connectingId`), and that
row has `config.iam.profile`. Putting it in `session` state would be a second
copy of something already on screen — and `connectingId` being the only source of
it is also what keeps the offer off the connect form, which has its own sign-in
and its own profile field.

**The retry is in the click handler, not an effect.** `signedIn` stays set after
a successful sign-in, so an effect watching it fires again on the next render
that touches it — reconnecting behind the user's back after a second failure.
Awaiting the sign-in and then retrying, in one handler, runs exactly once per
click. `useAwsSignIn().start` returns whether it completed for that reason.

## The AWS credentials are checked before the connect, not by it

An addendum to *Which leg a connect died on is the phase*, above. That entry
made a failed IAM connect recoverable. This one stops most of them being
failures at all.

**Why.** A lapsed SSO session is the commonest reason a stored IAM connection
will not open, and it has nothing to do with the database. Letting the attempt
run and fail paints a red *could not connect* over what is really a step the user
has not taken yet — and it says it about a server that was never contacted.
`aws.credentialStatus` resolves the profile through the same `fromIni` the token
mint uses and stops before any socket is opened, so `pick` can decline to connect
and say *sign in first* instead. Measured at ~120ms for a negative answer.

**It resolves rather than rejecting**, and that is the shape the whole thing
turns on: "not signed in" is an answer, and one the caller acts on differently
from an error. A rejection would be indistinguishable, at the call site, from the
very connect failure this exists to pre-empt.

**A check that cannot be made answers *valid*.** If the bridge call itself fails,
the thunk returns `valid: true` and the connect proceeds. A question the app could
not ask must never stand between the user and a connection that might work
perfectly well — and the connect's own failure is still there to catch it.

**It is a reduction, not a guarantee, so the after-the-fact offer stays.**
Credentials valid at the check can lapse before the token is minted a moment
later. Two mechanisms for one problem would normally be a smell; here the second
is the backstop for the first being a snapshot.

**What it cost to find: the button was withheld from the case it exists for.**
The first cut offered *Sign in to AWS* only when `awsFailureKind` recognised an
expired SSO session, on the reasoning that a button which cannot work is worse
than none. That is true and it was the wrong default: the credential-provider
chain has no stable error shape, so `other` is where an unfamiliar
never-signed-in failure lands — and offering nothing there is offering nothing in
precisely the situation the feature was built for. Inverted: the button appears
unless the profile is *missing*, which is the one kind no login creates. A
sign-in that turns out not to help says so in its own words.

**And the missing-profile detection was wrong about the real message.** An
unknown profile does not say "could not be found"; the chain says *"Could not
resolve credentials using profile: [x] in configuration/credentials file(s)"*,
which fell through to `other`. Found by running it, not by reading it. The
phrasing is broad enough to swallow a lapsed session too, so it is tested
**after** the SSO checks — order that `iam.test.ts` pins, because getting it
backwards silently withholds the button again.

## A connection that cannot be opened yet is veiled, not clicked and refused

This supersedes the placement in *The AWS credentials are checked before the
connect*, above. That entry's reasoning holds — the check is right, and doing it
before any socket opens is right — but it put the check on the **click**, and the
click is already too late.

**Whether an IAM connection can be opened is a fact about the row.** It does not
depend on anything the user is about to do, so making them ask for it is making
them discover it. The list now asks `aws.credentialStatus` for every distinct IAM
profile it draws, as it draws them, and a profile that cannot mint credentials
dims its rows, disables their pick target, and reveals a pane over it carrying
*Sign in to AWS*.

**The veil is a new visual device, adopted deliberately and narrowly.** The
system has one background and no elevation, and the veil does not break that: it
is the same `--bg`, laid *over* content rather than under it. What earns it is
that the row has to stay legible — its name, colour strip and server are what
tell you which connection you are being asked to sign in for. `--scrim` is the
same move for the modal and is black for the opposite reason: that one dims the
whole app, this one veils one row of it.

**And it is glass rather than blur, which is the second thing this got wrong.**
The first cut blurred the row, and blur is precisely the effect that destroys the
one thing the pane exists to preserve — you could no longer read which connection
was being asked about, which is the whole justification for veiling it rather
than replacing it with an empty state. What replaced it lifts the backdrop
instead of softening it (`saturate` and `brightness`), grades `--veil` toward
`--veil-deep` at the trailing edge, and adds a sheen and a hairline on top.
Light *added over* the one background, never a lighter surface under it.

*Superseded on the blur, and only on the blur, by* **The veil blurs after all,
because the blur is masked** *below. The objection above stands and is what the
mask answers; the sheen, the grade and the hairline all survive.*

**Two placement lessons, both from looking at it rather than reasoning about
it.** The pane is a `<button>` in its own right, not a button centred inside a
`<div>`: it is already row-width, so a small control floating in it leaves nine
tenths of an obviously interactive surface inert. And its label sits against an
*edge*, not centred — centred, it landed squarely on the connection's name and
engine badge with the row's own text either side of it, which is the collision
the glass was chosen to avoid.

*Superseded on which edge, by the same entry below: the chip is at the leading
one now, and the frost was mirrored to follow it.*

**It reveals on hover, so the row is dimmed at rest.** Without the dim, a blocked
row is indistinguishable from a live one until the click that does nothing.
Revealing on focus as well as hover is the same amendment the row's own Edit and
Delete already needed, and `pointerEvents` tracking `opacity` is the same trap:
an invisible pane over the row eats every click.

**Keyed by profile, not by connection.** Several IAM connections commonly share
one profile, so one check lights or clears every row that names it.

**The list asks on every render pass that could have changed the set, and the
thunk's `condition` makes that free** — the arrangement `loadColumns` already has
with the completion provider. A component should say what it needs, not keep a
private record of what it has already asked.

**Unknown is not blocked.** Gating on "not asked yet" would grey every IAM row
for the first beat after the list appears, which reads as broken rather than as
careful. Only an answered `valid: false` veils anything.

**The veil covers the click target and nothing else**, so a row you cannot open
is still one you can edit or delete — editing the profile name being one of the
two ways out of the state.

**A successful sign-in forgets the profile rather than marking it good.** The CLI
exiting zero means it wrote the token cache, not that `fromIni` will resolve
against it; the entry is deleted and the list asks again, which is the same
question that gated the row.

**And `pick` stopped checking entirely.** With the row gated, the answer is
already known by the time the click happens, and re-asking would put a beat of
nothing in front of every IAM connect to re-learn what the row already shows. The
offer beside a *failed* connect stays as the backstop, for credentials that lapse
between the list being drawn and the token being minted.

**The sign-in split into a button and a status for this.** One CLI runs at a
time, so the URL and code it is waiting on are rendered once per screen, while
the button that starts it belongs on each row it would unblock.

---

## Saved queries are global, and a tab remembers which one it is

**Why global.** A saved query is text. The same statement is worth running
against a dev box and its replica, so filing it under a connection would mean
saving it twice to use it twice — and the second copy would drift. `saved_queries`
is therefore the one table in the store that references nothing, and `queries.*`
drops the `db.` prefix the way `settings.*` already does: it is about nobody's
server.

**Cost, accepted.** A query that only makes sense on one schema is offered
everywhere, and running it elsewhere fails as any wrong query does. Scoping was
the alternative and it buys a shorter list at the price of the thing the feature
is for.

**Why the tab carries `savedQueryId`.** Without it, Ctrl+S can only mean *save
another copy*: every press asks for a name again and the list fills with
`revenue`, `revenue 2`. With it, a tab opened from a query — or one that has been
saved once — writes over that row and asks nothing. It is one optional field on
`Tab`, and it earns a place in the session snapshot for the same reason the text
does: a link that does not survive a quit is a tab that silently reverts to
asking.

*It is not the exception to "the snapshot leaves runtime ids out" that it looks
like.* What that rule excludes is tab ids, minted fresh each session. A saved
query's id is the extension's and outlives every session, which is exactly what
makes it writable down.

**A silent save needs a visible answer, and the answer is a flag on the tab.**
*Rejected: a toast, and a status-bar line.* The bar carries facts about the
active connection, and a query belongs to none; a toast is a thing to dismiss for
an action that succeeded. The mark beside the tab's name is the whole of it.

*It was a comparison first, and that was the wrong question.*
`sqlByTab[tab.id] !== query.sql` looked like the cheaper answer — both halves
already in the store, no field to keep in step — but what it computes is *this
text is not what is on disk*, which is a fact about the **query** and therefore
true of every tab holding it. Two consequences, both reported from real use and
both about edits the user had not made: saving one copy of a query lit the mark
on every other copy, and deleting a query lit it on all of them at once. The
question the mark is actually asking is *has this tab been edited since it was
opened or last saved*, which nothing but the tab can answer, so `Tab.unsaved`
carries it — set by `sqlChanged`, cleared by `tabSaved`.

## Two tabs on one saved query are two views, not two copies

**Why.** The first cut treated them as independent: each tab held its own text
and saved its own, so the same query could be open twice showing two different
statements, and whichever tab you happened to press Ctrl+S in silently won. That
is not what "the same saved query" means to anyone looking at it.

**So the save lands in all of them.** `tabSaved` writes the saved text, the name
and a cleared mark into every tab carrying that `savedQueryId`. Saving is the
*query* changing, so every view of it changes.

**Cost, accepted, and it is the real one:** a sibling tab holding edits of its
own loses them to that save. Two views of one file are last-write-wins in every
editor there is, and the alternative — two tabs claiming to be the same query
while showing different text — is the state this replaced.

*Not extended to live keystroke-by-keystroke syncing*, which is the other way to
be honest about "one query". Saving is a moment the user chose; propagating every
keystroke into a tab they are not looking at is a lot of machinery, and it would
end the one thing having the query open twice is good for — reading the old text
beside the new until you commit.

**It cost the editor its second inbound writer**, and that is the part worth
knowing before touching `EditorPane`: the tab being written to is usually a
*background* one, whose model already exists, so seeding at creation cannot serve
it. The write is a full-range edit applied only when the value differs from
Monaco's own — see *Text flows one way* in `docs/frontend.md` for why both halves
of that are load-bearing.

**Two things follow from the flag that the comparison got for free**, and both
are the kind that would otherwise be found by looking at a wrong dot. Opening a
saved query has to seed its text *in the open action* rather than through a
following `setSql`, since a `sqlChanged` is what marks a tab edited and the tab
would be born dirty. And a save has to clear the mark when it **lands**, not when
the key is pressed, so a write the extension refuses leaves the tab still saying
it holds edits — which is also the only report that failure gets.

**Names are unique, checked in words.** This follows the *workspace's* rule and
not the connection's, and the difference is what the name is for: the picker
addresses a query by its name and has nothing else to tell two apart with, while
two connections called `api` are honestly two servers and are told apart by
colour and address. See *A connection's name is a label, not a key* above for the
other half of that pair.

**A save under a deleted id is refused, not resurrected.** The tempting
alternative — insert it back under the same id — writes a row someone deliberately
removed, from a tab that happened to still be open. The refusal is what lets the
UI fall back to asking for a name, which is the honest reading: this tab is
unsaved again.

**The picker is beside the tab strip, not inside it.** The strip scrolls once
there are more tabs than fit, so a control inside it scrolls away with them. This
is the same shape as the status bar sitting outside the `.app` grid: something
that must hold for the whole strip does not live in the part of it that moves.

---

## A migration that throws is silent until the migration after it matters

**What happened.** `saved_queries` did not exist on a real store, reported as
`no such table` the first time Ctrl+S was pressed. The saved-queries migration
was fine. `connection-names-not-unique`, three places earlier in the list, was
throwing `NOT NULL constraint failed: saved_connections_rebuilt.color` — and
`runMigrations` walks the list in order, so everything after it had never run on
that file and never would, on any launch.

**The defect underneath.** `connection-colour` declares
`color TEXT NOT NULL DEFAULT 'slate'`; the column on that store was a bare
nullable `TEXT` with three rows holding NULL. The rebuild's
`SELECT … color …` therefore inserted an **explicit** NULL, and an explicit NULL
bypasses a column default rather than falling back to it. `COALESCE(color,
'slate')` is the fix — the neutral swatch `connection-colour` already promises a
colourless connection gets.

**Why the migration was edited rather than a new one appended.** Appending
cannot work here, and that is the whole shape of the problem: a later migration
never runs, because the failing one is what stops the walk. Editing a shipped
migration is normally forbidden (see the rules in `migrations/index.ts`), and the
two things that make it right in this one case are worth stating so the exception
is not read as a licence: it was **unreleased** — on `dev` only, no tag contains
it — and `COALESCE` over a non-null value is a no-op, so a store where it already
succeeded is unaffected either way.

**The rule this leaves behind.** A rebuild is the only statement that reads every
row and writes it back under a new constraint, so it is the one place a column's
*declared* shape and the values *actually in it* have to be reconciled. Do not
trust the list's account of what is on disk when rebuilding — `COALESCE` every
NOT NULL target that any earlier version could have left null.

**And the lesson about the symptom.** A failing migration never reports itself as
a failing migration. It reports as a missing table, a missing column, or a
feature that silently does nothing — attributed to whatever was added *last*,
which is the code most likely to be blamed and least likely to be at fault. When
something the store should hold is not there, read `schema_migrations` before
reading the feature: the gap is the answer, and the last row is where the walk
stopped.

---

## The engine layer became one file per engine, with the contract left central

**What it was.** `drivers.ts`, 1,900 lines: the `Driver<C>` contract, the
engine-neutral assemblers, and all three engines' SQL interleaved in one file.
Adding a fourth meant growing it, and the "add an engine" the docs promise was
buried three implementations deep.

**What it is.** `extensions/db/drivers/` — `driver.ts` (the contract),
`common.ts` (the assemblers), `index.ts` (the barrel and the dispatch), and one
file per engine. Structure only: not a line of SQL changed, and every engine
still answers the same contract tests.

**Why the split lands where it does.** The cut is "what must not differ per
engine" against "what only makes sense inside one". `pickRowKey`,
`pickForeignKeys`, `runWrites`, `buildWhere` and `orderByClause` are central
because a second answer to *what counts as a row identity* or *how a filter is
assembled* is a bug that only shows up on one engine — which is the same reason
they took `quoteIdent` and `placeholder` as callbacks before there were three
files to keep honest. `splitRelation` went the other way, into `postgres.ts`: it
is Postgres guessing a schema out of punctuation, and nothing else ever calls it.

**The barrel rule is the load-bearing part.** `connection.ts` imports
`drivers/index.ts`, never `drivers/postgres.ts`, exactly as both sides import
`shared/protocol/index.ts` — so a helper can move between `common.ts` and an
engine without touching a caller, which is the thing that makes the boundary
adjustable rather than another wall. The engine files themselves are the one
exception, importing `driver.ts` and `common.ts` directly, because importing the
barrel that imports them is the cycle.

**What this does not license.** A file per engine makes an `if (engine === …)`
inside `connection.ts` cheaper to write and no less wrong. `LIMIT/OFFSET` and the
sort wrapper still live there because all three engines spell them identically;
the first engine that does not makes them `Driver` methods, which is now a method
on the contract and a line in each of four files — visible, and the point.

---

## Completion quotes an identifier only when it needs it

**The bug.** Accepting a Postgres column suggestion inserted it exactly as
labelled, so a mixed-case name like `createdAt` landed unquoted and the query
failed with `column "createdat" does not exist` — Postgres folds an unquoted
identifier to lowercase before it looks the name up. Every ingredient of that
failure came out of the catalog: the popup offered the spelling the tree shows,
and the server was then asked for a different column. It is the filter bar's own
bug (*Leaving identifiers bare was a bug, reported against a real column*)
arriving at the one other place the app writes an identifier into SQL.

**Why the fix is not simply `quoteIdentifier`.** That function exists, is right,
and is used unconditionally everywhere else — the filter bar's `WHERE`, copy-as-
SQL, and `Driver.quoteIdent` in the extension. Unconditional is correct there
because **nobody reads that SQL**: `"users"."email"` costs nothing when it is
assembled, sent and thrown away, and a "does this need quotes" branch would be
one more thing to get wrong for no gain. Completion is the one place where the
text is the user's own document. Quoting every suggestion would put quotes
through every query anyone writes, and that is a worse editor.

So `quoteIdentifierIfNeeded` sits beside it, sharing the quote character and
differing only in when it fires, and the split is stated as which side reads the
result rather than as a preference.

**"Needs it" is per dialect and deliberately narrow.** It is one regex per
dialect: Postgres is the engine that folds, so anything holding an uppercase
letter needs quotes there; MySQL and SQLite keep the case they are given, so
only what cannot be spelled bare at all (a space, a leading digit) does. A
**reserved word** needs quoting too and is not detected — separating the
reserved words from the many keywords that are ordinary column names (`name`,
`value`, `text`, `key`) takes a per-dialect list, and a generous guess would
quote half the columns there are. The narrower rule fixes the reported bug and
leaves a smaller one open; a list would fix both and make every query noisier.

**A quote the user typed is theirs.** With `SELECT "crea` on screen the name is
inserted bare, because ours would spell `""createdAt"`. The alternative
considered was widening the replaced range to swallow the character they typed,
which is worse: accepting a suggestion would then delete text the user meant,
and for a lowercase name it would silently unquote a query they were quoting on
purpose.

**Verification is the query running, not the text.** The UI test accepts the
suggestion *and presses Run*, asserting no error comes back. The text assertion
alone is a proxy, and the failure being fixed was a statement that looked
perfectly reasonable on screen. MySQL carries the paired test — the same column,
inserted bare — which is what proves the rule branches on the dialect rather
than happening to look right on whichever engine was tested first. The same
pairing the filter bar's fix already needed.

---

## `awaitPromise` needs the page-side promise rooted, or the GC takes it

**The symptom.** Adding two UI tests that accept a completion made the Postgres
block fail *about half the time* — a dozen tests at once, none of them the new
ones, starting with a stack pointing into the harness (`Promise was collected`)
and continuing with every test after it finding a screen the aborted one never
cleaned up. It reproduced on and off with the same bundle, so it read as the new
tests being wrong and then as the app being wrong.

**The cause.** It is not Bun's GC collecting one of the harness's promises — it
is CDP error `-32000` from the *page*. `Runtime.evaluate` with `awaitPromise`
holds the evaluated promise **weakly**, so a page GC while the reply is pending
takes the value the inspector is waiting on, and the reply comes back as that
error instead of an answer. Every `REACT_SETTERS` script (`pickOption`,
`optionsOf`) evaluates to a promise, so those are the ones exposed. The new
tests never caused it; opening and accepting Monaco's suggest widget produces
enough garbage to make a GC land in that window.

**The fix is one line of the harness**: the evaluated expression is now
`window.__squealEval = eval(<the script>)`, so the promise is rooted in the page
for as long as the reply takes. `eval` rather than a wrapping function because
these scripts are statement lists whose *completion value* is the answer
(`foo(); true;`) — there is no `return` for a wrapper to carry out, and `eval`
is the one construct that hands back a statement list's completion value.

**The lesson worth keeping.** A failure whose stack is in the harness and whose
victims are a run of unrelated tests is a *lifetime* problem, not a logic one,
and the first suspect should not be the code under test. Reading the error's
`code`/`message` off the protocol — rather than the exception the harness
rethrows — is what named it: the string is the same either way, and only one of
them is the page's.

---

## The veil blurs after all, because the blur is masked

This supersedes *"it is glass rather than blur"* in *A connection that cannot be
opened yet is veiled*, above — and only that. The objection recorded there is
correct and is exactly what this arrangement answers: a pane that hides which
connection it is asking about has thrown away its own justification.

**The mask is the whole idea.** The frost layer carries
`blur(--veil-blur) saturate(1.3)` behind a `mask-image` that is opaque under the
chip at the leading edge and thins away to `transparent` across the row.
Everything the mask governs travels together — the blur, the wash and the
hairlines — so the trailing end of the row is untouched: the server line stays as
sharp as on a row that is not blocked, and it is what still says which connection
is being asked about, since the chip covers the name. What the earlier entry
rejected was blur *across the row*. Blur that stops is a different thing.

**A `mask-image`, never a `clip-path`.** A clip would take the uncovered half out
of the element's hit target, and the whole pane being the click is the other
half of this design.

**The short feather at the leading edge is not symmetry, it is a seam.** The
pane's own edge falls mid-row, beside the colour strip, and frost cut off square
there drew a vertical line down the row — a rectangle pasted over it rather than
glass lying on it. Six percent of fade is all it takes, and it was only visible
by looking: reasoning about the mask produces the long ramp and never the short
one.

**The fade-in must live on the frost element itself.** An *ancestor* whose
opacity is between 0 and 1 becomes a backdrop root, so a pane fading from 0 to 1
with the blur on a child leaves that blur sampling an empty group for the whole
transition and snapping in at the end. Opacity on the blurred element is fine —
that is the element's own result being faded, not its backdrop being isolated.
So the pane holds no opacity at all now; the frost and the chip each carry their
own, and `pointerEvents` tracks the reveal flag rather than an opacity value.

**The label gained a ground, and that is a consequence of the mask, not
decoration.** The label is the one thing deliberately *not* masked — it must stay
readable whatever is under it — so a long one runs out past the frost and lands
on row text that is still sharp. A ground of its own keeps them apart, and a 72%
cap keeps it inside the frost.

**And the ground is the primary button, because that is what this is.** The
translucent glass chip it started as was the third try and the wrong one: it
matched the veil beautifully and said nothing about being the one action the row
is waiting on — a word floating on frost, in a pane that has no box of its own to
say otherwise. Solid `--accent` with `--on-accent` on it, `--radius` at
`--button-h`, which is also what puts it on the same line as the row's own
*Edit*. The shape grammar decides this outright and both halves of the pane obey
it: the sign-in is a button, so 6px; *Profile not set up* is a state, so a pill.
Neither can be the real `<Button>` or `<Badge>` — the pane itself is the
`<button>`, and a button cannot contain one.

*No hover state on it, unlike a real `<Button>`.* The pane is only up while it is
already hovered or focused, so a hover fill would be the only fill ever seen.

**The chip sits at the leading edge, and the frost was mirrored to follow it.**
The trailing edge was the first arrangement and it is where the row has nothing
of its own — but it puts the one thing on this pane worth reading at the end the
eye arrives at last, behind the name it is not about. Leading, it is the first
thing read, at the cost of covering that name. What pays for that cost is the
mask: the frost thins out before the server line, so the row still identifies
itself by its host while the chip is up. A veil whose chip covered *everything*
would be an empty state with extra steps, and that is the line this stays on the
right side of.

**Which is also why the missing-profile pane stopped rendering its reason.** That
string names the profile, so it is as long as the profile is — wide enough to
cover the connection it is about. The chip says *Profile not set up* and the
reason is the pane's `title`.

**Verified by driving the real app, not by reasoning about the CSS.** A masked
`backdrop-filter` is exactly the kind of thing a WebView either does or does not
do, and the seam and the collision were both invisible until there was a picture:
a scratch harness seeded a store with an SSO profile that cannot mint credentials
(`AWS_CONFIG_FILE` pointing at a throwaway config is enough — `fromIni` reads it),
hovered the row over CDP and screenshotted it.

## Running a selection, and the result remembering the statement it came from

**One decision with two halves, and the second is the one that had to be found.**
Running only the highlighted text is a small feature — read the selection off
Monaco, hand it to `onRun`, done. What it broke is that two things *re-run* a
result after the fact, and both were reading the tab's editor text to do it:
sorting a query's grid, and re-reading it after a save. Once a run can be of a
fragment, "the statement that produced this grid" and "what the editor holds"
stop being the same string, so `ResultsState.sql` records the former and both
re-runs read it.

**It was already subtly wrong before the selection made it obvious.** Run a
query, edit the text, click a header: the sort re-ran the edited text and
labelled the result with the arrow from the previous one. Nobody reported it
because the window between running and sorting is usually short. A selection
widens that window to *always*, since the tab's text is normally several
statements when a selection is worth making — and wrapping several statements in
`SELECT * FROM (…) squeal_sorted` is a syntax error rather than a quiet mismatch,
which is what turned a latent bug into a visible one.

**Rejected: keeping the selection in the store.** It is Monaco's own state,
changes on every cursor move, and the store has never heard of it — the same test
that keeps `maximized` and the sidebar's width out. `sqlToRun` reads it at the
moment of the run, so there is nothing to keep in step. The one thing that *is*
kept in React state is a `hasSelection` boolean, and only so the button can be
labelled *Run selection*; if it were ever a frame behind, the label would be
stale and the query would still be right.

**Rejected: falling back to the whole tab when the selection is blank.** A
selection of whitespace is a gesture that names nothing, and the two readings are
"they meant nothing" or "they meant everything". Running everything is the
expensive way to be wrong: the text they selected *away* from is, by
construction, the statement they did not want run — and on a tab of several
statements that includes whatever DML is sitting above the SELECT. It runs
nothing, and it gets there without a branch, because `runQuery` already refuses a
blank statement.

**Rejected: splitting a multi-statement selection here.** A selection of several
statements has to behave the way a whole tab of several statements does, and
making this feature *also* split them would have been implementing a separate
backlog item inside it, leaving two paths to diverge the moment one changed. That
item has since shipped, and the arrangement held: the splitter sits behind
`onRun`, so both a selection and a whole tab reach it as the same text and get
the same treatment. See *Statements are split in the UI, and each is its own
round trip*.

## Statements are split in the UI, and each is its own round trip

Text holding more than one statement had exactly one answer before this, and it
was a different wrong answer per engine: Postgres ran the lot and handed back the
**last** statement's result, silently dropping the rest; MySQL refused the whole
thing, because `multipleStatements` is off in the driver. Neither is a report of
what happened. The fix is to stop asking either engine the question: the tab is
cut into statements and each one is a `db.query` of its own, in order, with a
numbered result tab apiece.

**The split lives in the UI, and that is the decision.** The reflex reading of
this repo's own rules says otherwise — *only the extension may write SQL*, and
the split is undeniably about what SQL means. Two things settle it the other way:

- **Nothing is authored.** The rule exists because *composing* a statement needs
  the engine's quoting and its catalog, which is why `db.browse` pages and
  `db.ddl` reassembles down there. Cutting the user's own text on the semicolons
  that really end a statement composes nothing; each piece goes over exactly as
  typed, which is the same promise `db.query` already makes about the whole.
- **Each result has to be re-runnable on its own.** Sorting *Result 2* must
  re-run only the second statement — re-running the batch would repeat an
  `INSERT` or a `DELETE` that already committed, which is actively harmful rather
  than merely wasteful. So the UI has to hold each statement's text regardless.
  Had the extension split, it would have had to hand the pieces *back* for that,
  which is the split crossing the bridge in order to be used up here anyway.

The lexical knowledge this costs the UI is the kind it already keeps: `sql.ts`
knows which character quotes an identifier per dialect and `format.ts` maps a
dialect to a formatter language. What stays forbidden is a table up here mapping
an engine to a *catalog* or a *grammar*; how the text on screen is spelled has
always been the editor's own business.

**Rejected: a `db.queryBatch` command.** It would put the loop on the far side of
a bridge that cannot report progress mid-call — the UI would sit on one pending
promise while N statements ran, with no way to show *Result 1* the moment it
landed and no way to cancel between statements. The UI-side loop gets both for
free, because each statement is an ordinary `db.query` with the abort controller
already wired to it.

**Rejected: wrapping the batch in a transaction.** It is the tempting safety net
and it is the wrong one twice. It would be this side authoring a `BEGIN` the user
never wrote — precisely what "run the statement exactly as written" forbids — and
it would roll back work an earlier statement finished, which is not what running
those statements by hand would have done. The batch stops at the first failure
and whatever already committed stays committed; that is the honest reading, and
it is the only one that does not surprise someone half-way through a migration.

**Rejected: minting every statement's tab up front.** The strip would then stop
jumping in width as a batch lands, at the price of tabs standing for statements
that have not run and may never — a *Result 3* that is empty because it is
waiting and a *Result 3* that is empty because the batch died before it look
identical. A tab exists because a statement ran; the shortfall is stated instead,
as `1 not run`, which says the thing the empty tab was only implying.

**Rejected: following the running statement with the selection.** Then *Cancel*
would always be on screen and there would be no second question about which
result is in front — but a fast batch would land the user on the last statement,
and a batch is read from the top. `active` stays on *Result 1*, a **failure**
pulls it to itself (that one has to be seen), and Cancel gets a second home in
the strip, which is the only place that can offer it while a finished grid is
showing.

**MySQL's `DELIMITER` is handled in the splitter, and that is not an exception to
any of the above.** It reads like the one piece of SQL the UI has no business
interpreting, and it is the reverse: `DELIMITER` is not SQL. The server has never
heard of it — the `mysql` CLI consumes the line and never sends it — so a *client*
is the only thing that can act on it, and after the decision above this is the
client. Putting it in the extension would have meant the extension reading a
directive in order to decide something the UI had already decided.

It was briefly shipped as a known gap, on the reasoning that recognising a
routine body needs a per-dialect parser. That confused two different problems.
Recognising `BEGIN … END` *would* need a parser; honouring an explicit
instruction about what ends a statement needs a regex and a variable, because the
user has already said where the boundaries are. The gap was mine, not the design's.

**What makes it more than a client trick is that the server agrees.** A
`CREATE FUNCTION … BEGIN …; …; END` is one statement to mysqld — the semicolons
are inside a compound body — so the whole thing goes over a connection running
`multipleStatements: false` and is accepted. `tests/extension.test.ts` pins both
halves against the real server: the body is accepted, and `SELECT 1; SELECT 2` on
the same connection is still refused. Without the second assertion the first
would prove only that stacking had quietly become legal.

Two guards keep the word from being read where it is not a directive: it must be
at the head of a statement *and* at the head of a line, which is what the CLI
does and what stops a column honestly named `delimiter` from swallowing a line.
It is MySQL-only, since Postgres dollar-quotes a body and SQLite has no routines
— on either of those the word is ordinary text, and treating it otherwise would
be discarding someone's SQL to honour a command their engine does not have.
