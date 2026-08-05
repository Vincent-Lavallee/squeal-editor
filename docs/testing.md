# Testing

## Why these suites look like this

Every bug found in this project so far was **invisible to a mock**:

- MySQL rounding a BIGINT to `…992`
- dates arriving shifted into the machine's timezone
- the extension surviving the app and holding 8 database connections open

A fake driver would have happily returned whatever it was told to. So the suites
run against real MySQL and Postgres in Docker, a real SQLite file on disk, and
the UI suite drives the real app. They are slower and worth it.

SQLite earned that the moment it was written: three of its bugs — a bare
`notnull` being a SQLite *operator* rather than a column, `columnTypes` throwing
on a DML statement, and `INTEGER PRIMARY KEY` reporting itself nullable — were
found by running it and would each have passed a mock.

Two failures during development were the *tests* being wrong, not the app — one
mutated its own fixture (making it pass once and fail on re-run), one matched
`active_users` while looking for `users`. Both lessons are baked in below.

## Setup

```bash
bun run test:db:up     # throwaway MySQL + Postgres on 53306 / 55432, and the SQLite file
bun test               # extension suite (~10s); UI suite skips
bun run test:ui        # builds, then drives the real app (Windows-only, ~4min)
bun run test:db:down   # remove them
```

**The SQLite fixture is a file, not a container**, seeded by the same `test:db:up`
so one command still puts every engine in place. It is
`tests/fixtures/shop.db` (gitignored — it is output, seeded from `SQLITE_SEED`),
rebuilt from nothing on each `up` the way the containers get a `DROP DATABASE`.
Docker is therefore not required for the SQLite half of the suite, but there is
no script that runs only that half, deliberately: the point of the contract block
is that all three engines answer it together.

**`test:ui` builds the frontend itself, and that is the point of it.** `neu run`
serves whatever is sitting in `resources/` and does not build, so a frontend
change tested without one produces a **green run against the old app** — worse
than a red one, because it is a pass that means nothing. That used to be a
warning here and it was worth roughly a suite's worth of false failures before it
became the script's job instead. The build is most of the runtime; that is the
price of the result meaning something.

`dev` still does not build the frontend — it is the loop where you are rebuilding
by hand anyway. `bun start` and `test:ui` both do.

