/**
 * What comes back from a server, and what goes back to it.
 *
 * Rows, the catalog's description of them, and the edits the grid stages against
 * a page it browsed. Nothing here knows how a connection was made.
 */

/** Cells arrive JSON-encoded, so drivers flatten exotic types to strings. */
export type CellValue = string | number | boolean | null;

/**
 * A relation in the tree.
 *
 * `name` is the relation's own name and nothing else -- never a `schema.table`
 * display string. The schema is a field beside it because it is a *fact* about
 * where the relation lives, and a fact recovered by splitting a display string on
 * a dot is a guess: a table may legitimately have one in its name, and the split
 * cannot tell that case from a qualified one. Everything that has to address the
 * relation -- browsing it, reading its definition, dropping it -- sends both
 * fields and lets the driver qualify.
 *
 * `schema` is absent for MySQL, whose database *is* its schema and which has no
 * second level to name. It is always present for Postgres, `public` included, so
 * the tree can group by it without asking which case it is looking at.
 */
export interface TableInfo {
  name: string;
  schema?: string;
  kind: 'table' | 'view';
}

/**
 * One relation a saved connection has starred, named the way every relation
 * command already is -- `table` and an optional `schema`, never a joined
 * display string. It travels with `database` because a star is a fact about one
 * relation in one database, not about the table name alone.
 */
export interface StarredTable {
  database: string;
  table: string;
  schema?: string;
}

/**
 * What a foreign-key column points at: the referenced relation and column.
 *
 * Only ever reported for a *single*-column foreign key. A composite key needs
 * every column's value to name one row, and a cell holds exactly one of them --
 * showing a navigable icon on it would filter the related table by a fifth of a
 * key and land on every row that shares that fifth, silently. `null`, not a
 * guess, is this rule's answer for a composite constraint: see `pickForeignKeys`
 * in `drivers/common.ts`.
 */
export interface ForeignKeyRef {
  table: string;
  /** Absent for MySQL, whose database is its schema. */
  schema?: string;
  column: string;
}

/**
 * A column of a table, as the catalog describes it.
 *
 * `dataType` is the engine's *own* rendering of the type -- `varchar(255)` from
 * MySQL, `character varying(255)` from Postgres -- and deliberately not
 * normalised into some neutral vocabulary of ours. Two reasons, and they are the
 * same two that already keep quoting in the drivers: a normalising table would
 * be a second place that has to know what MySQL means, and the value is only
 * ever *shown*, beside a column name in the editor's completion. Nothing reads
 * it, so carrying it is not knowing it -- the `SqlDialect` rule exactly.
 *
 * `primaryKey` is the one flag here that is a fact about the column and not just
 * its rendering: the tree marks a key column when a table is expanded, and the
 * editable grid needs to know which columns identify a row. Each driver reads it
 * from the catalog beside the type -- `COLUMN_KEY` in MySQL, `pg_index` in
 * Postgres -- so the two never drift on what "primary" means.
 *
 * `foreignKey` is read from the same catalog pass, for the same reason: the tree
 * and the grid both need to know before the grid can offer to follow one.
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey?: ForeignKeyRef;
}

export interface QueryResult {
  columns: string[];
  rows: CellValue[][];
  durationMs: number;
  /** Set instead of columns/rows for statements that return no grid. */
  affectedRows?: number;
  message?: string;
}

/**
 * One page of a table's rows.
 *
 * Browsing is a command of its own rather than a `db.query` the UI wrote,
 * because paging means authoring page N's SQL and only the extension may do
 * that: it knows the engine's quoting, and rewriting a *user's* statement to
 * bolt a LIMIT onto it is how an editor starts lying about what it ran. The UI
 * therefore names a table, never SQL, and steps by `offset`.
 */
export interface TablePage {
  result: QueryResult;
  /** Row offset of the first row here, so the grid can number rows absolutely. */
  offset: number;
  /** Rows per page, authored by the extension. The UI steps by it, never by 100. */
  pageSize: number;
  /**
   * Whether a next page exists, *answered* rather than inferred: the page SQL
   * asks for one row beyond `pageSize` and that row is dropped before it ships.
   * A full page is not evidence of more rows -- a table of exactly `pageSize`
   * rows would claim a page 2 that does not exist -- and `COUNT(*)` is a full
   * scan to answer a question this already answers for free.
   */
  hasMore: boolean;
  /**
   * The columns that identify a row, so the grid can write back to it: the
   * primary key, or a unique index over `NOT NULL` columns when there is no
   * primary key. `null` when the relation has neither -- a view, or a keyless
   * table -- which is what makes the grid read-only and say why. There is no row
   * identity to target, so no `UPDATE`/`DELETE` can name a single row.
   *
   * Computed by the extension, never chosen by the UI: which columns are a
   * legitimate identity is a catalog fact and per-engine to read, the same rule
   * as quoting. The grid only *shows* it and hands the key values back on save.
   */
  keyColumns: string[] | null;
  /**
   * The browsed table's columns as the catalog describes them, in the same order
   * as `result.columns`, so the grid can show each column's type in its header
   * and knows the primary-key columns. `[]` when they could not be read, in which
   * case the grid falls back to the bare names from `result.columns`.
   */
  columnInfo: ColumnInfo[];
}

