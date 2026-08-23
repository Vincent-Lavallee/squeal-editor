import type {
    CellValue,
    ColumnInfo,
    ConnectionConfig,
    DiagramTable,
    FunctionInfo,
    RowDelete,
    RowEdit,
    SortOrder,
    SqlDialect,
    TableFilter,
    TableInfo,
} from '../../shared/protocol/index.ts';
import type { QueryOutcome, Relation, TableSearch } from './drivers/index.ts';

/**
 * Rows per page when browsing a table. Lives here because this is where the page
 * shape is defined, and it travels to the UI in the response -- a second copy up
 * there is a number that has to be kept in step with this one.
 */
export const PAGE_SIZE = 100;

/** What an already-open connection can do without being asked -- see `ConnectionState`. */
export type ConnectionLifecycle = (state: 'lost' | 'restored', reason?: string) => void;

/** One page of rows, before the transport times it. */
export interface TableRows {
    columns: string[];
    rows: CellValue[][];
    offset: number;
    pageSize: number;
    hasMore: boolean;
    /** The columns that identify a row, or null when nothing does -- see `rowKey`. */
    keyColumns: string[] | null;
    /** The table's columns as the catalog describes them, for the grid's header. */
    columnInfo: ColumnInfo[];
}

/**
 * A live server connection, with the engine's client type sealed inside.
 * Callers see only this interface, so the registry in main.ts never has to name
 * a mysql2 or pg type -- and never has to reach for `any`.
 */
export interface ConnectionHandle {
    readonly config: ConnectionConfig;
    /** The driver's own answer, so the renderer never derives it from `config.type`. */
    readonly dialect: SqlDialect;
    /** The schema that goes without saying, so the UI can leave it off a name. */
    readonly defaultSchema?: string;
    /** Whether the server is currently refusing writes on this connection. */
    readonly readOnly: boolean;
    /** What the server calls its own version, for `db.test` to report back. */
    serverVersion(): Promise<string>;
    listDatabases(): Promise<string[]>;
    listTables(database: string, search?: TableSearch): Promise<TableInfo[]>;
    listColumns(database: string, relation: Relation): Promise<ColumnInfo[]>;
    /**
     * Every table of a database with its columns and foreign keys, in one call --
     * what the relationship diagram draws. See `Driver.listRelationships`.
     */
    listRelationships(database: string): Promise<DiagramTable[]>;
    /**
     * A table's row identity alone -- the same `Driver.rowKey` call `browse` and
     * `write` already make, asked for without paging or writing anything. Backs
     * `db.tableKey`, which lets a hand-typed query be checked against a table's
     * key without the extension re-authoring the statement the user ran.
     */
    rowKey(database: string, relation: Relation): Promise<string[] | null>;
    /**
     * The user's statement, run as written -- unless `sort` is given, which is the
     * one thing that wraps it. See the implementation for why that wrap is allowed
     * where paging and filtering a query's result are not.
     */
    query(database: string | undefined, sql: string, sort?: SortOrder): Promise<QueryOutcome>;
    /**
     * One page of a table, optionally narrowed by `filter` and ordered by `sort`.
     * A builder filter's values are bound as parameters; a raw one is the user's
     * own `WHERE` text. The sort orders the table before the page is cut from it.
     */
    browse(
        database: string,
        relation: Relation,
        options: { offset: number; filter?: TableFilter; sort?: SortOrder },
    ): Promise<TableRows>;
    /** A relation's `CREATE` statement, for the context menu's "open definition". */
    tableDdl(database: string, relation: Relation, kind: 'table' | 'view'): Promise<string>;
    /** Triggers for a specific table. */
    listTriggers(
        database: string,
        relation: Relation,
    ): Promise<Array<{ name: string; schema?: string }>>;
    /** A trigger's definition. */
    triggerDdl(database: string, relation: Relation, trigger: string): Promise<string>;
    /** Functions and stored procedures in a database. */
    listFunctions(database: string): Promise<FunctionInfo[]>;
    /** A function's or procedure's definition, for the row `listFunctions` reported. */
    functionDdl(database: string, func: FunctionInfo): Promise<string>;
    /** Drop a relation. Not undoable -- the UI guards it behind a typed confirmation. */
    dropRelation(database: string, relation: Relation, kind: 'table' | 'view'): Promise<void>;
    /**
     * Write edited and deleted rows back to a browsed table, as one atomic batch,
     * returning the total rows affected. Refused for a table with no row identity:
     * the key is recomputed here, not taken from the UI, so a keyless table cannot
     * be written even if the caller supplies one. Each op must carry every key
     * column, or it could not target a row.
     */
    write(
        database: string,
        relation: Relation,
        edits: RowEdit[],
        deletes: RowDelete[],
    ): Promise<number>;
    /**
     * Turn read-only on or off across every client this connection holds, and
     * remember it for every client opened afterwards. Both halves matter: one
     * client per database means a toggle that only reached the open ones would be
     * undone the moment the user switched to a database not yet opened.
     */
    setReadOnly(value: boolean): Promise<void>;
    close(): Promise<void>;
}
