/**
 * What comes back from a server, and what goes back to it.
 *
 * Rows, the catalog's description of them, and the edits the grid stages against
 * a page it browsed. Nothing here knows how a connection was made.
 */

/** Cells arrive JSON-encoded, so drivers flatten exotic types to strings. */
export type CellValue = string | number | boolean | null;

export interface TableInfo {
  /** Display name; schema-qualified for Postgres when not in `public`. */
  name: string;
  kind: 'table' | 'view';
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
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  primaryKey: boolean;
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
