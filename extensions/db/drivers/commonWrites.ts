import type { CellValue, RowDelete, RowEdit } from '../../../shared/protocol/index.ts';

export interface RunWritesArgs {
    // Already quoted and qualified by the driver's own `qualify`, so this assembler
    // never has to know how either is spelled -- the same shape as the two
    // callbacks below.
    qualified: string;
    keyColumns: string[];
    edits: RowEdit[];
    deletes: RowDelete[];
    quoteIdent: (name: string) => string;
    placeholder: (position: number) => string;
    exec: (sql: string, params: CellValue[]) => Promise<number>;
}

/**
 * Assembles and runs the parameterized `UPDATE`/`DELETE` statements for a batch
 * of edits and deletes, returning the total rows affected.
 *
 * Shared between the engines so the statement assembly and the more-than-one-row
 * guard cannot drift; the two things that differ are callbacks -- how a
 * placeholder is spelled (`?` vs `$n`) and how an affected-row count is read off
 * a result. The transaction around it is the caller's, because `BEGIN`/`COMMIT`
 * runs on the concrete client. Every value in `set` and `key` is bound as a
 * parameter, so the server parses the text and nothing is reformatted.
 */
export async function runWrites(args: RunWritesArgs): Promise<number> {
    const { qualified, keyColumns, edits, deletes, quoteIdent, placeholder, exec } = args;
    const tooMany = (n: number, verb: string) =>
        new Error(
            `${verb} matched ${n} rows where one was expected -- the row's key is not unique.`,
        );

    let affected = 0;
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
    for (const del of deletes) {
        let p = 0;
        const where = keyColumns.map((c) => `${quoteIdent(c)} = ${placeholder(++p)}`).join(' AND ');
        const params: CellValue[] = keyColumns.map((c) => del.key[c] ?? null);
        const n = await exec(`DELETE FROM ${qualified} WHERE ${where}`, params);
        if (n > 1) throw tooMany(n, 'Delete');
        affected += n;
    }
    return affected;
}