/**
 * The comparisons a builder row may make.
 *
 * Spelled as the SQL both engines already agree on, so the extension pastes the
 * operator through rather than mapping a vocabulary of ours onto each dialect --
 * the `SqlDialect` rule again. The set is closed on purpose: it is what the
 * extension will author, and anything outside it is what the raw clause is for.
 *
 * `IS NULL` and `IS NOT NULL` take no value, and `IN` takes a comma-separated
 * list that becomes one bound parameter per item.
 */
export type FilterOperator =
  | '='
  | '<>'
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'IN'
  | 'IS NULL'
  | 'IS NOT NULL';

/** One builder row: a column, a comparison, and the text to compare against. */
export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  /** Ignored for `IS NULL`/`IS NOT NULL`; split on commas for `IN`. */
  value: string;
}

/**
 * How a browsed page is narrowed, in one of two forms the user chooses between.
 *
 * **`builder`** is the structured form: the column is quoted per engine, the
 * operator comes from the closed set above, and every value is *bound as a
 * parameter*. Nothing the user types reaches the SQL as text, so this is value
 * handling on the filter path -- a BIGINT compares exactly and a date string is
 * the server's to parse, never a JS `Date`.
 *
 * `conjunction` joins every condition, rather than each row picking its own.
 * Mixed `AND`/`OR` without parentheses is ambiguous to read and precedence-bound
 * to `AND` in a way nobody predicts from the UI, so the builder stays
 * unambiguous and mixed logic is exactly what `raw` is for.
 *
 * **`raw`** is the user's own `WHERE` text, interpolated as typed. That is the
 * same category as the SQL they write in the editor -- their statement, not the
 * UI authoring one -- and it is the escape hatch for what the closed operator
 * set cannot say (date arithmetic, functions, parenthesised groups, subqueries).
 * It carries no parameters by construction: there is no structure to bind.
 */
export type TableFilter =
  | { kind: 'builder'; conjunction: 'AND' | 'OR'; conditions: FilterCondition[] }
  | { kind: 'raw'; where: string };

/**
 * The one column a result is ordered by, and which way.
 *
 * One column rather than a list: the gesture that sets it is a click on a header,
 * and a second click has to mean *this* column now — a growing sort list needs a
 * modifier nobody discovers and a chip row to show what it accumulated. Clicking
 * a different header replaces this outright.
 *
 * `column` is a name out of `QueryResult.columns` — the header the user clicked,
 * which is the name the result actually answers under. The extension quotes it
 * per engine and never interpolates it bare; `direction` is a closed set for the
 * reason `FilterOperator` is one, since it reaches the SQL as text.
 */
export interface SortOrder {
  column: string;
  direction: 'asc' | 'desc';
}

/**
 * One row's edit, staged in the grid and issued on Save.
 *
 * `key` is the row's identifying values *as they were browsed* -- the columns in
 * `TablePage.keyColumns` -- so the extension can target exactly that row even
 * when the edit changes a key column itself (the `WHERE` uses `key`, the `SET`
 * uses `set`). `set` is column -> new value; a `string` goes to the server as
 * text for it to parse, and `null` is SQL NULL, distinct from the empty string.
 * Never a `Date` or a `Number` -- the write side of "show what the server sent".
 */
export interface RowEdit {
  key: Record<string, CellValue>;
  set: Record<string, CellValue>;
}

/** One row's deletion, targeted by its identifying values -- see `RowEdit.key`. */
export interface RowDelete {
  key: Record<string, CellValue>;
}

/** A trigger in the tree, nested under its table. */
export interface TriggerInfo {
  name: string;
  /** Schema for Postgres; absent for MySQL/SQLite. */
  schema?: string;
}

/** A function or stored procedure in the tree, at the top level. */
export interface FunctionInfo {
  name: string;
  /** Schema for Postgres; absent for MySQL. SQLite has no functions. */
  schema?: string;
  /** 'function' or 'procedure' for Postgres; 'function' for MySQL. */
  kind: 'function' | 'procedure';
}
