# The database extension

`extensions/db/` — a Bun + TypeScript process spawned by Neutralino. It is the
only place in the repo that speaks SQL or holds a socket to a database.

Bun runs the TypeScript directly, so **there is no build step**. Edit `main.ts`,
restart the app, done.

## What it is actually for

Databases are the reason it exists, but not the definition. It is **the process
that makes the native calls the webview cannot**: Neutralino's runtime cannot open
a TCP socket, so connections live here — and it cannot call `dwmapi` either, so
painting the window frame lives here too (`chrome.ts`).

That is the test for anything new. "Can the webview do this itself?" If yes, it
belongs in the frontend. If no, it belongs here, and being unrelated to SQL is
not an objection.

## Files

| File | Owns |
|---|---|
| `main.ts` | transport (WebSocket, heartbeat), the connection registry, command handlers |
| `connection.ts` | one server connection; per-database clients; the page SQL for browsing |
| `drivers.ts` | per-engine SQL and value handling |
| `store.ts` | workspaces and saved connections: the SQLite file, the rows, and the password encryption |
| `migrations/` | the store's schema, one file per change, plus the runner that brings a file up to it |
| `chrome.ts` | the window frame's colour and the maximise clamp, over `bun:ffi`. Windows-only, best-effort |
| `updater.ts` | the user-initiated updater: the release check, the verified download, and launching the installer. Windows-only |
| `updateKey.ts` | the committed ed25519 public key the download's signature is checked against |

The split matters: `main.ts` knows nothing about SQL, `drivers.ts` knows nothing
about the transport, and `store.ts` and `chrome.ts` know nothing about either.

## Adding an engine

1. Add the name to `EngineType` in `shared/protocol/config.ts`.
2. Write a `Driver<C>` in `drivers.ts`, where `C` is the library's client type.
   Its `dialect` is how the editor will highlight it *and* which words it will
   suggest — one of Monaco's SQL language ids, or `sql` if it has no grammar of
   its own. Do not invent one: `sql` is the deliberate fallback, and a dialect
   with no grammar behind it means an editor that suggests nothing.
3. Add a `case` to `withDriver`.
4. Add the option to `ENGINES` in `frontend/src/engines.ts`.

Then add it to the `describe.each` in `tests/extension.test.ts` — every engine
runs the *same* contract tests, which is what keeps them interchangeable. The UI
cannot tell engines apart, so anything asymmetric is a bug.

### An engine that is a file, not a server

SQLite has no host, port or user, and `ServerConfig` carries its path in
**`database`** — the file *is* the database there, so a second field would only
ever hold what that one already means. It writes `host: ''`, `port: 0`,
`user: ''`, and the UI collects the path with the OS file dialog.

**`isFileEngine` is in the protocol, not in either side**, and that is load-bearing
rather than tidy. Both sides act on it: the UI draws a path field and skips the
password prompt, and `store.ts::resolveSaved` must not demand a stored password
before it will resolve the row. When only the UI knew, the form saved a SQLite
connection happily and connecting to it failed with *"does not store a password;
one is needed to connect"* — a refusal from the one layer that had not been told.
It sits beside `AwsIamAuth` for the same reason: `hasPassword: false` has more
than one cause, and every reader has to agree on which causes mean "ask".

Four things about it are load-bearing, and each is the kind that looks arbitrary:

- **`listDatabases` reports the path, not `main`.** `connection.ts` keys one
  client per database *name* and opens a new one for any name it has not seen, so
  answering `main` when `config.database` holds a path would open a **second**
  handle onto the same file for every table browsed. Reporting the path back keys
  the connection's whole life to one client, which is also the truth.
- **`safeIntegers` is on, so every integer arrives as a bigint** and reaches the
  grid as its own digits. It is the mysql2 `supportBigNumbers` rule in this
  engine's spelling, with one difference: SQLite has no "only when it would not
  fit" setting, so an ordinary id shows as text too. An id rendered as text is
  cosmetic; an id rounded past 2^53 is not.
- **A primary-key column is reported `NOT NULL` whatever the catalog says.**
  SQLite's oldest wart is that `pragma_table_info` reports `notnull = 0` for
  `id INTEGER PRIMARY KEY` — the rowid alias, which cannot be null. Believing the
  catalog would make `pickRowKey` reject it and leave the grid read-only for
  almost every SQLite table there is. `runWrites` aborting any op that matches
  more than one row is the backstop if a key turns out not to be unique.
- **`bun:sqlite` deduplicates `columnNames`.** `SELECT 1 AS x, 2 AS x` answers
  two values under **one** header name, which shifts every column after the
  duplicate under the wrong one — the *Rows as arrays* failure moved into the
  header. So the width comes from `columnTypes` and a short name list is rebuilt
  positionally from the SELECT text. `columnTypes` **throws** on a statement that
  returns no grid, which is why the DML branch is taken off `columnNames` first.

`PRAGMA query_only` is its read-only mode, and it is *stronger* than either
server engine's: it refuses DDL too. It is still not a security boundary —
anything else holding the file can open its own handle without it.

`bun:sqlite` is a Bun builtin, so the engine added no dependency. It is also
already in the process for another reason entirely (`store.ts`), which is a
coincidence and not a coupling: they share no connection, no file and no code.

### Why `Driver<C>` is generic

mysql2 and pg have unrelated client types. Rather than degrade the registry to
`any`, `Driver` is generic and `withDriver` hands the concrete driver to a
callback. `connection.ts::build<C>` captures `C` in a closure and returns a
**non-generic** `ConnectionHandle`. The registry in `main.ts` stores handles, so
a mysql2 or pg type never leaks out and no `any` is needed anywhere.

If you add an engine, follow the same shape. Do not widen the handle.

## The client-per-database rule

`connection.ts` keeps `Map<string | null, C>` — one client per database, keyed by
name, or `null` for the server default.