`bun test` is a **builtin**, not the `package.json` script, so it always
discovers every `*.test.ts` — the script name cannot override it. The UI suite
would therefore try to launch a window on a bare `bun test`, so it opts out
behind `SQUEAL_UI=1` (set by `test:ui`, along with a longer timeout, because
launching the app blows past Bun's 5s default hook timeout). Expect
`404 pass / 158 skip` from a bare run, and `133 pass` in ~365s from `test:ui`.

**`test:ui` builds the extension too, and driving the app by hand must as well.**
`build:ext` compiles `extensions/db/squeal-db-ext.exe`, which is what
`neutralino.config.json` actually spawns — the source tree is only what `bun test`
runs. A frontend-only `bun run build` therefore launches a new UI against the
*old* extension, and a command added on this side comes back as a failure inside
whatever UI action called it, naming nothing about a stale binary. `bun start`
and `test:ui` both build both; a hand-rolled `neu run` is the case to watch.

**A stray app from a previous run used to fail the whole suite, and now cannot.**
The debug port is a fixed 9333 and the harness finds its window by *title*, so an
app left alive by a run that was killed part-way is indistinguishable from the
one being launched — and CDP attached to the *old* window, against the previous
run's data directory and whatever screen it was left on. Every test then failed
at once, with errors about missing elements and timed-out evaluates rather than
anything naming a stale process, and it reproduced on a clean checkout, so it
read as the app being broken.

`launchApp` now calls `reapStaleApp` first: if anything answers on the port it
kills the app *and* the extension by name and waits for the port to go quiet
before spawning. A run is therefore independent of the one before it, and the
manual `Get-Process neutralino-win_x64 | Stop-Process -Force` is no longer a
prerequisite. `stop()` reaps the extension too, for the same reason — it is
*designed* to outlive the app by up to the heartbeat timeout, which is right in
production and wrong between two test runs.

**A `bun start`/`bun run dev` window left open surfaces as `NE_CL_IVCTOKN`,
not as a familiar collapse.** Neither script passes a fixed debug port, so
`reapStaleApp`'s `cdpAlive()` check never sees one — it isn't "on the port"
from this suite's point of view. `reap.ts` still kills it at the very start of
`test:ui` (that call is forced, unconditionally by name), but the ~50s of
`build` + `build:ext` between that and the actual `neu run` is long enough to
start one again by hand. Two live instances then fight over Neutralino's
one-time token handshake, and the *new* one is what fails. `launchApp`'s own
pre-spawn `reapStaleApp` call is therefore forced too, not `cdpAlive()`-gated
like the rest of that function's callers — it has no port to check for a dev
instance, so it always kills by name right before spawning.

**The cost is deliberate: this kills a copy of the app you have open yourself.**
That was already true of `stop()`, and it is what a fixed debug port buys.

**A stray *extension* used to fail earlier and look unrelated:** `build:ext`
cannot overwrite a running binary, so the run died at
`failed to move executable ... squeal-db-ext.exe: EPERM` before a single test
started. It is the same stray-process family, one step upstream — and
`launchApp`'s reaping is too late for it, because the build runs first. `test:ui`
therefore begins with `tests/helpers/reap.ts`, which is `reapStaleApp(true)`:
the same kill, forced, without waiting to be told something is on the port.

The containers are named `squeal-pg` / `squeal-mysql` and use non-default ports
so they cannot collide with anything real you are running. `test:db:up` is
re-runnable; it drops and reseeds.

## The fixture

`tests/fixtures/db.ts` seeds exactly the values that have caused bugs: a BIGINT
past 2^53, a timezone-less DATETIME, NULLs, a BLOB, JSON, a view, (Postgres) a
table outside the `public` schema, and a mixed-case column name
(`users."eventType"`) — the filter bar once rendered that unquoted, which
Postgres folds to lowercase and then cannot find, and the completion popup later
inserted it unquoted for the same reason. **Add to it when you find a new sharp
edge** — that is what it is for.

`events` is the exception that proves the rule: 150 rows, seeded for *shape*
rather than for a value. The size is chosen, not round — more than one 100-row
page, and page 2 a partial one. It is also why there is no 100-row table: browse
it from row 51 and a *full* page comes back with nothing after it, which is
precisely the case the old "a full page means there is more" guess got wrong.
A fixture sized to make the bug reachable beats a second table.

The SQLite seed carries one shape the other two do not have to: `users.id` is
`INTEGER PRIMARY KEY` **deliberately**, because that is the rowid alias whose
`notnull` the catalog reports as `0`. Declared any other way the fixture would
pass while the ordinary case stayed broken — it is the table that proves the
driver's primary-key override does something. Its BIGINT sits on `users.big`
like MySQL's, since there is no second schema to hold a `reporting.daily_stats`.

Keep it re-runnable. A test that mutates the fixture must reset what it touched
(see the `UPDATE … SET email=NULL` in the `beforeAll`), or it passes once and
fails forever after.

## `tests/extension.test.ts`

Drives the extension through `tests/helpers/harness.ts`, which stands in for
Neutralino: it hosts the WebSocket, spawns the extension exactly as the app does,
and dispatches events at it. So the transport under test is the real one — stdin
init, the `app.broadcast` envelope, `reqId` correlation.

All three engines run the **same** `describe.each` block. The UI cannot tell
engines apart, so anything asymmetric is a bug. A new engine should be able to
join that block unchanged.

SQLite joining it is what that claim was worth: it cost three lines of the block,
and **all three were the block over-assuming**, not the engine misbehaving. The
database's name became a per-engine `fixtureDb` (SQLite's is the file path,
because its database *is* the file); the BIGINT test moved to `users.big` for
every engine but Postgres, which is the only one with a second schema to hold
`reporting.daily_stats`; and the read-only assertion widened from `/read.only/i`
to `/read[\s-]?only/i`, because SQLite says `readonly` as one word. Nothing about
the contract itself moved — which is the outcome the block exists to force.

### The dropped-connection block, and why it kills real backends

*dropped by the server* is a second `describe.each` over the two **server**
engines only — SQLite is absent rather than skipped, because a file has no server
to hang up on it and there is no behaviour there to answer for.

It works by asking a connection for its own backend id (`pg_backend_pid()`,
`CONNECTION_ID()`) and then killing it from a *second* connection, so the victim
is idle when it dies. That is the case worth the setup: an idle drop is the one
both libraries report by emitting `error` on the connection, and an `error` with
no listener took the whole extension down. The test asserts the *other*
connection still answers, which is only true if the process survived — see
`docs/decisions.md`.

