# The database extension

`extensions/db/` — a Bun + TypeScript process spawned by Neutralino. It is the
only place in the repo that speaks SQL or holds a socket to a database.

Bun runs the TypeScript directly, so **there is no build step**. Edit `main.ts`,
restart the app, done.

## What it is actually for

Databases are the reason it exists, but not the definition. It is **the process
that makes the native calls the webview cannot**: Neutralino's runtime cannot open
a TCP socket, so connections live here — and it cannot call `dwmapi` either, so
painting the window frame lives here too (`chrome.ts`) — as does getting a DLL
into the app process, since the one thing this process cannot do for the window
is answer its messages.

That is the test for anything new. "Can the webview do this itself?" If yes, it
belongs in the frontend. If no, it belongs here, and being unrelated to SQL is
not an objection.

## Files

| File | Owns |
|---|---|
| `main.ts` | transport (WebSocket, heartbeat), the connection registry, command handlers |
| `connection.ts` | one server connection; per-database clients; the page SQL for browsing |
| `drivers/` | the engine layer: the contract, the shared assemblers, the dispatch, and one file per engine's SQL and value handling |
| `store.ts` | workspaces and saved connections: the SQLite file, the rows, and the password encryption |
| `transfer.ts` | the connections file: what an export writes, what an import reads, and the validation between |
| `migrations/` | the store's schema, one file per change, plus the runner that brings a file up to it |
| `chrome.ts` | the window frame: its colour, the maximise clamp, and injecting the chrome DLL that reclaims the non-client area — all over `bun:ffi`. Windows-only, best-effort |
| `log.ts` | levelled, timestamped logging to a bounded file on disk |
| `updater.ts` | the user-initiated updater: the release check, the verified download, and the swap — Windows' installer, macOS' own script |
| `updateKey.ts` | the committed ed25519 public key the download's signature is checked against |
| `assistant.ts` | the assistant's half that cannot live in the webview: the API key in the keychain, the four providers, the catalog, and one streaming turn |

The split matters: `main.ts` knows nothing about SQL, `drivers/` knows nothing
about the transport, and `store.ts` and `chrome.ts` know nothing about either.

### Inside `drivers/`

| File | Owns |
|---|---|
| `driver.ts` | the contract: `Driver<C>`, `Relation`, `TableMeta`, `QueryOutcome` |
| `common.ts` | what every engine leans on and none of them may spell differently: `toDisplayValue`, `pickRowKey`, `pickForeignKeys`, `runWrites`, `buildWhere`, `orderByClause`, `selectExpressionAt`, the TLS options |
| `mysql.ts`, `postgres.ts`, `sqlite.ts` | one engine each: its SQL, its catalog queries, its quoting, and its library's quirks |
| `index.ts` | the barrel: `withDriver`, and the contract re-exported |

**Import `drivers/index.ts`, never a file beside it** — the same rule
`shared/protocol/` follows, and for the same reason: a helper can move between
`common.ts` and an engine without touching a caller. The engine files are the one
exception, importing `driver.ts` and `common.ts` directly, because importing the
barrel that imports them would be the cycle.

An engine file knows nothing of the other two. Anything two of them would
otherwise both spell is a `common.ts` assembler taking `quoteIdent` and
`placeholder` as callbacks — that is what keeps "how a filter is built" from
having three answers.

## Adding an engine

1. Add the name to `EngineType` in `shared/protocol/config.ts`.
2. Write `extensions/db/drivers/<engine>.ts`, exporting a `Driver<C>` where `C`
   is the library's client type.
   Its `dialect` is how the editor will highlight it *and* which words it will
   suggest — one of Monaco's SQL language ids, or `sql` if it has no grammar of
   its own. Do not invent one: `sql` is the deliberate fallback, and a dialect
   with no grammar behind it means an editor that suggests nothing.
3. Import it in `drivers/index.ts` and add a `case` to `withDriver`. By hand,
   for `migrations/index.ts`'s reason: the extension ships compiled with its
   source deleted beside it, so only a statically imported file is in there.
4. Add the option to `ENGINES` in `frontend/src/common/db/engines.ts`.

Then add it to the `describe.each` in `tests/extension.test.ts` — every engine
runs the *same* contract tests, which is what keeps them interchangeable. The UI
cannot tell engines apart, so anything asymmetric is a bug.

The point of the shape is that steps 2–3 are a *new file* and a line, never an
edit into somebody else's engine. If a change asks you to widen `common.ts`
instead, that is the signal to check whether the contract is missing a method —
see *Browsing a table* on `LIMIT/OFFSET`, which is the standing example.

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

Five things about it are load-bearing, and each is the kind that looks arbitrary:

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
- **A double-quoted name it cannot resolve becomes a string literal**, not an
  error. So `ORDER BY "no_such_column"` orders by a constant and quietly does
  nothing, where MySQL and Postgres both reject the statement. Nothing in the app
  can reach it — the grid only ever sorts by a header it drew — but it is why the
  sort contract test asserts that the connection survives rather than asserting
  the statement failed: pinning `ok: false` there would be pinning which engine
  the test is talking to. Worth knowing before trusting a quoted identifier here
  to fail loudly.
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
- **No `ORDER BY` unless one was asked for.** Rows come back in the server's
  natural order, which is not a stable order: a write between two page fetches
  can shift a row across the boundary. Accepted deliberately; the extension never
  *picks* an order, because a table with no meaningful one has no correct one to
  impose and ordering by a key we chose would sort the whole table per page. A
  `sort` the user clicked a header for is the other case — see below.
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

`buildWhere` in `drivers/common.ts` is the shared assembler, the same shape as
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

### Ordering a page: `sort`

