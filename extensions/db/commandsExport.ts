import { EXPORT_PROGRESS_EVENT } from '../../shared/protocol/index.ts';
import { getConnection } from './commandsConnectionCore.ts';
import type { Handlers, Send } from './commandTypes.ts';

/**
 * "Export a table": a job the UI can cancel by the id it minted for it, the
 * same `turnId`/`AbortController` shape `assistant.ts` already uses for
 * `ai.send`/`ai.cancel` -- a cancel has to be able to name a job before the
 * command it is cancelling has replied, so the id cannot be minted here.
 */
const inFlight = new Map<string, AbortController>();

/* eslint-disable @typescript-eslint/require-await -- Handlers requires every
   command to return a Promise so the dispatcher can await them uniformly;
   `db.exportCancel` aborts a controller, which is synchronous. */
export function commandsExport(send: Send): Pick<Handlers, 'db.export' | 'db.exportCancel'> {
    return {
        async 'db.export'({
            connectionId,
            database,
            table,
            schema,
            exportId,
            path,
            format,
            includeCreateTable,
        }) {
            const controller = new AbortController();
            inFlight.set(exportId, controller);
            try {
                return await getConnection(connectionId).exportTable(
                    database,
                    { table, schema },
                    {
                        format,
                        path,
                        includeCreateTable,
                        signal: controller.signal,
                        onProgress: (rowsWritten) =>
                            send(EXPORT_PROGRESS_EVENT, { exportId, rowsWritten }),
                    },
                );
            } finally {
                inFlight.delete(exportId);
            }
        },

        async 'db.exportCancel'({ exportId }) {
            inFlight.get(exportId)?.abort();
            return { ok: true };
        },
    };
}
/* eslint-enable @typescript-eslint/require-await */
