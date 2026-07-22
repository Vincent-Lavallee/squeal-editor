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
`235 pass / 110 skip` from a bare run, and `81 pass` in ~185s from `test:ui`.

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
Postgres folds to lowercase and then cannot find. **Add to it when you find a
new sharp edge** — that is what it is for.

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

## When the whole suite collapses

Roughly every other run ends `0 pass / 20 fail` within ~60s, every failure some
variant of "cannot read properties of undefined" — the app is up enough to accept
a few evaluates and not up enough to have rendered. It is not the change under
test: it reproduces on a clean tree.

What is observably true is that a failed run leaves a `squeal-db-ext` process
behind, and it takes the heartbeat's 30s timeout to notice and exit. Runs started
close together are the ones that collapse, so **check for a stray extension
process and let it die before re-running** rather than reading a collapsed run as
a result. A collapsed run says nothing; a run that reaches 78+ tests says
something.

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
