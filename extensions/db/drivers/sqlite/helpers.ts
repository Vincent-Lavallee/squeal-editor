import type { Database as SqliteDatabase } from 'bun:sqlite';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import { selectExpressionAt } from '../common.ts';

/**
 * SQLite binds a value the way the other two do, with two shapes it will not
 * take: a boolean (it has no boolean type) and `undefined`. Both arrive here
 * only from the filter builder and the write assembler, where they mean 1/0 and
 * NULL, so they are spelled that way rather than left to throw at the binding.
 */
export const toSqliteParam = (value: CellValue): string | number | bigint | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
};

/**
 * Runs one prepared statement and finalizes it, whatever happens.
 *
 * bun:sqlite is synchronous and its statements hold native handles until they
 * are finalized, so every `prepare` in this driver is paired with one here
 * rather than left for the collector -- a browse that leaked one per page would
 * hold the file open long after the rows were on screen.
 *
 * `safeIntegers` is the *Value handling* rule in this engine's spelling: without
 * it bun:sqlite hands an INTEGER back as a JS number and anything past 2^53 is
 * silently rounded, exactly the mysql2 `supportBigNumbers` case. Unlike mysql2
 * there is no "only when it would not fit" setting, so every integer comes back
 * a bigint and `toDisplayValue` renders it as its own digits. An id shown as
 * text is a cosmetic cost; an id shown as the wrong number is not.
 */
export function withStatement<R>(
    client: SqliteDatabase,
    sql: string,
    use: (stmt: ReturnType<SqliteDatabase['prepare']>) => R,
): R {
    const stmt = client.prepare(sql);
    // bun:sqlite's shipped types omit `safeIntegers`, which is present on Statement
    // at runtime (verified: a 9007199254740993 comes back as a bigint with it and
    // rounds to ...992 without). Narrowed to the one method rather than widening
    // the statement to `any` and losing the rest of its typing.
    (stmt as unknown as { safeIntegers(enabled: boolean): void }).safeIntegers(true);
    try {
        return use(stmt);
    } finally {
        stmt.finalize();
    }
}

/** Every row of a statement this side authored, as arrays. */
export const sqliteRows = (
    client: SqliteDatabase,
    sql: string,
    params: CellValue[] = [],
): unknown[][] =>
    withStatement(client, sql, (stmt) => stmt.values(...params.map(toSqliteParam)) as unknown[][]);

/**
 * One header per column, even when two of them share a name.
 *
 * bun:sqlite's `columnNames` is **deduplicated**: `SELECT 1 AS x, 2 AS x, 3 AS y`
 * answers `['x', 'y']` while the row is three values wide. That is the *Rows as
 * arrays* rule's failure moved up into the header -- the values survive, but a
 * header shorter than its row silently shifts every column after the duplicate
 * under the wrong name, which is worse than an ugly one.
 *
 * So the width comes from `columnTypes` (which is per-position and correct) and
 * a short `columnNames` is rebuilt from the statement's own SELECT list, reusing
 * the positional scan the Postgres driver already leans on for `?column?`. The
 * name it recovers is the expression text (`2 AS x`), not the bare alias --
 * distinguishable and true to what was asked for, which is what the header owes.
 * The `1`-based ordinal is the last resort for a shape the scan cannot read.
 *
 * Only ever called for a statement that returns a grid: `columnTypes` throws on
 * one that does not, which is why the DML branch is taken before this is reached.
 */
// `columnTypes` is only ever measured here, never read, so its element type is
// left open rather than restated.
export function sqliteColumnNames(
    stmt: { columnNames: string[]; columnTypes: unknown[] },
    sql: string,
): string[] {
    const width = stmt.columnTypes.length;
    if (stmt.columnNames.length === width) return stmt.columnNames;
    return Array.from(
        { length: width },
        (_, i) => selectExpressionAt(sql, i) ?? stmt.columnNames[i] ?? String(i + 1),
    );
}
