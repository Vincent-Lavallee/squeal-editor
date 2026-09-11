import { randomUUID } from 'node:crypto';

import { open } from './storeCore.ts';

interface ColumnOrderRow {
    columns: string;
}

export interface ColumnOrderKey {
    database: string;
    schema: string | undefined;
    table: string;
}

/** The dragged-to order a saved connection last left one table's grid in, or `null` for one never dragged. */
export function getColumnOrder(connectionId: string, key: ColumnOrderKey): string[] | null {
    const row = open()
        .query(
            'SELECT columns FROM column_order WHERE connection_id = ? AND database = ? AND schema = ? AND table_name = ?',
        )
        .get(connectionId, key.database, key.schema ?? '', key.table) as ColumnOrderRow | null;
    return row ? (JSON.parse(row.columns) as string[]) : null;
}

/** Remember one table's dragged-to order, replacing whatever it held before. */
export function setColumnOrder(connectionId: string, key: ColumnOrderKey, columns: string[]): void {
    open().run(
        `INSERT INTO column_order (id, connection_id, database, schema, table_name, columns)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (connection_id, database, schema, table_name) DO UPDATE SET columns = excluded.columns`,
        [
            randomUUID(),
            connectionId,
            key.database,
            key.schema ?? '',
            key.table,
            JSON.stringify(columns),
        ],
    );
}