`db.browse` also takes an optional `SortOrder` — one column and a direction —
which becomes an `ORDER BY` **between the `WHERE` and the `LIMIT`**. That
position is the whole of it: the table is ordered and the page is cut from the
result, so page 2 of a sorted table is the second page *of that order*. Ordering
the hundred rows after they arrive would sort each page within itself and leave
the pages themselves in natural order — correct-looking on page one, wrong from
page two.

`orderByClause` in `drivers/common.ts` is the assembler, beside `buildWhere` and
the same shape, with one difference: it takes `quoteIdent` alone and no
`placeholder`, because a sort has **no value to bind**. Both halves reach the SQL
as text, so both are guarded rather than parameterised — the column through the
driver's own `quoteIdent` (which escapes the quote character, so a name carrying
one cannot end the identifier), and the direction against a closed set checked at
runtime, since it arrives as user JSON and the type is not the guard. Quoting is
unconditional, so a mixed-case column like `eventType` works without a
"needs it or doesn't" judgment — the same lesson the filter bar already paid for.

The column is a name the **result** answers under, never one read off a catalog.
That is what lets one `SortOrder` serve both a browsed page and a wrapped query:
the header the user clicked is the only name true of both.

## Sorting a query: the one statement this side rewrites

`db.query` takes the same optional `sort`, and given one it runs
`SELECT * FROM (<sql>) squeal_sorted ORDER BY <column> <direction>` instead of
the statement alone. **This is the only place the extension rewrites SQL the user
wrote**, and it is deliberate rather than a hole: paging and filtering a query's
result are still refused, because both change *which* rows come back and a grid
showing a subset of what was asked for is an editor lying about what it ran. A
sort changes none — the statement runs whole, inside the parenthesis, and the
same rows arrive in a different order. That is the entire licence; see
`docs/decisions.md`.

Three things about it are load-bearing:

- **It wraps rather than appends.** A statement already ending in an `ORDER BY`
  would become a syntax error, and a `UNION` would take an appended clause as
  belonging to its last branch. Wrapping is the only form that works regardless
  of what the statement does — its own ordering, a CTE, a union.
- **The trailing semicolon is stripped, and only when wrapping.** It would
  terminate the wrapper rather than the subquery. An unsorted statement is passed
  through untouched, semicolon included, which is the rule this is the exception
  to still holding for every call that does not carry a sort.
- **The alias is not optional.** MySQL and Postgres both refuse an unaliased
  derived table.

The wrap is written in `connection.ts` beside the page SQL rather than in a
driver, for the `LIMIT/OFFSET` reason: all three engines spell it identically. An
engine that does not makes it a `Driver` method, not an `if` here.

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

## The whole database at once, for the diagram

`db.relationships` answers a database's every table with its columns and its
foreign keys, in one call — what the frontend's relationship diagram draws.

**It is a command of its own rather than `db.tables` plus a `db.columns` per
table**, because a diagram is about all of them simultaneously: two hundred
tables would be four hundred round trips before one line could be drawn, and the
answer would be stitched together from two hundred separately-timed views of a
catalog that may have moved in between. Each driver answers it with **two**
catalog reads over the whole database — the same two queries `listColumns`
already makes for one relation, with the relation filter lifted.

SQLite is the exception and cannot be otherwise: it has no catalog to read across
a database, since `pragma_table_info` and `pragma_foreign_key_list` each take a
table name. So it loops. That is affordable for the reason the loop exists at all
— the database is a file on this machine, so each pragma reads pages that are
already open rather than making a round trip.

**Tables only.** A view declares no foreign key and nothing may reference one, so
it could only ever be a node no line reaches. Postgres also drops individual
partitions (`relispartition`), exactly as `listTables` does — they carry their
parent's columns and would draw the same table N times.

**A composite constraint survives here, where `pickForeignKeys` drops it**, and
the two answers are a deliberate pair rather than a drift. That one is answering
for a *cell*, and a cell holds one value, so a fraction of a key is a wrong
answer. A line between two tables is not a fraction of anything: the tables
really are related, and dropping the constraint would draw them as strangers.
`ForeignKeyLink` is therefore the whole constraint — every column, in key order,
paired position for position with the columns it points at — and
`assembleDiagram` in `drivers/common.ts` is where the grouping lives so it cannot
drift per engine, the same footing as `pickRowKey` and `pickForeignKeys` beside
it. The fixture's `cities` → `regions` is the case that pins both answers at
once; see `docs/testing.md`.

**A constraint whose target is not among the tables returned is dropped**, since
a line has to end somewhere the diagram is drawing. That is a cross-database
foreign key on MySQL, or one into a schema the column read did not cover. MySQL
is also the one driver that compares `REFERENCED_TABLE_SCHEMA` here where
`listColumns` ignores it, and the widened scope is why: this read spans every
table in the database at once, so a foreign key into *another* database would
otherwise land on whichever local table happened to share the referenced name.

**No layout comes back.** Where a node sits is the webview's business and this
side has no opinion about pixels, which is why the response is shaped as catalog
rather than as a drawing.

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

## Triggers and functions

`db.triggers`/`db.triggerDdl` and `db.functions`/`db.functionDdl` back the
tree's trigger and function nodes, the same shape `db.ddl` is for a table:
the UI names what it wants and never writes the catalog query, because only
this side may. Triggers are per-table everywhere (`db.triggers` takes a
`Relation`); functions and procedures are database-wide (`db.functions` takes
only a database) since neither is scoped to a table.

**SQLite has no server-side functions.** `listFunctions` returns `[]`
unconditionally and `functionDdl` is unreachable from an empty list; SQLite's
triggers work the same as the other two engines, read straight out of
`sqlite_master.sql` the way `tableDdl` already is for a table there.

**`db.functionDdl` carries the whole `db.functions` row back**, not a name and a
schema. Every field of it is load-bearing here and none can be recovered on this
side:

