import type { CellValue, RowDelete, RowEdit, RowInsert } from '../../../shared/protocol/index.ts';

export interface RunWritesArgs {
    // Already quoted and qualified by the driver's own `qualify`, so this assembler
    // never has to know how either is spelled -- the same shape as the two
    // callbacks below.
    qualified: string;
    keyColumns: string[];
    edits: RowEdit[];
    deletes: RowDelete[];
    inserts: RowInsert[];
    // How this engine spells a row of nothing but defaults: MySQL has no
    // `DEFAULT VALUES`, and an empty column list is a syntax error in the rest.
    allDefaultsRow: string;
    quoteIdent: (name: string) => string;
    placeholder: (position: number) => string;
    exec: (sql: string, params: CellValue[]) => Promise<number>;
}

/**
 * Assembles and runs the parameterized `DELETE`/`UPDATE`/`INSERT` statements for
 * a batch, in that order, returning the total rows affected. Deletes go first so
 * a key they free can be taken by an edit or an insert in the same batch.
 *
 * Shared between the engines so the statement assembly and the more-than-one-row
 * guard cannot drift; the two things that differ are callbacks -- how a
 * placeholder is spelled (`?` vs `$n`) and how an affected-row count is read off
 * a result. The transaction around it is the caller's, because `BEGIN`/`COMMIT`
 * runs on the concrete client. Every value in `set` and `key` is bound as a
 * parameter, so the server parses the text and nothing is reformatted.
 */
export async function runWrites(args: RunWritesArgs): Promise<number> {
    const { qualified, keyColumns, edits, deletes, inserts, allDefaultsRow } = args;
    const { quoteIdent, placeholder, exec } = args;
    const tooMany = (n: number, verb: string) =>
        new Error(
            `${verb} matched ${n} rows where one was expected -- the row's key is not unique.`,
        );

    let affected = 0;
    for (const del of deletes) {
        let p = 0;
        const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
        const params: CellValue[] = keyColumns.map((c) => del.key[c] ?? null);
        const n = await exec(`DELETE FROM ${qualified} WHERE ${where}`, params);
        if (n > 1) throw tooMany(n, 'Delete');
        affected += n;
    }
    for (const edit of edits) {
        const setCols = Object.keys(edit.set);
        // An edit that changes nothing has nothing to issue -- the UI should not send
        // one, but a no-op statement would be `SET  WHERE`, which is a syntax error.
        if (setCols.length === 0) continue;
        let p = 0;
        const set = setCols.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(', ');
        const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
        const params: CellValue[] = [
            ...setCols.map((c) => edit.set[c] ?? null),
            ...keyColumns.map((c) => edit.key[c] ?? null),
        ];
        const n = await exec(`UPDATE ${qualified} SET ${set} WHERE ${where}`, params);
        if (n > 1) throw tooMany(n, 'Edit');
        affected += n;
    }
    for (const insert of inserts) {
        const columns = Object.keys(insert.values);
        if (columns.length === 0) {
            affected += await exec(`INSERT INTO ${qualified} ${allDefaultsRow}`, []);
            continue;
        }
        const names = columns.map((c) => quoteIdent(c)).join(', ');
        const marks = columns.map((_c, i) => placeholder(i + 1)).join(', ');
        const params = columns.map((c) => insert.values[c] ?? null);
        affected += await exec(`INSERT INTO ${qualified} (${names}) VALUES (${marks})`, params);
    }
    return affected;
}
