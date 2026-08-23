/**
 * Database operations: connecting, browsing, running SQL, and DDL. The
 * largest domain in `Commands`, and the one every other section in
 * `commands/` is "not a database" relative to.
 */

import type { ConnectionConfig, ServerConfig, SqlDialect, TestPassword } from '../config.ts';
import type {
    ColumnInfo,
    DiagramTable,
    FunctionInfo,
    QueryResult,
    RowDelete,
    RowEdit,
    SortOrder,
    TableFilter,
    TableInfo,
    TablePage,
    TriggerInfo,
} from '../results.ts';

export interface DbCommands {
    'db.connect': {
        req: { config: ConnectionConfig; readOnly: boolean };
        res: {
            connectionId: string;
            databases: string[];
            dialect: SqlDialect;
            defaultSchema?: string;
        };
    };
    /**
     * Reach a server from values that are still being typed, say what was reached,
     * and let it go again.
     *
     * It is a command of its own rather than a `db.connect` with a flag because it
     * is the opposite of one in the two ways that matter: it answers no
     * `connectionId` -- there is nothing to hold, so nothing can be handed out --
     * and it never touches the store. The connection is opened, asked its version,
     * and closed before this resolves, so a draft that turns out to be wrong leaves
     * no half-made connection behind in the registry or in the list.
     *
     * `serverVersion` is the server's own answer, verbatim, and it is the whole
     * point of a successful test: "connected" only says something answered, while a
     * version says *which* box did. The engine's name is not in it -- the caller
     * already knows which engine it asked for -- for the same reason the extension
     * reports a `dialect` and not a product name.
     *
     * A failure rejects with the server's own message, unchanged, which is what
     * makes the fix-a-field-and-try-again loop worth anything: an expired AWS SSO
     * session says so, and a refused password says that instead.
     */
    'db.test': {
        req: { config: ServerConfig; password: TestPassword };
        res: { serverVersion: string };
    };
    'db.databases': {
        req: { connectionId: string };
        res: { databases: string[] };
    };
    /**
     * A database's relations. `search` narrows and caps them **on the server**,
     * and omitting both is the unbounded listing -- which nothing in the app asks
     * for any more: the tree, the editor's completion and the assistant all send
     * a `limit`, and the tree sends a `search` as soon as its bar has anything in
     * it. See *A listing is capped* in `docs/frontend.md`.
     *
     * Filtering here rather than in the caller is the same rule `db.browse`'s
     * `filter` follows: a database with thousands of tables is expensive to answer
     * and expensive to carry, so a caller that cannot hold the whole catalog must
     * be able to say so before it is assembled -- narrowing what already arrived
     * has paid every cost the narrowing exists to avoid.
     *
     * `truncated` is answered rather than inferred, `db.browse`'s `hasMore` rule
     * again: a result that exactly fills the limit is not evidence there are more.
     */
    'db.tables': {
        req: { connectionId: string; database: string; search?: string; limit?: number };
        res: { tables: TableInfo[]; truncated: boolean };
    };
    /**
     * A table's columns. The editor completes against these; nothing draws them.
     *
     * The UI names a table and never the catalog query, for the same reason
     * `db.browse` exists: the query is per-engine (`information_schema.COLUMNS`
     * against a schema name MySQL calls a database, `pg_attribute` and
     * `format_type` against a Postgres relation), so only this side may write it.
     * The renderer asking "what columns does this table have" and getting an
     * answer is the whole of what it knows.
     *
     * `schema` is the convention every relation command here follows. When the
     * caller holds a `TableInfo` it sends both fields and the driver qualifies from
     * them -- no display string is ever taken apart to recover where a relation
     * lives. It is optional for the one caller that genuinely has only a string:
     * the editor's completion, which scans a name out of SQL *being typed* and has
     * no catalog row behind it. Omitted, a Postgres driver falls back to reading a
     * leading `schema.` off the name, which is the guess this field exists to
     * avoid making anywhere it can be avoided. MySQL ignores the field outright --
     * its database is its schema, and its client is already pinned to one.
     */
    'db.columns': {
        req: { connectionId: string; database: string; table: string; schema?: string };
        res: { columns: ColumnInfo[] };
    };
    /**
     * Every table in a database with its columns and its foreign keys, at once --
     * what the relationship diagram draws.
     *
     * A command of its own rather than `db.tables` plus a `db.columns` per table,
     * because a diagram is about *all* of them simultaneously: a database of two
     * hundred tables would be four hundred round trips before one line could be
     * drawn, and the answer would be assembled from two hundred separately-timed
     * views of a catalog that may have moved in between. Each driver answers this
     * with two catalog reads over the whole database.
     *
     * It is fetched fresh every time the diagram opens and cached nowhere on this
     * side, unlike the tree's tables -- see `loadRelationships` in the UI.
     *
     * **No layout comes back.** Where a node sits is the webview's business and
     * the extension has no opinion about pixels, which is why this is shaped as
     * catalog rather than as a drawing.
     */
    'db.relationships': {
        req: { connectionId: string; database: string };
        res: { tables: DiagramTable[] };
    };
    /**
     * Run the user's statement, exactly as written.
     *
     * `sort` is the one thing that changes that, and it is the single exception to
     * a rule this contract otherwise states everywhere: given one, the extension
     * runs `SELECT * FROM (<sql>) ORDER BY <column> <direction>` instead. It is
     * narrow on purpose, and what makes it narrow is that a wrap of this shape
     * **returns the same rows** -- the statement runs whole, inside, and only the
     * order it comes back in changes. That is what paging and filtering a query's
     * result could not promise (both change *which* rows arrive), which is why
     * those are still refused and this is not.
     *
     * It exists rather than being sorted in the webview because ordering is the
     * server's to decide: a BIGINT arrives as a string and a timestamp as the
     * engine's own text, so a comparator up there would sort `9` after `10` and
     * order dates by their spelling. Sorting client-side is *Value handling* with
     * the sign flipped -- see `docs/decisions.md`.
     */
    'db.query': {
        req: { connectionId: string; database?: string; sql: string; sort?: SortOrder };
        res: QueryResult;
    };
    /**
     * A table's row identity alone -- the same computation `db.browse` and
     * `db.write` already make (`Driver.rowKey`), asked for on its own so a
     * hand-typed query can be checked against it without the extension paging or
     * re-authoring the statement the user actually ran.
     *
     * `db.query` runs the user's SQL as written; it does not carry a table name
     * for this to ride along with the way `db.browse`'s page does, so the UI asks
     * separately once it has scanned the query for the one table its `FROM`
     * names. `null` means the table has no primary or unique key, the same
     * meaning `TablePage.keyColumns` already carries -- there is one answer to
     * "what identifies a row here", computed one way, whichever caller asks.
     */
    'db.tableKey': {
        req: { connectionId: string; database: string; table: string; schema?: string };
        res: { keyColumns: string[] | null };
    };
    /**
     * One page of a table, in the server's natural order. `offset` is the first
     * row wanted; the extension writes the SQL and reports the page size back.
     *
     * `filter` narrows the page with a `WHERE` the extension authors -- which is
     * why filtering exists here and nowhere else. Narrowing a *query's* result
     * would mean wrapping the user's statement, and `db.query` runs what is on
     * screen or the editor is lying about what it ran; this rides on the SQL the
     * extension already wrote, exactly as paging and write-back do.
     *
     * A builder filter's values are bound as parameters and never interpolated. A
     * raw filter is the user's own `WHERE` text, pasted in as typed.
     *
     * `sort` orders the whole table before the page is cut from it, so page 2 of a
     * sorted table is the second page *of that order* -- it is part of the page
     * SQL, never a re-ordering of the hundred rows that came back. Unsorted, the
     * page is still the server's natural order and still not a stable one; a sort
     * is the only way to make paging repeatable, which is a consequence rather
     * than the reason it exists.
     */
    'db.browse': {
        req: {
            connectionId: string;
            database: string;
            table: string;
            schema?: string;
            offset: number;
            filter?: TableFilter;
            sort?: SortOrder;
        };
        res: TablePage;
    };
    /**
     * A relation's `CREATE` statement, for the context menu's "open definition".
     *
     * The UI names a table and a kind and never the catalog query, the same rule
     * as `db.browse` and `db.columns`: reconstructing a faithful `CREATE TABLE` is
     * per-engine (MySQL reads `SHOW CREATE TABLE`; Postgres reassembles it from the
     * catalog with `format_type`, `pg_get_constraintdef` and `pg_get_indexdef`), so
     * only this side may write it. `kind` decides table-vs-view because Postgres
     * takes a different path for each, and the UI already holds it.
     */
    'db.ddl': {
        req: {
            connectionId: string;
            database: string;
            table: string;
            schema?: string;
            kind: 'table' | 'view';
        };
        res: { ddl: string };
    };
    /**
     * Triggers for a specific table.
     *
     * Triggers are per-table in all three engines, so they are fetched by table name.
     * The list is per-table and per-database, never global.
     */
    'db.triggers': {
        req: { connectionId: string; database: string; table: string; schema?: string };
        res: { triggers: TriggerInfo[] };
    };
    /**
     * A trigger's definition, for "open definition" in the tree.
     *
     * The UI names a trigger and its table; the extension queries per-engine.
     */
    'db.triggerDdl': {
        req: {
            connectionId: string;
            database: string;
            table: string;
            trigger: string;
            schema?: string;
        };
        res: { ddl: string };
    };
    /**
     * Functions and stored procedures in the database.
     *
     * Functions and procedures are not scoped to tables, so this is a database-wide list.
     * Only Postgres and MySQL support this; SQLite has no functions.
     */
    'db.functions': {
        req: { connectionId: string; database: string };
        res: { functions: FunctionInfo[] };
    };
    /**
     * A function's or procedure's definition, for "open definition" in the tree.
     *
     * **The whole `db.functions` row travels back, rather than a name and a
     * schema.** Every field of it is load-bearing and none of them can be
     * recovered here: `kind` picks the verb, because MySQL's `SHOW CREATE
     * FUNCTION` throws outright on a name that is actually a procedure
     * (`ER_SP_DOES_NOT_EXIST`), leaving no empty answer to fall back from; and
     * `id` picks the *overload*, which a name and a schema cannot -- see
     * `FunctionInfo`.
     */
    'db.functionDdl': {
        req: { connectionId: string; database: string; func: FunctionInfo };
        res: { ddl: string };
    };
    /**
     * Drop a relation. Guarded up top by a modal that wants the name typed back --
     * the same friction as leaving read-only -- because it is DDL and nothing rolls
     * it back.
     *
     * A driver method rather than a `db.query` the UI wrote, for the reason browse
     * is: `DROP TABLE` and `DROP VIEW` differ, the identifier is quoted per engine,
     * and the UI may not author SQL. No `CASCADE`: the server's default refusal to
     * drop something depended on is the safe answer, surfaced as a failed drop.
     */
    'db.drop': {
        req: {
            connectionId: string;
            database: string;
            table: string;
            schema?: string;
            kind: 'table' | 'view';
        };
        res: { ok: true };
    };
    /**
     * Write edited and deleted rows back to a browsed table, as one atomic batch.
     *
     * Only browse mode reaches here: `db.query` runs the user's statement as
     * written and is never rewritten, so write-back is only offered for rows the
     * extension itself paged and can identify. The extension recomputes the table's
     * key columns and refuses a table with none -- the UI may not choose what
     * identifies a row any more than it may write the SQL.
     *
     * The whole batch runs in a transaction: every edit and delete lands together
     * or none does, and a failure leaves the connection usable, like a failed
     * query. Values in `set` and `key` travel as text and are bound as parameters
     * for the server to parse -- never through a JS `Date` or `Number`.
     */
    'db.write': {
        req: {
            connectionId: string;
            database: string;
            table: string;
            schema?: string;
            edits: RowEdit[];
            deletes: RowDelete[];
        };
        res: { affectedRows: number };
    };
    'db.disconnect': {
        req: { connectionId: string };
        res: { ok: true };
    };
    /**
     * Turn read-only on or off for an open connection.
     *
     * The session is per client and a connection holds one client per database, so
     * the extension applies this to every open client *and* remembers it for every
     * client opened afterwards -- miss the second and switching database quietly
     * makes a read-only connection writable again.
     */
    'db.readonly': {
        req: { connectionId: string; readOnly: boolean };
        res: { ok: true };
    };
}