- **`kind` picks MySQL's verb.** `SHOW CREATE FUNCTION` on a name that is
  actually a procedure throws `ER_SP_DOES_NOT_EXIST` outright rather than
  answering empty, so there is no failed-then-fall-back path — the same way
  `db.ddl` is already told `table` vs `view` rather than guessing.
- **`id` picks the Postgres overload.** `pg_get_functiondef` takes a single
  `oid`, not a schema-qualified name; casting `"schema"."name"` to `regprocedure`
  is the tempting shortcut and the wrong one, because it needs the full
  argument-type list. So `listFunctions` reports `p.oid::text` on every row and
  `functionDdl` feeds it straight back. A name lookup with `LIMIT 1` remains as
  the fallback for a caller holding a row from before `id` existed, and it is an
  approximation: on `public.square(int)` beside `public.square(text)` it answers
  about whichever the catalog returns first.

**Overloads are what `id` and `args` exist for.** A Postgres function is not
identified by name, schema and kind — `pg_proc` can hold a dozen rows alike in
all three. `listFunctions` reports the oid as the row's identity and
`pg_get_function_identity_arguments` as its signature (identity arguments, not
`pg_get_function_arguments`, whose `DEFAULT` clauses describe how a function may
be *called* rather than what it *is*). MySQL reports neither: a routine name is
already unique within a database there. The fixture defines `square` twice on
Postgres so the suite has the pair.

Postgres reads its own triggers from `pg_trigger` (`NOT tgisinternal`, which
excludes the ones a constraint creates for itself) and renders them with
`pg_get_triggerdef`, the same "the engine renders its own definition" rule
`tableDdl` follows. MySQL reads `information_schema.TRIGGERS`/`ROUTINES` and
takes `SHOW CREATE TRIGGER`/`FUNCTION`/`PROCEDURE` verbatim, the same as
`SHOW CREATE TABLE`.

## Writing back edited rows

`db.write` applies a browsed grid's staged edits and deletes. It exists for the
same reason `db.browse` does: writing back means authoring `UPDATE`/`DELETE` SQL,
quoted per engine, and only this side may — the UI names a table and hands over
values, never SQL. `db.query` itself is never rewritten to make this possible —
a hand-typed query still runs exactly as given — but its *result* may still be
writable: see *A hand-typed query's row identity* below.

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

### A hand-typed query's row identity

`db.tableKey` answers the same `Driver.rowKey` call alone, without paging or
writing anything — `{ keyColumns: string[] | null }` for a named table. It
exists because `db.query` carries no table name for a row identity to ride
along with the way `db.browse`'s page does: the UI scans a hand-typed query
for the one table its `FROM` names and asks this separately, once, to learn
whether the query's own result happens to carry that table's key. A name the
scan cannot place in the catalog (a CTE, a misread alias) answers `null` the
same as any other keyless table — never a throw, for `db.columns`'s reason:
the caller is reading a query as it stands, and a name that is not a real
table is the normal case here, not an exceptional one. See `docs/frontend.md`
and `docs/decisions.md` for the UI-side detection and why it is stricter than
the editor's completion scanner.

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
- **No stacked statements** (`multipleStatements: false`), and this side is not
  what changed when the editor learned to run several. `db.query` takes one
  statement and always has; the UI splits its tab into statements and issues a
  `db.query` per statement, in order, stopping at the first failure — so every
  one is its own round trip on its own terms, with no transaction wrapped around
  the batch. Turning this flag on would put the two engines back into
  disagreement it exists to prevent: Postgres answers a stacked run with the
  *last* statement's result and drops the rest, which is exactly the answer the
  split was written to stop losing. See `docs/frontend.md`.
- **System catalogs are hidden** from the tree (`information_schema`, `mysql`,
  `performance_schema`, `sys`, `pg_catalog`).
- **A relation carries its schema as a field**, and `Driver.qualify` is what
  turns the two into an identifier — see *A relation is a name and a schema*.
- **A failed statement must not kill the connection.** Tested.

## When the server hangs up (the other important part)

A connection can end without either side of this app asking: an idle timeout, a
failover, an administrator's `KILL`, a load balancer reaping a quiet socket. It
is the everyday shape of an RDS IAM connection, which sits idle between queries
behind exactly such a balancer. The extension cannot prevent it; what it must do
is survive it, say so, and come back.

**The listener is the load-bearing part, and it looks like a nicety.** Both
server libraries are EventEmitters that `emit('error')` when the socket dies with
nothing in flight, and an `error` event with no listener is how Node spells
*throw* — which reaches `main.ts`'s `uncaughtException` handler and takes the
whole extension down, **every other connection with it**. From the UI that reads
as the app looking perfectly connected while nothing works and every command
sits until the bridge's 60s timeout. `Driver.onClientLost` is what makes it a
handled event; `tests/extension.test.ts` kills a real backend from a second
connection and asserts the other one still answers.

Five rules:

- **A drop is not a disconnect.** The connection stays in the registry with its
  config, its read-only mode and its id; only the dead client leaves the
  per-database map. `getClient` then opens a replacement on the next command,
  which for an IAM connection mints a fresh token — the same per-client minting
  the client-per-database rule already needed, doing the job it was built for.
- **The failed call is never retried.** `useClient` re-throws exactly what it
  caught. The extension cannot know whether a statement reached the server
  before the socket went, and a helpful retry of an `INSERT` that already
  committed writes the row twice. Reopening is the *next* command's job, and the
  next command is one the user asked for.
- **There are two ways to find out and both are needed.** `onClientLost` catches
  a client dropped while idle. It does not catch one dropped *during* a query:
  both libraries hand a network failure to the waiting command rather than to
  the connection when there is a command to hand it to, so nothing is emitted.
  `Driver.isConnectionLost` is the second reading, asked of every failure by
  `useClient`. Miss it and the dead client stays cached and every command after
  it fails identically for as long as the app is open.
