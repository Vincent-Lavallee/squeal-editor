/**
 * "Export a table": the pure text-formatting half. No I/O and no engine
 * dispatch lives here -- `connectionExportMethods.ts` is what pages a table
 * and writes what these functions return, and `Driver.sqlLiteral`/
 * `Driver.quoteIdent` are the per-engine callbacks that keep this file itself
 * engine-neutral, the same shape `buildWhere`/`runWrites` already use.
 */

import type { CellValue } from '../../shared/protocol/index.ts';

/**
 * One CSV row, RFC 4180: a field is quoted only when it needs to be (holds a
 * comma, a quote or a newline), with an embedded quote doubled. `null` is an
 * empty, unquoted cell -- distinct from the empty string, which quotes itself
 * into `""` so it survives being read back as "present but blank".
 */
export function csvRow(values: CellValue[]): string {
    return `${values.map(csvCell).join(',')}\n`;
}

function csvCell(value: CellValue): string {
    if (value === null) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One `INSERT` statement for a single row, values rendered by the engine's own `sqlLiteral`. */
export function insertStatement(args: {
    qualifiedTable: string;
    columns: string[];
    values: CellValue[];
    quoteIdent: (name: string) => string;
    sqlLiteral: (value: CellValue) => string;
}): string {
    const { qualifiedTable, columns, values, quoteIdent, sqlLiteral } = args;
    const columnList = columns.map(quoteIdent).join(', ');
    const valueList = values.map(sqlLiteral).join(', ');
    return `INSERT INTO ${qualifiedTable} (${columnList}) VALUES (${valueList});\n`;
}