Two things it needs from the harness, both added for it. `waitFor(event, match)`
reads broadcasts that are not replies to any `reqId`, which is how
`connection.state` arrives; it buffers what it has already seen, so a test that
subscribes a beat late still finds its event. And `match` exists because a suite
with more than one connection open sees every connection's broadcasts, so a test
has to name the one it means.

The third test is a clock: it kills a connection and asserts *Disconnect* returns
inside 5s. What it is really pinning is that nothing waits on a server that has
gone — the behaviour it replaced took the bridge's whole 60s timeout.

### The one-engine blocks, and why they are not the asymmetry rule broken

*mysql compound statements* runs against MySQL alone, and the other two engines
are **absent rather than skipped** — the same shape as the dropped-connection
block above. The rule is that anything in the *contract* must be symmetric,
because the UI cannot tell engines apart. A `DELIMITER` block is not in the
contract: it exists because MySQL has no in-language way to quote a routine body,
where Postgres has dollar-quoting and SQLite has no routines at all. There is no
question here for the other two to answer, so a skip would be claiming there was
one and that it was being ducked.

## `tests/statements.test.ts` — the one suite with no server in it

It splits a tab's text into statements (`splitStatements`, in the frontend) and
asserts where the cuts land. That it needs no database is not this suite going
soft on the rule above: it runs **before** any connection exists and decides
*what gets sent*, so the failure it guards against — a statement torn in half —
is the one failure no database can be asked about. Each half would arrive looking
exactly like something the user typed, and a real server would answer both.

Every case in it is one where a plain `sql.split(';')` is wrong: a semicolon
inside a literal, a doubled quote, a quoted identifier, either comment form, a
dollar-quoted function body, a `DELIMITER` block. The per-engine ones are
asserted **both ways** — `SELECT 'a\'; b'` is one statement on MySQL and two on
Postgres — because an assertion that only holds for one dialect would pass just
as well if the dialect were being ignored.

**The second half of it asks which statement the cursor is in** (`statementAt`),
and its cases are the ones where the cursor is *not* neatly inside a statement —
just past a terminator, on a blank line, in the comment above the query it is
about to run. Each has exactly one answer a user would call correct, and the
failure to guard against is not an error message but a query nobody asked for.
The cursor is written into each case as a `|` and cut back out, so a case reads
as the tab on screen rather than as an offset counted by hand.

**Its `DELIMITER` half is only worth anything with a real server behind it**, and
that half lives in `extension.test.ts` (*mysql compound statements*): this suite
proves the directive is consumed and the body handed over whole, and only mysqld
can say whether it accepts the body as one statement. Both are needed, and the
second one carries a companion assertion that `SELECT 1; SELECT 2` on the same
connection is *still* refused — otherwise "the body was accepted" would pass just
as well if stacking had quietly become legal.

## `tests/shortcuts.test.ts` — the other suite with no server in it

It asks what a keypress *means* (`chordFromEvent`, `matchesChord`), and it needs
no database for `statements.test.ts`' reason one layer up: nothing has been sent
yet. The failure it guards against is a shortcut that records one chord and then
answers a different one — which no server can be asked about, because a key that
does nothing never reaches one.

Three of its cases are the bugs, not the happy path. **Modifiers match exactly**,
because `e.key` is `Enter` with or without Shift and a hand-rolled `Ctrl+Enter`
check answered `Ctrl+Shift+Enter` for free. **Unreadable stored text and unknown
ids are dropped rather than thrown over**, because that value comes off disk and
may have been written by a newer version — a preference must not be able to blank
the screen. And **every shipped default round-trips through `parseChord`**: a
default nothing can read back is one the screen cannot spell and Monaco cannot be
given, and it would ship looking perfectly reasonable in the list. Two more hold
the registry itself honest — no two shortcuts on one chord, and a shortcut is not
a clash with itself.

It takes a `KeyPress` structural type rather than a real `KeyboardEvent`, which
is what lets a case be a literal in a suite with no DOM. A `KeyboardEvent` is
assignable to it, so the app passes the real thing.

The screen those functions sit behind is asserted in `ui.test.ts`, under
*titlebar*: it rebinds Run, refuses a chord the sidebar already owns, presses the
new key and requires the query to have run. It resets before it leaves, or every
test after it is running under a keyboard it changed. The tab shortcuts have
their own test in the postgres block, starting from the empty state the *Close
All* test leaves — and **it counts `.editor` divs to see the split**, because
there is no split flag to read and the tab labels span both strips, so the tab
count cannot tell a docked tab from a second tab.