Postgres *requires* this: a connection is pinned to one database for life, so
switching means a new client. MySQL does not, but it uses the same shape anyway
so the drivers never carry "which database am I on?" state. SQLite has exactly
one database and therefore exactly one client — which is a *consequence* of the
key being the name it reports, not a special case here. See *An engine that is a
file, not a server*.

`null` is the key rather than a sentinel string so it can never collide with a
database actually named `__default__`.

## Read-only sessions

A connection can be opened read-only, which means the **server** refuses its
writes -- not a parser of ours inspecting the SQL. That is the whole point: there
is no statement, CTE or procedure for a write to hide inside, because the refusal
happens in the engine. It is `Driver.setReadOnly`, a per-engine statement:
`SET SESSION TRANSACTION READ ONLY` (MySQL), `SET SESSION CHARACTERISTICS AS
TRANSACTION READ ONLY` (Postgres). A driver method for the same reason quoting
is one -- the SQL differs per engine.

The load-bearing part is that the session is **per client**, and a connection
holds one client per database. So `connection.ts` does two things, and missing
either is a silent hole:

- **`setReadOnly(value)` reaches every client currently open** in the map.
- **`getClient` applies the mode to every client it creates afterwards**, off a
  flag the toggle also updated. Without this, a read-only connection would go
  writable the moment the user switched to a database not yet opened -- the new
  client would be born read-write.

`openConnection(config, readOnly)` seeds the flag before the eager
`listDatabases()` opens the first client, so a connection asked to be read-only
is never briefly writable. The UI toggles it live with `db.readonly`, and both
connect commands carry an initial `readOnly` the extension simply obeys -- the
"Production defaults to read-only" policy is the UI's, not the extension's.

