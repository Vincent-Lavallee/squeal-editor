import type { CellValue } from '../../shared/protocol/index.ts';
import type { Driver, Relation } from './drivers/index.ts';
import type { UseClient } from './connectionState.ts';
import { EXPORT_PAGE_SIZE, type ConnectionHandle } from './connectionTypes.ts';
import { csvRow, insertStatement } from './tableExport.ts';

interface PageArgs<C> {
    use: UseClient<C>;
    driver: Driver<C>;
    database: string;
    qualified: string;
    offset: number;
}

/**
 * One page of the export, run on the connection's client the way `browse`'s
 * page is -- same `LIMIT n+1 OFFSET`/spare-row `hasMore` idiom, just at
 * `EXPORT_PAGE_SIZE` rather than the grid's `PAGE_SIZE`, since nothing here
 * renders a page, only writes one.
 */
async function fetchPage<C>(
    args: PageArgs<C>,
): Promise<{ columns: string[]; rows: CellValue[][]; hasMore: boolean }> {
    const { use, driver, database, qualified, offset } = args;
    const sql = `SELECT * FROM ${qualified} LIMIT ${EXPORT_PAGE_SIZE + 1} OFFSET ${offset};`;
    const outcome = await use(database, (client) => driver.query(client, sql));
    // A plain `SELECT *` always answers the grid arm; the affectedRows arm
    // exists for DML this call never issues.
    if ('affectedRows' in outcome) throw new Error(`${qualified} did not answer a row set.`);

    const hasMore = outcome.rows.length > EXPORT_PAGE_SIZE;
    return {
        columns: outcome.columns,
        rows: hasMore ? outcome.rows.slice(0, EXPORT_PAGE_SIZE) : outcome.rows,
        hasMore,
    };
}

async function writeRow<C>(
    sink: Bun.FileSink,
    row: CellValue[],
    args: { format: 'csv' | 'sql'; qualified: string; columns: string[]; driver: Driver<C> },
): Promise<void> {
    const { format, qualified, columns, driver } = args;
    await sink.write(
        format === 'csv'
            ? csvRow(row)
            : insertStatement({
                  qualifiedTable: qualified,
                  columns,
                  values: row,
                  quoteIdent: (name) => driver.quoteIdent(name),
                  sqlLiteral: (value) => driver.sqlLiteral(value),
              }),
    );
}

/** The `CREATE TABLE` preamble, reusing `db.ddl`'s own `tableDdl` -- see `docs/extension.md`. */
async function writeCreateTablePreamble<C>(
    sink: Bun.FileSink,
    args: { use: UseClient<C>; driver: Driver<C>; database: string; relation: Relation },
): Promise<void> {
    const { use, driver, database, relation } = args;
    const ddl = await use(database, (client) => driver.tableDdl(client, relation, 'table'));
    // Every engine here spells the trailing semicolon (or not) its own way -- see
    // `tableDdl`'s three implementations -- so it is stripped and re-added once
    // rather than trusted, the same `;+\s*$` idiom `connectionQueryMethods.ts`
    // already uses to strip one before wrapping a sorted query.
    await sink.write(`${ddl.trim().replace(/;+\s*$/, '')};\n\n`);
}

export function connectionExportMethods<C>(
    use: UseClient<C>,
    driver: Driver<C>,
): Pick<ConnectionHandle, 'exportTable'> {
    return {
        async exportTable(database, relation, options) {
            const { format, path, includeCreateTable, signal, onProgress } = options;
            const qualified = driver.qualify(relation);
            const sink = Bun.file(path).writer();
            let rowCount = 0;
            let wroteHeader = false;

            try {
                if (format === 'sql' && includeCreateTable) {
                    await writeCreateTablePreamble(sink, { use, driver, database, relation });
                }

                for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
                    const page = await fetchPage({ use, driver, database, qualified, offset });
                    if (format === 'csv' && !wroteHeader) {
                        await sink.write(csvRow(page.columns));
                        wroteHeader = true;
                    }
                    for (const row of page.rows) {
                        await writeRow(sink, row, {
                            format,
                            qualified,
                            columns: page.columns,
                            driver,
                        });
                    }
                    rowCount += page.rows.length;
                    await sink.flush();
                    onProgress(rowCount);

                    if (signal.aborted) return { rowCount, cancelled: true };
                    if (!page.hasMore) return { rowCount, cancelled: false };
                }
            } finally {
                await sink.end();
            }
        },
    };
}