**Both dispatch their chords at an element, never at `window`.** These listeners
are on the window, and an event fired straight at it skips the propagation that
decides whether Monaco or the recorder gets there first — so it would be answered
by everything at once and prove nothing about the ordering that is the whole
design.

## `tests/saved.test.ts`

Saved connections, against the real SQLite file, the real OS keychain and a real
database at the far end of a stored row.

**It must never touch the connections of whoever is running it.**
`SQUEAL_DATA_DIR` and `SQUEAL_KEYCHAIN_SERVICE` point the extension at a
throwaway directory and a per-run keychain entry — the harness and `launchApp`
both forward env to the extension, and Neutralino passes it down to the one it
spawns. Only the *names* change: the SQLite and the credential store under test
are the real ones, because the failures worth catching ("the key was not there
next launch", "the password came back as bytes") cannot exist in a fake.

The keychain entry outlives both the process and the temp directory, so
`afterAll` deletes it explicitly or every run leaves a credential behind.

Three of these tests are the ones that matter:

- **the password is not in the file** — read as raw bytes, not through the API
  that wrote it.
- **it survives a restart** — the extension is stopped and started, so the key
  demonstrably came back from the keychain rather than from memory. That is the
  assertion the whole design rests on.
- **the migrations** — a store written by an older version, opened by this one.
  Each one **downgrades the live store** rather than hand-building a fixture, so
  the password blobs going through the rebuild are real ones encrypted with the
  real key. That is what makes the last assertion — it still connects afterwards
  — mean anything; a hand-written blob could only ever prove the row moved. These
  are the tests standing between a schema change and someone's real connections.

**The export/import round trip is proven here rather than in the UI**, and it has
to be: the path is named by an OS dialog CDP cannot reach, so the UI suite can
only assert that the menu reaches both screens and that the passwords box starts
off. The test that means something is the whole loop against the real store —
exported with passwords, the row deleted, imported, and then *connected to a real
server with the password that came back*. Everything before that last step could
pass with a secret that survived the trip as mush.

**A new table costs three lines here, and one of them is easy to miss.** A
migration needs its inverse in `UNDO` (which throws by name rather than skipping,
so that one announces itself) *and* a `DROP` in the hand-built legacy store the
*before workspaces* test assembles — that one enumerates every table added since,
because a file claiming to predate them must not be holding one. Miss the second
and an unrelated migration test fails with `table X already exists`.

### Downgrading, now that the store records its version

`rewindTo('migration-name')` is how those tests make a file look like an older
one, and **both halves of what it does are required**:

- **The stamp goes back with the columns.** A file still claiming the latest
  version is one the sequence skips entirely, so a test that dropped only a
  column would open a *broken* store and assert against it — passing or failing
  for reasons unrelated to the migration it names.
- **The columns come off from the top down, all of them.** Everything above the
  target re-runs, and a migration that finds its column already there fails on a
  duplicate. Which is the honest shape anyway: a store that predates SSL never
  had the IAM columns either. So "before SSL" means that whole version, not the
  current schema with one column missing.

It takes a **migration name**, and the suite imports the real `MIGRATIONS` list
to resolve names to versions. Versions are timestamps now, so a hardcoded
`20260717075921` would be unreadable and would rot; naming the migration also
means a rename fails loudly instead of silently matching nothing. `UNDO` has no
`?? []` fallback for the same reason — a migration added above one of these tests
without an undo entry throws by name, rather than being skipped and leaving its
columns for the re-run to trip over.

Two of them go further and drop `schema_migrations` outright (`forgetVersion`),
because that is the shipped case: **every store written before this app recorded
versions arrives with no such table** and has to be placed on the ladder by its
shape alone. The pre-workspaces test covers the bottom rung; the *adopting a
store written before there were versions* test covers rung 4, which is what a
v0.1.1–v0.2.1 store actually is — the upgrade the largest number of real files
will perform. It also reopens a second time to assert the inference cannot run
again, since a store that re-infers every launch is the failure this design
replaced.

**A migration test reads `schema_migrations` after a command, never straight
after the restart.** The extension opens the store on first use, so nothing has
migrated yet at launch and the table is not there — which surfaces as a confusing
`no such table` rather than as anything about migrations.

The workspace tests share one store, so they mind their order: the delete-the-last
test reduces the list to the *default* workspace by id, not by taking the head off
a name-sorted list, because the describes after it still save into it.

Deleting the temp directory is best-effort: the extension is designed to outlive
the app by up to the heartbeat timeout and still holds `squeal.db` open,
which Windows reports as `EBUSY`.

## `tests/ui.test.ts`

Launches the real app and drives the page over CDP. WebView2 only exposes CDP via
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, so **this is Windows-only** — which is
why it is a separate script rather than part of `bun test`.

Two things to know:

- **Wait for the thing, do not sleep at it.** `app.waitFor(expr)` re-evaluates
  until the expression returns something other than `null`/`undefined`; it must
  answer `null` for "not yet", so a predicate's genuine `false` is still a value
  and fails its assertion instead of hanging. Much of this suite still uses fixed
  `Bun.sleep`s, and each one encodes how long a step took on the machine that
  wrote it — the failures they cause name a null element deep inside whichever
  helper touched it first, never the wait that was too short. Two have already
  been converted for cause: the connect form (`#type`, where a null reaches
  `setSelect` and surfaces as `Illegal invocation`) and Monaco's tokenizing,
  which passed or failed according to *how many tests ran before it*. Convert the
  next one that bites rather than all of them at once.
- **React ignores a synthetic `mouseenter`/`mouseleave`.** It synthesises
  `onMouseEnter` from the delegated `mouseover`/`mouseout` pair at the root, so a
  dispatched `mouseenter` reaches the DOM and no handler at all — which reads as
  the hover behaviour being broken rather than as the event being the wrong one.
  Dispatch `mouseover` and `mouseout` (with a `relatedTarget` outside the
  element) instead. The tab strip's unsaved dot, which swaps for the close button
  on hover, is the test that found this.
- **React ignores `el.value = x`.** Use the `REACT_SETTERS` helper, which goes
  through the native setter and dispatches a bubbling `input` event. It is for
  the connect form; the editor is not an input at all (below).
- **`REACT_SETTERS` drives a control a real user could not.** A synthetic
  `change` still fires React's `onChange` on a **disabled** control, so a test
  that sets a value that way proves the handler works, never that the control was
  reachable. This is not hypothetical: the database picker was disabled whenever
  a tab pointed at nothing, so closing every tab and clicking `+` stranded you
  with no way to pick one — and the test drove it anyway and passed. **If being
  able to use a control is part of the claim, assert `disabled` too**, or assert
  the user-visible consequence rather than the state behind it.
- **The editor is driven through `window.squealEditor`.** Monaco keeps its text
  in a model, so there is no `.value` to read and nothing `REACT_SETTERS` can
  type into, and the DOM it does render is virtualised — asserting against
  `.view-lines` would only ever test the part currently painted. The app exposes
  the editor instance for this. Writing through `setValue` goes the same way a
  keystroke does, so React's state follows as it would in a real edit.
- **It is still one editor with tabs, and it holds no model on a grid tab.** Tabs
  swap the model underneath the one instance, so the seam did not go plural — but
  reads have to guard (`getModel()?.getValue() ?? null`), and that guard is
  itself the assertion that a grid tab really has no editor on it. Asserting the
  text of a background tab means switching to it first.
- **A selection is set through the same seam** (`selectLines`), and the run it
  drives is asserted by the **absence of the statement strip**: the fixture query
  is two statements, so running the whole tab draws a tab each while running one
  line draws none. The columns alone stopped telling those apart the day a batch
  started showing *Result 1* first — both answer under `name` — which is why the
  assertion is the strip and not the headers. A test that runs the whole tab has
  to collapse the previous one's selection first (`clearSelection`), since
  running means *the selection or the tab* and `setValue` is not a promise that
  there is no selection.
- **Anything evaluated with a `const` in it has to be wrapped in an IIFE.** Each
  `Runtime.evaluate` is its own script but shares one global lexical scope, so a
  bare top-level `const` persists and the *second* call throws
  `Identifier … has already been declared` — a failure that reads as the app
  being broken rather than the helper.
- **Some Monaco ids are commands, not actions.** `getAction('closeFindWidget')`
  returns `null`; it wants `editor.trigger(...)`. That distinction cost a
  confusing failure in a test whose subject had already passed.
- **The completion popup is driven through `suggest()`**, which marks the cursor
  with a `|` in the query rather than passing a column number — every one of
  those assertions is about a position, and a hardcoded column silently stops
  meaning the same place the moment the query beside it is edited. It reads
  `.label-name`, not the row's `textContent`, which is the label and its type
  detail run together. Its sleep before triggering is not padding: the columns
  are fetched over the bridge off the *text changing*, so the round trip has to
  land before the popup is asked what it knows.
- **What a suggestion inserts is read off the model, never off the label.** An
  identifier that needs quoting to survive goes in quoted, so `acceptSuggestion`
  opens the popup the same way `suggest` does, takes what it has selected
  (`acceptSelectedSuggestion`, one of Monaco's *commands* — triggered, not
  fetched) and reads the editor text back. The Postgres half then presses Run:
  the text being right is a proxy, and the bug it pins was a statement that
  looked perfectly reasonable on screen.
- **`Runtime.evaluate` roots its value on `window`, and that is load-bearing.**
  `awaitPromise` holds the page's promise weakly, so a page GC while a reply is
  in flight answers with CDP `-32000 Promise was collected` instead of a value —
  which fails whichever test was running when the reply landed and strands every
  test after it. Every `REACT_SETTERS` script evaluates to a promise, so they are
  the exposed ones. `app.ts` wraps each script as
  `window.__squealEval = eval(<script>)`; do not unwrap it, and do not read the
  rethrown message and conclude the *harness* collected something. See
  `docs/decisions.md`.
- **The suggest list is virtualised**, so only the rows on screen are in the DOM.
  Assert against a query whose typed prefix narrows the list — `toContain` on a
  list of a hundred keywords proves nothing about what is in the widget.
- **`ILIKE` is the completion's engine pair.** It is Postgres-only, so the pg
  block requires it and the MySQL block forbids it. One engine offering a word
  proves a list exists somewhere; two engines offering *different* words proves
  the list is the dialect's. The MySQL side also asserts `LIKE` is offered —
  absence alone would pass just as well if completion were simply broken there.
- **Match label text exactly.** `textContent.includes('users')` matches
  `active_users` — that mistake produced three confusing failures.
- **The launch screen is the saved list once anything is saved**, so the connect
  helper steps through *+ New connection* when it is showing. Tests that save
  run last, for the same reason. The helper never steps through the workspace
  picker: one workspace skips it, and the workspace describe — last of all,
  because it leaves a second one behind — is what drives that screen.
- **The workspace describe found a real bug the code review did not.** The
  connect screen derives its view from how many workspaces and connections exist,
  so deleting the second-to-last workspace re-derived the launch screen and
  bounced the user into the survivor's connection form. It only failed because
  the test kept clicking after the delete. Assert what is on screen *after* an
  action, not only that the action landed.
- **Clicking a table opens a tab, so a test that clicks one owes a close.** The
  grid, the pager and the results bar are the *active tab's*, so a test that
  leaves a tab behind hands the next one a screen it was not written for. Tab
  labels are exact-matched like every other label here, and `Query N` keeps
  counting up across a describe — closing Query 2 does not make the next one
  Query 2 again, deliberately.

It earns its keep. Connecting from a saved connection rendered a shell with an
**empty tree** — `explorerSlice` was matching one connect thunk — and nothing
else in the project could have caught it: the extension was right, the types were
right, and the screen looked plausible. See `docs/decisions.md`.

## The collapse this used to have

Roughly every other run used to end `0 pass / 20 fail` within ~60s, every failure
some variant of "cannot read properties of undefined". The cause was `launchApp`:
it returned as soon as `findPage` saw a CDP target, and WebView2 exposes that
target the moment the window opens — well before the several-megabyte bundle has
loaded and React has mounted. The suite then started driving a page that was "up
enough to accept an evaluate and not up enough to have rendered." It reproduced
on a clean tree, which is what made it read as the app being broken rather than
the harness.

`launchApp` now waits on the same expression `reload()` already waited on
(`#root` has rendered something) before handing the session back, so a test
never starts against a page CDP can see but React has not touched yet.

## Verifying by hand

`app.screenshot(path)` on the session works for eyeballing the design system.

**DevTools is off in the config** (`enableInspector: false`), so a packaged build
ships without it. `bun start` and `bun run dev` turn it back on by passing
`--window-enable-inspector=true` — Neutralino accepts every config key as a
command-line override, and this is the only lever there is: no runtime API turns
the inspector on or off. So dev keeps the inspector, releases do not, and neither
depends on remembering to type a flag.

`neu run` forwards anything after `--` to the binary. Its `--help` does not
mention this and lists only `--disable-auto-reload` and `--arch`, which reads as
"no passthrough exists" and is wrong — the handling is in the CLI's `run.js`.

That flag is **not** what the UI suite attaches through. The suite passes
`--remote-debugging-port` to WebView2 itself via
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, which is a browser-level argument and
independent of Neutralino's setting — verified by turning the inspector off and
watching the suite still run green.