It reduces accidents; it is **not** a security boundary. Neither engine's
read-only session reliably covers DDL (MySQL's does not, and the two differ), so
a genuinely locked connection needs a read-only database *user*. `db.readonly`
and the status-bar lock are about the stray `UPDATE`, not about making a server
safe from a determined one.

SQLite's `PRAGMA query_only` is the odd one out: it *does* cover DDL. That is a
stronger guarantee arrived at for free, not a promise the feature makes — the
sentence above is still what `db.readonly` means, because a file anything else
can open has no session to lock in the first place.

## Browsing a table

`db.browse` takes a table and an offset and returns one page. It exists because
paging means *writing* SQL, and this is the only side that may: it knows the
engine's quoting, and it will only page SQL it authored. `db.query` runs the
user's statement exactly as written and is never rewritten to page it — see
`docs/decisions.md`.

Four rules, each load-bearing:

- **`PAGE_SIZE` is written once**, in `connection.ts`, and travels to the UI in
  the response. The UI steps by the size it was told, never by a 100 of its own.
- **`hasMore` is answered, never inferred.** The page asks for `PAGE_SIZE + 1`
  rows and drops the extra one before returning. A full page is not evidence of
  a next one — that guess is the bug this replaced — and `COUNT(*)` is a full
  scan to learn what one spare row already says.
- **No `ORDER BY`.** Rows come back in the server's natural order, which is not
  a stable order: a write between two page fetches can shift a row across the
  boundary. Accepted deliberately; the alternative sorts the whole table per page.
- **The offset is coerced before it is interpolated.** It arrives as user JSON
  and no placeholder can carry a `LIMIT` on both engines, so it is forced to a
  non-negative integer. This is the one place SQL is built by interpolation. Keep
  it that way, and keep the table name going through `quoteIdent`.
- **The page carries the table's `keyColumns` and `columnInfo`.** Both are fetched
  after the `SELECT`, sequentially — one client cannot run two queries at once — so
  the grid learns on one round trip whether it may write the table back, which
  columns target a row, and each column's type (for the header). `keyColumns` is
  `null` when nothing identifies a row — a view, or a keyless table — which is what
  makes the grid read-only. See *Writing back edited rows*.

`LIMIT/OFFSET` is spelled the same by both engines today, so the SQL is built in
`connection.ts` beside the client it runs on. An engine that pages its own way
(SQL Server's `OFFSET/FETCH`) makes this a `Driver` method — that is the seam to
use, not an `if` here.

### Narrowing a page: `filter`

`db.browse` takes an optional `TableFilter`, and it exists here rather than
anywhere else for the reason browsing itself does: a `WHERE` is SQL, and this is
the only side that may author it. **Filtering a query's result is deliberately
not offered** — that would mean wrapping the user's statement, which is the same
refusal `db.query` already makes.

`buildWhere` in `drivers.ts` is the shared assembler, the same shape as
`runWrites` beside it: engine-neutral assembly, with `quoteIdent` and
`placeholder` as the two callbacks. `Driver.placeholder` is new and is the pair
of `quoteIdent` — `?` for mysql2, `$n` for pg — so every assembler that binds a
value spells it one way.

Four rules:

- **A builder filter binds every value and interpolates none.** The column is
  quoted, the operator is checked against a closed set *at runtime* (it arrives
  as user JSON, so the type is not the guard), and the value becomes a bound
  parameter. This is *Value handling* on the read path: a BIGINT compares exactly
  and a date is the server's string to parse. There is a test that a value of
  `' OR 1=1 --` matches nothing and leaves the table standing.
- **A raw filter is interpolated, by design.** It is the user's own `WHERE`
  text — the same category as the statement they type in the editor — and there
  is no structure in it to bind. It is the escape hatch for what the operator set
  cannot say, and its syntax errors are theirs, failing like a bad statement.
- **`hasMore` still means what it meant.** The probe row is fetched under the
  same `WHERE`, so it answers "is there another *matching* row". Nothing about
  the paging design changed; the filter simply travels with every page.
- **An empty filter is no filter.** A condition with no column, an `IN` with an
  empty list, and a blank raw clause all drop out rather than authoring
  `WHERE ()`. Half-built rows are the normal state of a bar being used.

`LIMIT`/`OFFSET` remains the one interpolation, and it sits after the `WHERE`, so
the filter's placeholders number from 1 with nothing to collide with.

## Listing a table's columns

`db.columns` names a table and answers with its columns, in **ordinal order** —
the order the table declares them and the order `SELECT *` answers in, which is
the only order the reader already has in their head. The editor completes against
them, and the tree draws them when a table is expanded — so the same fetch serves
both, cached once per table.

It is a driver method rather than a `db.query` the UI wrote, for the same reason
`db.browse` is: the catalog query is per-engine, and only this side may write
SQL. The two engines answer it differently and both are deliberate:

- **MySQL reads `information_schema.COLUMNS`, taking `COLUMN_TYPE`** — not
  `DATA_TYPE`, which drops the length and the sign (`varchar` where the column is
  `varchar(255)`, `bigint` where it is `bigint unsigned`). It also reads
  `COLUMN_KEY`, which is `PRI` for a primary-key column.
- **Postgres reads `pg_attribute` and `format_type`**, not
  `information_schema.columns`, which reports `character varying` and puts the
  length in a column of its own — reassembling a display string out of those
  means guessing which types take a length and how each spells it. `format_type`
  is Postgres rendering its own type. It also filters `attnum > 0` (system
  columns like `ctid`) and `NOT attisdropped` (the corpses `DROP COLUMN` leaves).
  The primary key comes off a `LEFT JOIN` to `pg_index` on `indisprimary` —
  `a.attnum = ANY(i.indkey)`, so a column matched by the one primary index is
  flagged and the absence of a match `COALESCE`s to false.

Three rules, and the last is the one that will bite:

- **`ColumnInfo.dataType` is the engine's own string, never normalised.** MySQL
  says `int`, Postgres says `integer`, and the contract test asserts only that
  both answer *something* — a normalising table would be a second place that has
  to know what MySQL means. This is the `SqlDialect` rule again: the UI shows it
  and never reads it.
- **`ColumnInfo.primaryKey` is a fact, not a rendering**, and the one field here
  the UI reads rather than only shows: the tree marks a key column and the
  editable grid needs it to identify a row. Both engines read it from the catalog
  beside the type, so the two cannot drift on what "primary" means.
- **A table that does not exist is `[]`, not an error.** The caller is a
  completion provider reading a query as it is typed, so it asks about `use` one
  keystroke before it asks about `users`. A name that is not a table is the
  normal case here, not an exceptional one. Both engines answer this way for
  free — the catalog query simply matches no rows — and there is a test pinning
  it, because "fix" it into a throw and the editor errors on every keystroke.

### Foreign keys, for the grid to follow

`ColumnInfo.foreignKey` names the relation and column a foreign-key column
points at, read from the same catalog pass as `dataType` and `primaryKey`. It is
what lets a browsed cell offer to open the row it references, in the frontend.

**Only a single-column foreign key is ever reported.** A composite key needs
every column's value to name one row, and a cell holds exactly one of them —
reporting it on the first column would let the grid filter the related table by
a fraction of the key and land on every row sharing that fraction, silently.
`pickForeignKeys` (shared by all three drivers, the same shape as `pickRowKey`
beside it) groups a table's foreign-key columns by constraint name and drops any
group with more than one member, rather than guessing which column to report it
on.

Each engine reads its own catalog for the mapping:

- **MySQL reads `information_schema.KEY_COLUMN_USAGE`**, filtered to rows where
  `REFERENCED_TABLE_NAME` is not null — the same table also answers a plain
  unique-key row, which has no referenced table and is excluded by that filter.
  `REFERENCED_TABLE_SCHEMA` goes unread the way every schema does in this
  driver: the client is pinned to one database, and a cross-database foreign key
  is not a case any other query here handles either.
- **Postgres reads `pg_constraint`** (`contype = 'f'`), unnesting `conkey` and
  `confkey` — the local and referenced columns' attnums, as parallel arrays — and
  joining them back together by position (`WITH ORDINALITY`), which is what
  pairs a local column with the referenced column it actually points at rather
  than an arbitrary cross of the two arrays.
- **SQLite reads `pragma_foreign_key_list`**, grouped by its own `id` (which
  groups a composite key's rows the way a constraint name does on the other two
  engines). Its `to` column is null for a column-less `REFERENCES parent`, which
  means "the parent's own primary key" rather than nothing — resolved with a
  second `pragma_table_info` lookup per distinct referenced table, since more
  than one foreign key commonly points at the same parent.

`db.browse`'s `columnInfo` carries the same field, because it comes from the
same `driver.listColumns` call `db.columns` does — there is no separate
detection for the browsed path to drift from the completion/tree path.

## A relation is a name *and* a schema

`Relation` (`{ table, schema? }`) is what every command about one relation
carries, and `TableInfo` is that plus a `kind`. `listTables` reports the schema
as a **field** — `public` included, for Postgres — rather than gluing it onto the
front of the name.

That is what lets the tree group by schema, and it fixes something the old shape
could not: a relation whose *own* name holds a dot has no correct split, so
`reporting."daily.stats"` was unaddressable while the schema was a prefix. The
fixture holds one, beside the `reporting.daily_stats` a wrong split confuses it
with.

**`Driver.qualify` is the one place a relation becomes SQL.** Postgres writes
`"schema"."table"`, always qualified — an unqualified name resolves through
`search_path`, a session setting this app never sets. MySQL drops the schema
entirely: its database *is* its schema, and its client is already pinned to one.
Every statement this side authors about a relation goes through it, which is why
`quoteIdent` no longer splits on dots and quotes a name whole — a *column*
containing one used to be mangled by that split.

**`splitRelation` survives as a fallback, for exactly one caller.** The editor's
completion scans a relation out of SQL *being typed*, so it holds a string with
no catalog row behind it; `schema` is therefore optional on these commands, and
Postgres reads a leading `schema.` off the name when it is absent. That is a
guess, and it is confined to the only case where guessing is the sole option
available — everything arriving from the tree carries both halves and never
reaches it.

**`Driver.defaultSchema` is what the UI may leave off a printed name** — `public`
for Postgres, undefined for MySQL, travelling to the UI on the connect response
beside `dialect`. Reported for `dialect`'s reason: the renderer must not hold a
table of which engine calls its default schema what. It is the conventional
default rather than a reading of `search_path`, and getting it wrong costs a name
printed in full, never a query aimed at the wrong relation — the SQL authored
here always qualifies and never consults it.

## A relation's definition, and dropping it

`db.ddl` and `db.drop` back the tree's context menu. Both are driver methods for
the same reason `db.browse` is: the SQL is per-engine and only this side may
write it. Each takes a `kind` (`table` | `view`) the UI already holds, because
Postgres branches on it and `DROP TABLE`/`DROP VIEW` differ.

**The DDL is the engine rendering its own definition**, never a string this app
reassembles from parts it had to know how to spell:

- **MySQL is `SHOW CREATE TABLE`** (`SHOW CREATE VIEW` for a view), taken
  verbatim from column 1 — the same statement the `mysql` CLI prints. The client
  is already pinned to the right database, so a bare name resolves there.
- **Postgres has no such command, so it is reassembled** — but every piece is
  Postgres rendering itself, the `format_type` rule applied all the way up: the
  column types from `format_type`, the table constraints from
  `pg_get_constraintdef`, the secondary indexes from `pg_get_indexdef`, and a
  view from `pg_get_viewdef`. The app writes the `CREATE TABLE (…)` scaffold and
  the ordering; it never spells a type, a constraint or an index itself. Two
  details are load-bearing: the relation is qualified explicitly (`"schema".
  "table"::regclass`) so it resolves regardless of `search_path`, and indexes
  that back the primary key or a unique constraint are excluded from the index
  list because the constraint clause already prints them. A `serial` comes back
  as the `nextval(…)` default Postgres actually stores, not re-invented into
  `serial` — showing what the catalog holds, the same rule as everywhere else.

**Drop has no `CASCADE`.** A relation something else depends on stays put, and
the server's refusal surfaces as a failed drop — the UI renders it in the
confirmation modal. Adding `CASCADE` would take dependents with it silently,
which is the one thing a guarded, unrepeatable action must not do. The drop is
guarded up top by a typed-name modal (the read-only-unlock friction) and, for a
connection held read-only, refused there too — read-only is a session mode that
does not reliably cover DDL, so the extension does not gate on it and the UI
does. See `docs/decisions.md`.

## Writing back edited rows

`db.write` applies a browsed grid's staged edits and deletes. It exists for the
same reason `db.browse` does: writing back means authoring `UPDATE`/`DELETE` SQL,
quoted per engine, and only this side may — the UI names a table and hands over
values, never SQL. It is offered *only* in browse mode, because `db.query` runs
the user's statement as written and the extension will not rewrite it.

**Row identity is the extension's to decide, not the UI's.** `Driver.rowKey`
answers a table's identifying columns — the primary key, else a unique index over
columns that are all `NOT NULL` (`pickRowKey` is the shared chooser; a nullable
unique column is rejected, because two rows may both be NULL there and a `WHERE`
over it targets both). It is per-engine like every catalog query: MySQL reads
`information_schema.STATISTICS` + `COLUMNS` (a functional index has a NULL
`COLUMN_NAME` and is dropped); Postgres reads `pg_index`, skipping partial
(`indpred`) and expression (`indexprs`) indexes. `null` means no identity, and
`db.write` refuses such a table outright — it recomputes the key itself and does
not trust one from the UI, so a keyless table cannot be written even if a caller
supplies column names.

Four things are load-bearing:

- **The batch is atomic.** `Driver.applyWrites` wraps the whole set in a
  transaction (`START TRANSACTION`/`BEGIN` → ops → `COMMIT`, `ROLLBACK` on any
  error), so edits and deletes land together or not at all — one **Save** is one
  transaction. A failure rolls back and throws, leaving the connection usable,
  exactly like a failed query. There is a test that a bad op reverts the good one.
- **Values go as parameters, never interpolated and never reformatted.** Every
  value in `set` and every key value is bound (`?` for mysql2, `$n` for pg —
  `runWrites` is the shared assembler, the placeholder its one callback), so the
  server parses the text. This is *Value handling* on the write path: a BIGINT
  edited to `9007199254740993` reaches the column as text and stays exact, never
  through a JS `Number`; `null` is SQL NULL, distinct from the empty string.
- **An op that matches more than one row aborts the batch.** A properly unique key
  matches at most one, so `> 1` means the key was not unique after all — safer to
  roll back and throw than to edit rows the user never saw. A `0`-row update is
  tolerated (a no-op update legitimately reports zero changed rows).
- **Read-only is the server's guard here too.** Under a read-only session the
  transaction's first write is refused by the engine and the batch rolls back —
  the UI also disables editing on a read-only connection, so this is defence in
  depth. Tested on both engines.

The identity is fetched once more inside `connection.ts::write` (not carried from
the browse, which may be stale) and every op is checked to supply all key columns
before a transaction opens.

## Value handling (the important part)

**Never let a database value round-trip through JS `Date` or `Number`.** Both
lose data silently, and this has bitten twice:

- **`Date` has to pick a timezone.** For types with no offset (MySQL `DATETIME`,
  Postgres `timestamp`, `date`) it picks the machine's. A stored `09:30` renders
  as `14:30` in New York, and a bare `DATE` can land on the *previous day* east
  of UTC. Fix: `dateStrings: true` for mysql2; identity type-parsers for the
  Postgres date OIDs (`1082, 1083, 1114, 1184, 1266`).
- **`Number` cannot hold a BIGINT.** `9007199254740993` becomes `…992`. Fix:
  `supportBigNumbers: true` for mysql2 (pg already returns int8 as a string);
  `safeIntegers(true)` per statement for bun:sqlite. `bigNumberStrings` stays
  `false` for mysql2, so ordinary ids remain numbers and only values that would
  lose precision become strings — SQLite has no equivalent switch, so every
  integer comes back a bigint there.

The rule: **show what the server sent.** An editor that quietly rewrites values
is worse than useless.

`toDisplayValue` handles the rest — cells are JSON'd across the bridge, so
`bigint` (which `JSON.stringify` throws on), `Buffer` (→ `0x…`), `Date` and
objects (→ text) are flattened. Anything a driver can return must survive
`JSON.stringify`; there is a test for exactly that.

### Other rules worth keeping

- **Rows as arrays, always** (`rowsAsArray` / `rowMode: 'array'`; `values()` for
  bun:sqlite). Object rows collapse duplicate column names, so
  `SELECT 1 AS x, 2 AS x` would lose a column. Column names come from the field
  metadata instead — except on SQLite, whose *name* list collapses even when the
  rows do not; see *An engine that is a file, not a server*.
- **No stacked statements** (`multipleStatements: false`). The editor runs one
  statement at a time.
- **System catalogs are hidden** from the tree (`information_schema`, `mysql`,
  `performance_schema`, `sys`, `pg_catalog`).
- **A relation carries its schema as a field**, and `Driver.qualify` is what
  turns the two into an identifier — see *A relation is a name and a schema*.
- **A failed statement must not kill the connection.** Tested.

## Connecting eagerly

`openConnection` opens the default client and lists databases immediately, so
bad credentials surface as a failed *Connect* rather than as a mystery error
later in the tree.

Both connect paths — `db.connect` and `db.saved.connect` — go through
`establish`, so "open it, verify it, register it" has one meaning. A third path
should use it too.

`db.saved.connect` also echoes the row's `name`, `environment`, `workspaceId` and
`readOnly` back: the extension does nothing with the first three (it carries them
the way it carries `dialect`), but they are what the UI labels the session and
groups it on the rail by — `workspaceId` in particular is what lets the rail put
the connection under its workspace. `readOnly` is the one it *acts* on, already
applied to the connection it returns.

## TLS

`ServerConfig.ssl` is one boolean, and it means **verified** TLS: each driver
turns it into `rejectUnauthorized: true`, so a certificate the machine does not
already trust is a refused connect rather than a warning. There is no "encrypt
but do not check" setting, deliberately — see `docs/decisions.md`.

`rejectUnauthorized` is written out in `TLS_OPTIONS` rather than left to the
libraries' defaults. It is the entire meaning of the flag, and a default that
moved in a minor version would turn verified TLS into an unauthenticated channel
silently, and identically to how it looks when it is working.

The two libraries spell *off* differently, and getting it backwards is quiet:

- **mysql2 reads any `ssl` value as a request for TLS**, so `ssl: false` means
  "on, with no options", not off. It must be `undefined`.
- **pg takes `ssl: false`** as plaintext and does not treat the key's presence
  as a request.

### What "verified" is worth, per engine

Not the same thing on both, which is the one asymmetry here and is measured
rather than assumed:

- **mysql2 checks the chain but not the server's identity.** MySQL 8 generates
  its own certificate (`CN=MySQL_Server_8.4.10_Auto_Generated_Server_Certificate`,
  no subjectAltName) and a connection to `127.0.0.1` with `rejectUnauthorized:
  true` **succeeds** once that CA is trusted — the name never has to match.
- **pg is expected to check identity too**, since it hands `tls.connect` a
  `servername`. Untested: the Postgres fixture has no TLS to test it against.

The UI's copy is written to be true of both: it promises the certificate is one
the machine trusts, and does not claim the server proved *which* server it is.

### Verifying a change here

The fixture containers are the wrong shape for this and that is worth knowing
before you spend an hour on it: **Postgres has TLS off** ("the server does not
support SSL connections"), and **MySQL has it on with a self-signed cert**, which
a correct client is supposed to refuse. Both failures are the feature working.

To exercise the success path, trust MySQL's own CA:

```
docker cp squeal-mysql:/var/lib/mysql/ca.pem ./ca.pem
NODE_EXTRA_CA_CERTS=./ca.pem bun ...
```

Then `SHOW SESSION STATUS LIKE 'Ssl_cipher'` is the server's own word for whether
the session is encrypted — ask it, rather than trusting the client's claim.

A **custom CA cannot be named yet**, so a private CA cannot be reached with `ssl`
on. RDS is the exception, and only for IAM connections: those verify against a
committed Amazon RDS CA bundle (see AWS IAM authentication, below), because RDS
certificates chain to Amazon's own authorities that the default trust store does
not carry. A password connection to RDS over `ssl` still hits the general
limitation. Naming an arbitrary CA file is still a backlog item, not an oversight.

## AWS IAM authentication

A connection whose `ServerConfig` carries `iam: { profile, region }` authenticates
with a short-lived RDS token instead of a password. `iam.ts` mints it with
`@aws-sdk/rds-signer`, signing against the SSO-backed AWS profile that
`fromIni` resolves. The token *is* the password — RDS IAM auth is password auth
where the password is a signed URL good for ~15 minutes — so the drivers never
learned IAM exists.

Four things are load-bearing:

- **The token is minted per client, in `connection.ts::getClient`, not once at
  connect.** A connection opens a new client for each database the user visits
  (the client-per-database rule), and that can outlive the token that first
  connected. Minting is a *local* presign over cached credentials, so re-minting
  per client is cheap; the only thing that can reach the network is the SDK
  refreshing expired SSO credentials, which it caches.
- **IAM requires `ssl`, refused in `openConnection`.** An IAM token is a bearer
  secret; plaintext would hand it to anyone on the wire. The UI also forces the
  box on, so this is defence in depth, not the only guard.
- **IAM verifies against Amazon's bundled RDS CAs, not the machine's trust
  store.** RDS certificates chain to Amazon's own authorities, which are in
  neither Node/Bun's bundled roots nor a direct socket's OS store — so verified
  TLS fails with `unable to get local issuer certificate` without them.
  `rds-global-bundle.pem` (Amazon's published bundle) is committed and folded into
  the binary as text, and `drivers.ts::tlsOptions` makes it the `ca` for an IAM
  connection while leaving `rejectUnauthorized` on. A password connection keeps
  the OS trust store — only IAM, whose target is known to be RDS, gets the bundle.
  See `docs/decisions.md`.
- **An expired SSO session is rewritten, not passed through.** `mapAwsError` turns
  the SDK's credentials failure into a message naming `aws sso login --profile X`,
  so a lapsed session reads as "log in again" rather than as the database
  rejecting the connection. Because the first client opens eagerly, it lands as a
  failed *Connect*. Detection is best-effort on the SDK's error name and text.
- **Nothing secret is stored.** The store keeps `aws_profile` and `aws_region`
  (see below), never a token — `resolveSaved` returns an empty password for an
  IAM row and lets `getClient` mint the token. `hasPassword` is false for an IAM
  connection, and `config.iam` is what tells the UI that means "no password
  needed", not "prompt for one".

See `docs/decisions.md` for why IAM is a config variation rather than a third
connect command, and why the AWS SDK earned a dependency.

## Workspaces and saved connections (`store.ts`)

Named connections live in SQLite at the OS's per-user data directory
(`%APPDATA%/squeal-editor/squeal.db` on Windows); only the password is
encrypted, with AES-256-GCM. The 32-byte key lives in the **OS keychain** via
`Bun.secrets`, generated on first use.

Every connection belongs to a **workspace** and carries an **environment**. Two
tables: `workspaces` (id, name, icon, colour) and `saved_connections`, which
references it `ON DELETE CASCADE`. The workspace's `colour` is an id the extension
carries and never reads — the UI resolves it to a swatch — exactly like `icon`;
it is what the rail tints a workspace's group with once its connections are open.

The rules that hold the grouping together:

- **There is always at least one workspace.** A connection hangs off one, so a
  store with none has nowhere to put a connection. `ensureDefaultWorkspace`
  creates `Default` when the table is empty, and `deleteWorkspace` refuses the
  last one rather than letting the app reach that state and recover from it.
- **A connection's name is unique per workspace**, not globally — `UNIQUE
  (workspace_id, name)`. That is the whole point of grouping: a project has the
  same servers again in each environment, so `api` in Dev and `api` in
  Production must be able to coexist.
- **Deleting a workspace deletes its connections, explicitly.** `deleteWorkspace`
  deletes the rows itself inside a transaction rather than leaning on the
  CASCADE, because taking someone's stored passwords with a workspace is the
  thing the UI's confirmation is about and it should be readable here. The
  foreign key stays for what it is good at: making an orphaned `workspace_id`
  unwritable.
- **`PRAGMA foreign_keys = ON` is per-connection**, not stored in the file, so it
  is set on every `open()`. Miss it and the `REFERENCES` clause is decoration.
- **The workspace is checked before the insert**, so saving into one that has
  gone says so instead of surfacing `FOREIGN KEY constraint failed`.

### User settings

`settings` is a key/value table in the same file, and it is the only thing in the
store that is about nobody's server. `settings.list` reads the lot in one call
(they are a handful of short strings, and a call per key would grow the launch
path every time a preference is added); `settings.set` writes one.

**The store holds text and no vocabulary of keys.** A value's meaning belongs to
the feature that writes and reads it, so a new preference is not a change here
and there is no migration per toggle — which is the whole reason this is not a
column per preference the way the connection tables are. A key nobody has written
is **absent**, never defaulted: the reader spells its own default, so a
preference added later cannot arrive already holding an answer its feature never
chose.

The first one is `tree.groupBySchema`. Settings live here rather than in the
webview for the store's own reason — see `docs/decisions.md`.

### Starred tables

`stars` is a table in the same file, `connection_id REFERENCES
saved_connections(id) ON DELETE CASCADE` — a star belongs to a *saved*
connection, never the runtime one `db.connect` hands out. That id is minted
fresh every session and forgotten with it, so a star filed under it would
never be seen again; the saved row's own id is the only one that outlives a
disconnect, which is the whole point of a star persisting at all. Deleting the
connection takes its stars with it, the same rule the password already
follows.

`listStars(connectionId)` answers every star a connection holds, across every
database it has ever been browsed in — one call, not one per database, because
`db.stars.list` is meant to be asked once per session the way `db.saved.connect`
already hands back the whole database list in one round trip. `setStar` takes
the state the caller wants (`starred: true` or `false`) rather than a toggle,
so `db.stars.set` is idempotent: an `INSERT ... ON CONFLICT DO NOTHING` or a
plain `DELETE`, either a no-op on a row already in the state asked for.

**`schema` is `NOT NULL DEFAULT ''`, not nullable.** SQLite's `UNIQUE` treats
every `NULL` as distinct from every other one, so a nullable schema would let
MySQL's tables — which never carry a schema — be starred twice over, each
insert reading as a fresh row rather than the same one again. The empty string
is a real value the `UNIQUE (connection_id, database, schema, table_name)`
index can actually compare, which a `NULL` cannot be asked to do.

### Saved sessions

`connection_sessions` holds one **opaque snapshot string** per saved connection —
the tabs and queries it had open, so `db.saved.connect` can hand them back and the
UI can reopen them. `connection_id` is the primary key and `REFERENCES
saved_connections(id) ON DELETE CASCADE`, the same rule the stars and the password
follow: keyed by the *saved* row (a session filed under the runtime `connectionId`
would be forgotten the moment the connection closed), and taken with the
connection when it is deleted.

**The store keeps text and no vocabulary of what a tab is** — `getSession` reads
the string, `setSession` upserts it, and neither parses it. This is the settings
rule applied to a whole session: the meaning is the UI's, so a tab shape has no
business in the schema here, and adding a tab kind is not a change to this file.
`db.session.save` writes it; `db.saved.connect` returns it beside `config` and the
stars. Only the UI encodes and decodes it (`SessionSnapshot`); see
`docs/frontend.md` and `docs/decisions.md`.

`dataDir()` is exported for one caller: `app.dataDir`, which the About menu's
*Open app data* asks for and then hands to `Neutralino.os.open`. The webview opens
the folder perfectly well — the only thing it lacks is the path, and the path is a
per-platform rule that belongs beside the database it names. This is the mirror of
`window.matchFrame` rather than another instance of it: there the extension makes a
call the webview cannot, here it only answers *where*. An extension that shelled
out to a file manager itself would be a second answer to a question the webview
already has an API for.

### The schema, and the migrations that *are* it (`migrations/`)

**There is no `CREATE TABLE` for the current schema anywhere.** The schema *is*
what `MIGRATIONS` produces when run from nothing — one file per change, applied
oldest first, each step recorded in a `schema_migrations` table in the same file.
A fresh store and a store written three versions ago walk the same steps, so they
cannot end up different. A "current schema" constant kept beside the migrations
would be a second answer to what shape the file is, and the two drift the moment
either is edited alone.

```
migrations/
  migration.ts                          the contract, and the two schema probes
  index.ts                              the ordered list, and how to add one
  runner.ts                             runMigrations, and adoption
  1784202096-saved-connections.ts       the original flat list, UNIQUE(name)
  1784289561-workspaces.ts              the table, and the rebuild that replaced
                                        that constraint with UNIQUE(workspace_id, name)
  1784289562-connection-ssl.ts
  1784313318-connection-read-only.ts
  1784374797-connection-aws-iam.ts
  1784408527-workspace-colour.ts
  1784584732-settings.ts                the key/value table user preferences live in
  1784629337-stars.ts                   starred tables, keyed by saved connection
  1784997641-connection-sessions.ts     the opaque per-connection session snapshot
```

A file is `<epoch>-what-it-does.ts` and **that epoch is its `version`** — the
filename and the field are one number, and `saved.test.ts` asserts they have not
drifted. Take a new one from the clock (`date +%s`), never from the last file
+ 1. The six above carry the commit epochs of the changes they represent, because
that is when the schema actually moved.

Epoch **seconds**, not milliseconds: ten digits until 2286, so sorting the
filenames as text and the versions as numbers give the same order. The test pins
the width for exactly that reason.

Three rules, and the first is the one that will bite:

- **A migration is frozen once it has shipped.** It has already run on someone's
  disk, so editing it changes what a *new* store gets and nothing else — the two
  schemas then differ silently and permanently. Change the schema by appending a
  file, never by editing one.
- **Each one spells its own SQL out in full, values included.** They read
  repetitively on purpose. A migration that reaches for a shared constant
  rewrites its own history the day that constant changes: rename the default
  workspace and `workspaces` would retroactively claim it always wrote the new
  name.
- **`index.ts` imports each file by name, and that cannot become a directory
  scan.** This is the one that looks like a missed cleanup and is not: the
  extension ships as a `bun build --compile` binary and the release then deletes
  every source file beside it (`release.yml`, *Slim the extension folder*), so
  only statically imported modules exist at runtime. **The tests would not catch
  the mistake** — they spawn `bun main.ts` against the source tree, where a scan
  finds every file and passes. It fails only in a packaged build, as a store
  that quietly has no tables. `index.ts` also asserts its own order at import,
  since the list is hand-maintained.

The workspaces rebuild is the only non-trivial one. **SQLite cannot drop a
constraint**, so the table is rebuilt: rename the old one, create the new one,
copy every row into the default workspace as `local`, drop the original. Order is
load-bearing — `workspaces` and its default row must both exist before any
connection is copied, or the rows have nothing to reference. `local` is the
migrated environment because nobody said what those connections are, and the
guess that costs least is the one that never labels an unclassified row
Production.

Every column added since is a plain `ADD COLUMN`, and **each default is
load-bearing rather than incidental**: `ssl` and `read_only` default `0` because
those rows connect in plaintext and read-write today, so anything else migrates a
working connection into a broken one — every row at once, on the launch after an
update, reading as the server having changed rather than the app. The two AWS
columns default `NULL`, exactly what a password connection carries, so every
existing row stays the password connection it has always been; there is no
backfill, because nobody said any old row was an IAM one, and their presence
together *is* the auth method (`aws_profile` alone is the test). `color` defaults
to `'slate'`, the neutral swatch, so a workspace made before the column is never
colourless. The same rule throughout: the guess that costs least changes nothing
it was not told to.

### Adoption: the one place that still reads a schema to date it

Stores exist on disk that were written before there was a version to record, so
`adopt` infers one from the file's shape. **Each migration answers for itself**
— an optional `applied(db)` saying whether its own work is already there — and
`adopt` walks the list until one cannot see its work. What is on disk is always a
*prefix* of the list, so the first gap ends the walk. Keeping the probe in the
same file as the SQL it looks for is what stops the inference drifting out of
step with the list, which a separate ladder of column checks would do the first
time someone inserted a file and forgot the other half.

It runs **once**, the first time such a file is opened, and never again. That is
the whole difference from what this replaced, where every column added another
probe to every launch forever.

**A migration written from now on should leave `applied` off.** Every store from
here forward records its own version, so there is nothing left to infer, and a
probe that can never fire is one that can only rot. The burden ends with the six
files that predate the mechanism.

Adoption gets exactly one chance to be right about a file it did not write: place
a store too low and a migration re-runs into a duplicate-column crash on launch;
too high and one is silently skipped. `schema_migrations.origin` records
`adopted` against `applied` for precisely that reason — if the inference is ever
wrong, the table is what makes it diagnosable rather than mystifying.

Two things sit deliberately outside the sequence. `PRAGMA foreign_keys = ON` is
set in `open()` *before* the migrations run, so a rebuild among them runs under
the same rules the app does. And `ensureDefaultWorkspace` stays in `open()`
rather than moving into a migration: "there is always at least one workspace" is
a data invariant that has to hold on every launch, not a schema step that
happened once.

`tests/saved.test.ts` exercises all of this by **downgrading a live store**
rather than hand-building a fixture, so the password blobs going through the
rebuild are real ones encrypted with the real key — which is what makes "it still
connects afterwards" mean anything. A downgrade there rewinds the stamp along
with the columns, and from the top down; see `docs/testing.md` for why both
halves are required.

`bun:sqlite` and `Bun.secrets` are Bun builtins, so none of this added a
dependency. See `docs/decisions.md` for why the store cannot live in the webview.

The rules, each of which is load-bearing:

- **`hasPassword: false` is three different facts, and only one means "ask".** A
  password connection that stores none must prompt; an IAM connection mints a
  token; a file engine has no authentication at all. `resolveSaved` exempts the
  latter two and the UI skips the prompt for the same two, off the same
  `isFileEngine` and the same `config.iam` — get the set wrong on either side and
  a connection that saved fine refuses to open.
- **The password never travels toward the UI.** `SavedConnection` carries
  `hasPassword`, never a secret. `ServerConfig` (no password) and
  `ConnectionConfig` (`ServerConfig` + password) exist to make that a compile
  error rather than a discipline.
- **`PasswordUpdate` has a `keep` arm** because the edit form is never sent the
  password it is editing, so "leave the stored one alone" cannot be expressed as
  a value. `store` / `none` / `keep` are the three real cases and there are no
  others.
- **The key is memoised as a promise, not a key.** Two saves racing on a first
  run would otherwise each generate one, and the second would overwrite the
  first — leaving the first save's password permanently undecryptable.
- **GCM authenticates.** A tampered or corrupted row fails at the tag rather than
  decrypting to garbage. Do not swap it for CBC.
- **A name clash is checked, not left to the UNIQUE constraint**, because a raw
  SQLite error names a column and tells the user nothing.

`SQUEAL_DATA_DIR` and `SQUEAL_KEYCHAIN_SERVICE` override where the store and the
key live. They exist for the tests, which must not touch the real user's
connections — see `docs/testing.md`.

## The updater (`updater.ts`)

The app checks for a newer release on launch and, only if the user says yes,
downloads and applies it. All of that is native work the webview cannot do —
reaching GitHub, streaming to disk, verifying, launching a process — so it lives
here, the same reason connections and the frame paint do. Windows-only for now;
`update.check` reports `supported: false` everywhere else and returns before it
reaches the network. That guard is load-bearing, not a formality: the assets it
would find are `squeal-editor-setup-v*.exe` and `applyUpdate` hands its download
to `cmd /c start`, so a macOS build that got past it would verify a Windows
installer's signature and then try to run it. The UI reads `supported` and says
so — a platform with no update path is a third answer, not a failed check.

Three commands, and a module-level `pending` slot (the app is one instance, like
the connection registry) that `check` fills and `download`/`apply` read:

- **`update.check`** hits `releases/latest`, ignores drafts/prereleases, and
  reports a newer version *only if the release also carries all three signing
  assets* — the installer, its `.sig`, and `SHA256SUMS`. A newer tag missing them
  (a release cut before the signing key was set) is not offered, so `download`
  can never find itself with nothing to verify against. A check never throws: any
  failure is `hasUpdate: false`, because an unasked-for update must not surface as
  an error. But it also reports `checked: false` when the request itself failed,
  so the UI can tell "you are current" from "I could not reach the releases" — the
  two look identical in `hasUpdate` alone, and reporting the second as the first is
  a quiet lie. With `supported` that makes three answers the banner keeps apart,
  and only the middle one offers a retry: retrying an unsupported platform could
  never come back different.

  **The releases must be public.** The fetch is unauthenticated — no credential
  may ship in a distributed app — so a private repo answers `releases/latest` with
  a 404 and every check comes back `checked: false`. Its assets are not
  downloadable without auth either. The updater therefore assumes public releases;
  that is a distribution constraint, not something a code change can lift.
- **`update.download`** streams the installer to a temp dir, broadcasting
  `update.progress` as bytes arrive, then verifies **SHA-256 first, then the
  ed25519 signature** — both must pass or the temp dir is discarded and it throws.
  Order matters: the checksum is the cheap catch for a truncated download, the
  signature is the proof of origin. Nothing unverified is ever staged for apply.
- **`update.apply`** launches the staged installer detached (`cmd /c start`, so
  it outlives the app it is about to replace) with `/SILENT /CLOSEAPPLICATIONS
  /RESTARTAPPLICATIONS`; Inno's Restart Manager closes this app and its extension,
  swaps every file, and relaunches. The UI calls `app.exit()` once this returns.

**Signature verification fails closed.** `verifyEd25519` returns false — never
throws its way to true — on a bad key, a bad signature, or the empty baked key.
The public key is `updateKey.ts`, committed empty until `scripts/keygen.ts` mints
the pair; while empty, no update can be applied, which is the safe default. See
`docs/decisions.md` for why detached ed25519 rather than Authenticode, and why the
private key lives only in CI.

The pure helpers (`compareVersions`, `verifyEd25519`, `selectAssets`,
`parseChecksum`) are exported and unit-tested in `tests/updater.test.ts` — no
database, so they run without the fixtures. The one that matters most flips a byte
and requires the signature to fail, the same shape as the store's
ciphertext-bit-flip test.

## Lifecycle

The extension pings the app every 10s and exits if it goes 30s without a
response. This is not belt-and-braces — it is the *only* reliable signal. See
`docs/decisions.md` for why the socket cannot be trusted.

Verified both ways: it survives 60s+ of normal use (Neutralino answers pings),
and reaps itself ~25s after the app is hard-killed, releasing its connections.
