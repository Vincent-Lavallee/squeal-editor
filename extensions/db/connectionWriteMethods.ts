import type { Driver } from './drivers/index.ts';
import type { UseClient } from './connectionState.ts';
import type { ConnectionHandle } from './connectionTypes.ts';

export function connectionWriteMethods<C>(
    use: UseClient<C>,
    driver: Driver<C>,
): Pick<ConnectionHandle, 'write'> {
    return {
        async write(database, relation, edits, deletes) {
            return use(database, async (client) => {
                // The identity is recomputed here rather than trusted from the UI: which
                // columns legitimately name a row is the server's fact, and a keyless table
                // has no write to apply. Refused before a transaction is even opened.
                const keyColumns = await driver.rowKey(client, database, relation);
                if (!keyColumns)
                    throw new Error(
                        `${relation.table} has no primary or unique key, so it cannot be edited.`,
                    );

                // Every op must carry all of the key columns, or its WHERE could not target
                // a single row -- a stale grid handing back a partial key is a bug up top,
                // and applying it would risk hitting rows the user never saw.
                for (const op of [...edits, ...deletes]) {
                    const missing = keyColumns.filter((c) => !(c in op.key));
                    if (missing.length > 0)
                        throw new Error(
                            `A row is missing its key column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
                        );
                }

                return driver.applyWrites(client, { relation, keyColumns, edits, deletes });
            });
        },
    };
}