- **`isConnectionLost` reads structure, never message text.** mysql2 marks every
  connection-ending error `fatal` and marks nothing else that way. Postgres is
  the one with a trap in it: a killed backend arrives as an ordinary
  `DatabaseError` from the server, so "came from the server" cannot mean "your
  SQL was wrong" — the SQLSTATE is what is read (class `08`, plus `57P01`/`02`/
  `03`), and the codes rather than the `severity` beside them, because a
  SQLSTATE is five fixed characters while the severity is localised into the
  server's `lc_messages`. SQLite answers `false` unconditionally: a file has no
  socket to lose.
- **Closing is bounded.** `closeClient` waits for the server to acknowledge the
  goodbye, and a half-open socket has nobody left to answer — so *Disconnect*
  used to sit for the bridge's whole 60s and then fail. `connection.ts::close`
  races each client against `CLOSE_TIMEOUT_MS` and then `destroyClient`s it.

The UI is told by broadcast, not by a reply: `CONNECTION_STATE_EVENT` carries
`{ connectionId, state: 'lost' | 'restored', reason? }`, which is why the
connection's id is minted in `establish` **before** `openConnection` rather than
after — a connection can be dropped from its first idle second, well before an
id assigned on the way out would exist. The `log.ts` rule applies as usual: a
drop has no other way to surface, so it is logged; nothing a database returned
goes with it.

**Prevention, separately:** both drivers enable TCP keepalive with a 30s initial
delay, well under the ~350s an AWS network load balancer gives an idle
connection. It makes the drop rarer. It does not make it impossible, which is
why everything above exists regardless.

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

### Testing a draft: `db.test`, the connect that keeps nothing

`db.test` opens a connection from a config, asks `Driver.serverVersion`, and
closes it — deliberately **not** through `establish`, which is the third path
above and would register it. Nothing goes into `connections`, so there is no
`connectionId` to answer with and nothing a later command could find.

Three things about it are load-bearing:

- **The close is in a `finally`.** The version query is the first thing that can
  fail after the socket is up, and an early return there would leave exactly the
  orphaned connection the heartbeat exists to reap — one this side can simply not
  create.
- **`serverVersion` is the server's own string, passed on untouched.** `VERSION()`,
  `current_setting('server_version')` and `sqlite_version()` are three different
  questions, which is why it is a driver method; what comes back is not parsed and
  gets no product name put in front of it. A MariaDB server answering
  `11.4.2-MariaDB` under the MySQL driver is telling the truth, and normalising
  that away would be the value-handling rule broken about a value that is only
  ever read. Postgres reads the *setting* rather than `version()`, whose banner
  carries the build's compiler and architecture.
- **The password may come from the store without the config doing so.**
  `TestPassword` is `typed` or `stored`; the `stored` arm names a saved row and
  `storedPassword` decrypts that one field and nothing else. That is not
  `resolveSaved`, which would also hand back the row's *config* — and the config
  is the thing the form is in the middle of editing away from. It is what lets the
  edit form test a connection whose password it was never sent, the same case
  `PasswordUpdate.keep` covers on the way out.

No progress is broadcast. `CONNECT_PROGRESS_EVENT` reads as "the connect you
started is at this phase", and a test is not one — the phase would outlive it and
describe a connection that never opened.

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
  refreshing expired SSO credentials, which it caches. This is also what makes
  an IAM connection *recoverable* after the server drops it — a client reopened
  minutes or hours later gets a current token, not the expired one that first
  connected. See *When the server hangs up*.
- **IAM requires `ssl`, refused in `openConnection`.** An IAM token is a bearer
  secret; plaintext would hand it to anyone on the wire. The UI also forces the
  box on, so this is defence in depth, not the only guard.
- **IAM verifies against Amazon's bundled RDS CAs, not the machine's trust
  store.** RDS certificates chain to Amazon's own authorities, which are in
  neither Node/Bun's bundled roots nor a direct socket's OS store — so verified
  TLS fails with `unable to get local issuer certificate` without them.
  `rds-global-bundle.pem` (Amazon's published bundle) is committed and folded into
  the binary as text, and `drivers/common.ts::tlsOptions` makes it the `ca` for an IAM
  connection while leaving `rejectUnauthorized` on. A password connection keeps
  the OS trust store — only IAM, whose target is known to be RDS, gets the bundle.
  See `docs/decisions.md`.
- **An expired SSO session is rewritten, not passed through.** `mapAwsError` turns
  the SDK's credentials failure into a message naming both the connect form's
  *Sign in to AWS* button and `aws sso login --profile X`, so a lapsed session
  reads as "log in again" rather than as the database rejecting the connection.
  Because the first client opens eagerly, it lands as a failed *Connect*.
  Detection is best-effort on the SDK's error name and text.
- **`aws.credentialStatus` answers the question before the connect asks it.**
  `credentialStatus` resolves the profile through the same `fromIni` the token
  mint uses and stops there — no database socket, so a "no" costs a beat and
  reveals nothing. It **resolves rather than rejecting**, because not being
  signed in is an answer and not a failure of the asking; a rejection would be
  indistinguishable at the call site from the connect failure it exists to
  pre-empt. `signInHelps` is the only field the UI acts on rather than prints,
  and it is false for exactly one kind — a profile that is not in the config,
  which no login creates. `awsFailureKind` is that classification, split out of
  `mapAwsError` because two callers need the answer and not the sentence.
- **`aws.ssoLogin` runs the user's own AWS CLI**, so the fix for that message is
  a button rather than a terminal. `ssoLogin` (in `iam.ts`) spawns
  `aws sso login --profile <profile>`, which writes the SSO token cache — the
  same cache `fromIni` above then reads. It shells out rather than implementing
  the OIDC device flow here precisely because that cache is the CLI's: a second
  writer of it would have to keep agreeing with the first forever. A missing CLI
  is reported as a missing CLI; anything else is the CLI's own last few lines of
  output. A 5-minute ceiling kills a login nobody is going to finish, and killing
  one writes nothing. See `docs/decisions.md`.
- **Its stdout is read line by line while it runs, not collected until it exits.**
  The CLI performs *device authorization*: it prints a verification URL and a
  user code, tries to open a browser, and polls until someone approves them. Those
  two lines are the entire interaction and the only recourse when the browser does
  not open — so they are broadcast as they arrive (`AWS_SSO_PROMPT_EVENT`) rather
  than sitting in a pipe until the command is over, which is exactly when they
  stop being useful. `readPrompts` reports the URL as soon as it has it and again
  once the code follows a line or two later.
- **The last line has no newline while the CLI waits.** The code is the final
  thing printed and its newline only arrives when the login completes, so a reader
  that only handles terminated lines never sees it. `readPrompts` therefore
  flushes whatever is left when the stream ends *and* buffers partial lines across
  chunk boundaries — `iam.test.ts` pins both, down to one byte per chunk.
- **On macOS, the spawn's `PATH` comes from a login shell, not from what the app
  inherited.** A GUI app opened from Finder or the Dock is a child of launchd,
  whose `PATH` lacks whatever `~/.zprofile` adds — including, commonly, the
  directory Homebrew installed `aws` into — so a CLI that works from Terminal
  reads as "not found" from the app. `loginShellPath` asks `$SHELL -l -c` for its
  `PATH` and merges it into the env `aws` spawns with; `aws` itself still runs
  directly, not through the shell, so `readPrompts` keeps reading its stdout
  rather than a wrapper's. Windows and Linux don't have this split and are left
  alone. See `docs/decisions.md`.
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
tables: `workspaces` (id, name, icon) and `saved_connections`, which references
it `ON DELETE CASCADE`. `icon` is an id the extension carries and never reads —
the UI resolves it to a drawing. The colour that used to live on the workspace
now lives on each connection instead (`saved_connections.color`) — see
*Every connection has a colour; a workspace has none* in `docs/frontend.md`.

The rules that hold the grouping together:

- **There is always at least one workspace.** A connection hangs off one, so a
  store with none has nowhere to put a connection. `ensureDefaultWorkspace`
  creates `Default` when the table is empty, and `deleteWorkspace` refuses the
  last one rather than letting the app reach that state and recover from it.
- **A connection's name is not unique anywhere**, and nothing checks it. It is a
  label; `id` is the key. Two rows in one workspace may honestly be the same
  server twice — a reader and a writer, a replica and its primary — and the UI
  tells them apart by colour and by the server each one names. A *workspace's*
  name is still unique, because that one is how the picker addresses it. See
  `docs/decisions.md`, and `connection-names-not-unique` for what dropping the
  constraint cost.
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

### Environments

`environments` (id, name, position) is the picklist `ConnectionForm`'s
"Environment" select offers and `SavedConnectionList` groups by, managed from
the File menu's screen — `listEnvironments`/`addEnvironment`/`deleteEnvironment`,
add and remove only, no rename. It seeds the same four names the app always
shipped (`local`, `dev`, `qa`, `production`), and `ensureDefaultEnvironments`
is the same safety net `ensureDefaultWorkspace` is for a table some other path
left empty.

**It carries no relationship to `saved_connections.environment` at all** — that
column stays the bare TEXT it always was, holding the name directly rather than
this table's `id`. That is deliberate, not an oversight: the point of "removed
from the list" is that a name stops being *offered*, never that it stops having
been true of a connection already using it, and a foreign key would make the
second the price of the first. `deleteEnvironment` therefore never touches
`saved_connections` — there is nothing there naming this table for it to orphan.

**The last environment cannot be deleted**, the same guard and the same reason
as the last workspace: the connect form needs at least one to offer a new
connection. `position` is append-only — a new environment gets
`MAX(position) + 1` and nothing here ever reorders one, since there is no
feature that asks to.

See `docs/decisions.md` for why display shows exactly what is stored (no
capitalising, no abbreviating) and why that cost the rail's old two-letter tag.

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

`tree.syncWithTab` and `keybindings` are what is written there today. Settings
live here rather than in the webview for the store's own reason — see
`docs/decisions.md`.

### Carrying it to another machine (`transfer.ts`)

`db.saved.export` writes every workspace and every connection to a JSON file;
`db.saved.import` reads one back and merges it. **The extension writes and reads
the file itself**, which is the one decision here and looks like a violation of
the "can the webview do this?" test: it plainly can write a file. The password is
why it does not — with `includePasswords` the document holds secrets in the
clear, and *the password never travels toward the UI* is the rule the whole store
is built on. So the webview owns the dialogs that name the file (`showSaveDialog`
/ `showOpenDialog`, its own APIs) and this side owns its contents: a path crosses
in, a tally crosses back, the document never does.

The file is `{ squealConnections: 1, exportedAt, includesPasswords, workspaces,
connections }`, and the shape is written down in `transfer.ts` and nowhere else —
**not** in `shared/protocol/`, because the UI never sees a document, the same
reason a session snapshot is an opaque string there. `squealConnections` both
identifies the file as ours and versions it: absent means not ours, higher than
this reader means written by a newer Squeal, and both are refused in words rather
than half-read. `includesPasswords` states what is *in* the file, so an export
asked for passwords that found none says false.

Five rules, and the first is the whole of what "merge" means:

- **Identity is the exported id.** A connection or workspace the store already
  has is written over in place, so importing the same file twice reports every
  connection *updated* and none added — and a row updated in place keeps the
  stars and the session already filed under its id. Nothing is ever deleted: a
  connection this store has and the file does not is left exactly where it is.
- **A workspace is matched by id, then by name.** Name is the one thing that
  table is unique on, so a `Work` workspace made on another machine — same name,
  an id this store has never seen — merges into the existing one instead of
  failing the constraint. A file naming one workspace twice merges within itself
  the same way, or it would fail its own UNIQUE. One that is already here is used
  as it stands and **never renamed**: a rename could collide with a third
  workspace's name and take the whole import with it.
- **A password the file does not carry leaves the stored one alone.**
  `writeConnection`'s `keepExistingPassword` is a `COALESCE(excluded.password,
  saved_connections.password)` in the `DO UPDATE`, so a passwordless export
  re-imported over its own store cannot silently clear the secrets it left
  behind. A connection that ends up with none simply prompts at connect, which is
  the prompt an unstored password already gets.
- **The whole file lands or none of it does.** One transaction, so a document
  that turns out to be wrong halfway through leaves the store as it found it.
  The passwords are encrypted *before* it opens: the key is behind an `await` and
  a `bun:sqlite` transaction is synchronous.
- **A connection claiming an engine this build cannot drive is refused.**
  `KNOWN_ENGINES` is a `Record<EngineType, true>`, so adding an engine to the
  protocol stops `transfer.ts` compiling until it is named — an unknown engine
  would otherwise save perfectly well and fail much later, at connect, saying
  nothing about where the row came from. An unknown *icon* or *colour* is not
  refused: those are ids this side carries and never reads, so a strange one
  costs a glyph, and an absent one takes the store's own default.

`writeConnection` is the single `INSERT ... ON CONFLICT` both writers of
`saved_connections` go through, for the reason `MIGRATIONS` owns the schema: a
column added to the save path and forgotten by the import path is two answers to
what a connection is.

Passwords leaving for a plain-text file is the one thing here with **no other
trace** — the dialog is dismissed and the store looks untouched — so it is the
export's one log line, counts only, no path and no names, per the `log.ts` rule.

### Saved queries

`saved_queries` (id, name, sql) is the one table in this file that **references
nothing**. Stars and session snapshots hang off `saved_connections` because a
star names a relation on one server; a query is text, and the same text is worth
running against a dev box and a replica alike — so filing it under a connection
would mean saving it twice to use it twice. Nothing here is keyed by a
connection, nothing is cleared when one closes, and `queries.list` takes no
argument.

**The command names drop the `db.` prefix**, the same call `settings.*` makes and
for the same reason: it is about nobody's server. The store keeps the SQL as
text and never parses it, which is the settings rule again — this side has no
opinion about what a query says, only that it was kept.

**`name` is `UNIQUE`, and the clash is checked rather than left to the
constraint.** That is the *workspace's* rule, not the connection's: the picker
addresses a query by its name and has nothing else to tell two apart with, while
two connections called `api` are honestly two servers and are told apart by
colour and address. `saveWorkspace`'s reason applies to the check too — a raw
SQLite error names a column and tells the user nothing about what to type
instead.

**`queries.save` takes an optional `id`, and that is the whole of what makes
Ctrl+S mean *save*** rather than *save another copy*: an editor tab carries the
id of the query it was opened from and writes back through it. Two refusals
follow from it, and the second is the one that looks like helpfulness:

- A name another row already holds, so a second query nothing can tell apart is
  never filed.
- An `id` that no longer names a row. Re-creating the query under its old id
  would undo a deliberate delete — a tab can outlive the query it came from, and
  the honest reading of that is *this tab is unsaved again*, which is what the UI
  does with the refusal. See `docs/frontend.md`.

The clash check excludes the row being written (`id IS NOT ?`), or saving a query
over itself would refuse it for colliding with itself.

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

### Assistant conversations

`conversations` (id, title, updated_at, body) keeps the assistant's threads, so
one can be reopened after a quit. It is the **second table here that references
nothing**, and for a sharper version of `saved_queries`' reason: a conversation
may name three connections over its life, or none, so filing it under one would
be filing it under whichever server it happened to mention first — and deleting
that connection would then take the transcript with it.

**The commands are `conversations.*`, not `ai.*`**, and the split is where the
work is: `assistant.ts` owns the provider — the key, the catalog, one turn — and
none of it is involved in reading a transcript back. A stored thread is text on
disk about nobody's server, which is the category `queries.*` and `settings.*`
are already in.

`body` is opaque, the `connection_sessions` rule again. What is *not* opaque is
`title` and `updated_at`, and that is the one deliberate departure from it: the
picker names a conversation and orders the list by them, and parsing every
transcript on disk to draw a dozen rows is exactly what a column costs nothing
to avoid.

Four rules:

- **`conversations.list` answers without bodies**, where `settings.list` and
  `queries.list` answer with everything. The shape of the data decides, not a
  convention: a setting is a short string and a saved query is one statement,
  while a transcript carries the schema dumps and DDL the model read. `get`
  fetches the one that was picked.
- **The id is the caller's**, unlike `queries.save`'s, which the store mints. A
  thread is written on a debounce *while it is still being had*, so an id the UI
  did not hold yet would make the first two saves of one conversation two rows.
- **`updated_at` is answered, not sent**, and `conversations.save` answers with
  it rather than `{ ok: true }`. It is what the list is ordered by, so one clock
  deciding it is what stops two saves a second apart from being ordered by
  whichever side was asked — and returning it is what lets the UI keep its
  picker current without re-reading the list after every exchange. Epoch
  **milliseconds** here, unlike a migration's seconds: this one is compared,
  never printed as a version.
- **`get` answers `null` for an id no row holds**, rather than throwing. A tab
  can outlive the conversation it was reopened from, deleted from the picker
  while the tab sat behind it, and "there is nothing there" is a state the panel
  draws — `ai.status`'s rule, one table over.

**Nothing here knows about the redaction, and that is deliberate.** The rule that
an attached result is written down as its shape and never as its values is
enforced where the values are, in the webview, before the body is handed over —
see `docs/frontend.md`. This side stores the text it is given, the same way it
stores a session snapshot without knowing what a tab is.

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

`dataDir()` is exported for two callers: `app.dataDir`, which the About menu's
*Open app data* asks for and then hands to `Neutralino.os.open`, and `log.ts`,
which writes its file into the same folder — so the folder the About menu already
opens is also where the log lands, with nothing new for a user to be told about.
The webview opens the folder perfectly well — the only thing it lacks is the path,
and the path is a per-platform rule that belongs beside the database it names.
This is the mirror of `window.matchFrame` rather than another instance of it:
there the extension makes a call the webview cannot, here it only answers
*where*. An extension that shelled out to a file manager itself would be a second
answer to a question the webview already has an API for.

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
  1785067675-environments.ts            the environment picklist, seeded with the four
                                        names `saved_connections.environment` already held
  1785360179-connection-names-not-unique.ts
  1785428731-saved-queries.ts           named statements, referencing nothing
  1786107358-conversations.ts           the assistant's threads, referencing nothing either
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

- **A rebuild must reconcile a column's declared shape with the values actually
  in it.** The list says what a store's schema *should* be; what is on someone's
  disk can differ, and a rebuild is the only statement that reads every row and
  writes it back under a new constraint — so it is where the difference surfaces,
  and it surfaces as a migration that throws on launch and takes every migration
  after it down with it, forever. Found for real: `connection-colour` declares
  `color TEXT NOT NULL DEFAULT 'slate'` and stores exist whose column is a bare
  nullable `TEXT` holding NULLs. `SELECT color` then inserts an explicit NULL,
  which **bypasses the default rather than falling back to it**, and fails the
  rebuilt table's NOT NULL. `connection-names-not-unique` therefore writes
  `COALESCE(color, 'slate')`. The symptom is never about the column: it is
  whatever the *next* migration was going to add, quietly missing — which is how
  this was found, as a `no such table: saved_queries` weeks after the fact.

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
here, the same reason connections and the frame paint do. Windows and macOS
only; `update.check` reports `supported: false` everywhere else and returns
before it reaches the network. That guard is load-bearing, not a formality:
`INSTALLER_PATTERNS` is what names the asset a platform can even use, and a
platform that got past it with no entry would verify another OS' installer and
then try to run it. The UI reads `supported` and says so — a platform with no
update path is a third answer, not a failed check.

**The two platforms do not share an asset or a checksums file.** Windows takes
`squeal-editor-v*.exe` against `SHA256SUMS`; macOS takes
`squeal-editor-macos-arm64-v*.dmg` against `SHA256SUMS-macos`, its own file so
that CI leg — running on its own runner, in parallel — can never race the
other's upload and clobber it.

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
- **`update.apply`** hands the swap to something that outlives the app, which is
  a different thing per platform. **Windows** launches the staged installer
  detached (`cmd /c start`) with `/SILENT /CLOSEAPPLICATIONS
  /RESTARTAPPLICATIONS`; Inno's Restart Manager closes this app and its extension,
  swaps every file, and relaunches. **macOS** has no installer to hand it to, so
  `applyUpdateDarwin` *is* the installer: a detached `/bin/sh` script that waits
  for the app to exit, mounts the .dmg, `ditto`s the new `Squeal Editor.app` over
  the running bundle — found by walking up from `process.execPath`, so it works
  wherever the user put the app — and reopens it. The UI calls `app.exit()` once
  this returns, on both.

  **Four things about that script are load-bearing, because nobody can watch it
  run.** The process that would have reported a failure is the one being
  replaced, so each of these fails silently by default:

  - It is spawned through `nohup … &`, orphaned onto launchd before the app goes
    away. A plain child stays in the app's own process group and dies with
    anything that signals the group.
  - It `cd /` first. The extension's working directory is the bundle's
    `Contents/Resources` (the launcher shim puts it there), which the `rm -rf`
    is about to delete out from under the running script.
  - Waiting for the app to exit is a **preflight, not a delay**: if the app is
    still alive when the wait runs out, the swap is abandoned rather than
    performed underneath it. Deleting a live app's bundle is how an update ends
    with nothing left running.
  - `open` is retried, then falls back to executing the bundle's launcher
    directly. LaunchServices can refuse a bundle replaced at a path it still
    holds a record for, and a refusal there is the difference between an update
    and a machine with no app on it.

  The whole run is traced to **`update.log` in `dataDir()`** — the directory the
  About menu's *Open app data* already opens — truncated per attempt, so it
  always describes the last one. It is the only evidence an update that stopped
  halfway leaves behind.

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

## Logging (`log.ts`)

Most of what the extension does never comes back over the bridge — a dropped
connection, a migration running, a query that was slow rather than wrong — so
`log.ts` gives it a destination: `info`/`warn`/`error`, each line timestamped, written
to `squeal-ext.log` in `dataDir()` (see *Workspaces and saved connections* above)
and mirrored to stderr for a `bun start` dev run. The file is rotated to `.old`
(one generation) once it passes 5MB, so it cannot grow without bound.

**Nothing a database returned may reach it — not a query, not a row, not a
filter value.** The store's encryption exists to keep that data off disk in the
clear; a log holding it would be a second, unencrypted copy sitting beside it.
`db.query`/`db.browse` log only that a query was slow and how slow
(`connectionId`, `database`/`table`, `durationMs`) — never the SQL or the result.
A command's own failure already renders in the UI (the bridge carries the
error back), so handlers do not log on failure; logging is for what has no
other way to surface — connect/disconnect, migrations, the heartbeat giving up,
socket errors, and uncaught exceptions, which is also where the extension's own
shutdown reason now lands instead of a stderr line nothing was reading.

## Lifecycle

The extension pings the app every 10s and exits if it goes 30s without a
response. This is not belt-and-braces — it is the *only* reliable signal. See
`docs/decisions.md` for why the socket cannot be trusted.

Verified both ways: it survives 60s+ of normal use (Neutralino answers pings),
and reaps itself ~25s after the app is hard-killed, releasing its connections.

## The assistant (`assistant.ts`)

The webview owns the agent loop; this file owns the two things it cannot: the
key, and the request. See `docs/frontend.md` for the loop and `docs/decisions.md`
for why the split falls here and why the key is the user's own.

**Four providers, two wire formats.** OpenAI, Gemini and DeepSeek all answer
OpenAI's `/chat/completions` — Gemini through Google's own compatible surface at
`generativelanguage.googleapis.com/v1beta/openai`, which is why it costs no third
translation. Anthropic's `/v1/messages` is its own shape and is translated in
`anthropicBody`. Which format a provider speaks is the *only* thing the split is
about; everything above `send` treats them identically.

Six things are load-bearing:

- **`status()` answers and never throws, and it costs no request.** It is
  `aws.credentialStatus`'s job in this domain and follows its rule for its
  reason: holding no key is an answer, not a failure of the asking. It reads the
  keychain and stops there — a key is not a session that goes stale while nobody
  is looking, so proving one at launch would spend a request on every start to
  learn what the first turn learns anyway.
- **A key is proved once, in `connect`, and a rejected one is not stored.** That
  is the only moment the user is watching a key they just pasted, so it is the
  only moment a bad key can be reported to the person who can fix it. The proof
  is the catalog request, which is a real call to the real provider.
- **A 401 on a turn does not delete the stored key**, unlike a credential minted
  from a sign-in, which should be dropped because the sign-in is what died. This
  one is the *user's* and is re-minted from a console: an organisation-level
  block, a spending cap or a transient refusal would otherwise throw away
  something they have to go and fetch again. The failure is named and the key
  stays.
- **Provider and key are one secret.** A provider id kept anywhere else could
  disagree with the key beside it, and the failure that produces is a working key
  sent to the wrong company.
- **The catalog filter is a *shape* filter, and a filter that matches nothing
  falls back to the unfiltered list.** GitHub's catalog reported tool support per
  model; none of these four do. So `ENDPOINTS` excludes what is obviously not
  chat — embeddings, audio, images — plus `claude-3-opus/sonnet/haiku`, whose
  4096-token output cap would 400 against the `max_tokens` this sends. A model
  that slips through and cannot call a tool fails as a named error on the first
  turn, which is the guarantee that was lost and is worth knowing. The fallback
  exists because the failure mode of a stale pattern is an empty picker nobody
  can diagnose; a bad catalog is recoverable and an empty one is not.
- **The SSE reader buffers partial frames across chunk boundaries**, and it is
  shared by both formats because the framing is the only thing they agree on. It
  is `readPrompts`' problem in `iam.ts` wearing a different protocol: a chunk
  boundary can land mid-frame and mid-UTF8, and a reader that only handles
  complete frames loses whatever straddles one. A frame that will not parse is
  skipped rather than failing the turn.

**Tool calls are assembled from fragments, differently in each format.** OpenAI
keys them by *position* and sends the id on the first fragment only; Anthropic
opens a block with `content_block_start` (which carries the id and the name once)
and then streams its arguments as `input_json_delta` against that block's index.
Both end in the same accumulator.

**Anthropic's translation has three traps and each one is a rejected request.**
System messages are a top-level field rather than turns. A tool result is a
*user* message holding a `tool_result` block, not a role of its own. And roles
must alternate — an assistant turn calling three tools produces three results the
loop appends one at a time, so adjacent same-role turns are coalesced here rather
than trusted to arrive already grouped.

**The `log.ts` rule extends here with one addition**: nothing a *conversation*
holds may be logged either, and neither may the key. A prompt carries the schema,
the user's SQL and whatever result they attached, which is the same data the
store's encryption exists to protect, under a different name.

## Narrowing a table listing

`db.tables` takes an optional `search` and `limit`, and both are the **server's**
work — `Driver.listTables` takes a `TableSearch`, and `tableSearchClause` in
`drivers/common.ts` is the shared assembler beside `buildWhere` and
`orderByClause`, for their reason: three engines each spelling "match the name,
case-insensitively, and stop at N" is three chances to disagree about what a
search means, on a listing the UI treats as interchangeable between engines.

Omitting both is still the unbounded listing, and **nothing in the app asks for
it any more**: the tree, the editor's completion and the assistant all send a
`limit`, and the tree sends a `search` the moment its bar has anything in it. It
stays available because "every relation in this database" is a question the
command should still be able to answer — `db.relationships` is the caller that
means it, by way of its own command. See *A listing is capped, and the search is
how you get past it* in `docs/frontend.md` for the UI's half.

Three rules carried over from elsewhere in this file, each because the same trap
is here:

- **The search value is bound, never interpolated** — `buildWhere`'s rule applied
  to the other place a user's string reaches a catalog query. There is a test
  that `' OR 1=1 --` matches nothing and leaves the table standing.
- **The limit is coerced and interpolated**, because no placeholder carries a
  `LIMIT` on all three engines. It is the page offset's rule and the second place
  in the extension SQL is built this way.
- **`truncated` is answered, not inferred.** The listing asks for `limit + 1` and
  drops the spare — `db.browse`'s `hasMore` rule, and the same trap: a result that
  exactly fills the limit is not evidence there is more.
