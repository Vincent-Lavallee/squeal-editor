import {
    deleteSaved,
    getSession,
    listSaved,
    listStars,
    resolveSaved,
    saveConnection,
    setSession,
    setStar,
} from './store.ts';
import { exportToFile, importFromFile } from './transfer.ts';
import { establish } from './commandsConnectionCore.ts';
import type { Handlers, Send } from './commandTypes.ts';

function commandsSavedCrud(): Pick<
    Handlers,
    'db.saved.list' | 'db.saved.save' | 'db.saved.delete'
> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await -- Handlers requires a Promise; nothing here to await.
        async 'db.saved.list'() {
            return { connections: listSaved() };
        },

        async 'db.saved.save'({
            id,
            workspaceId,
            name,
            config,
            environment,
            readOnly,
            password,
            color,
        }) {
            return {
                connection: await saveConnection({
                    id,
                    workspaceId,
                    name,
                    config,
                    environment,
                    readOnly,
                    password,
                    color,
                }),
            };
        },

        // eslint-disable-next-line @typescript-eslint/require-await
        async 'db.saved.delete'({ id }) {
            deleteSaved(id);
            return { ok: true };
        },
    };
}

function commandsSavedConnectAndFile(
    send: Send,
): Pick<Handlers, 'db.saved.connect' | 'db.saved.export' | 'db.saved.import'> {
    return {
        async 'db.saved.connect'({ id, password }) {
            const {
                config,
                password: secret,
                name,
                environment,
                workspaceId,
                color,
                readOnly,
            } = await resolveSaved(id, password);
            return {
                ...(await establish({ ...config, password: secret }, readOnly, send)),
                config,
                name,
                environment,
                workspaceId,
                color,
                readOnly,
                // What this connection had open last time, for the UI to reopen. The row's
                // own id keys it, not the runtime one just minted -- the session outlives
                // the connection, the same as the stars below.
                session: getSession(id),
            };
        },

        /**
         * The file is written and read here rather than in the webview, and that is
         * the password's doing: with `includePasswords` it holds secrets in the clear,
         * and they may not travel toward the UI to be written up there. The webview
         * owns the dialog that names the file; this side owns its contents.
         */
        async 'db.saved.export'({ path, includePasswords }) {
            return exportToFile(path, includePasswords);
        },

        async 'db.saved.import'({ path }) {
            return importFromFile(path);
        },
    };
}

function commandsSessionsAndStars(): Pick<
    Handlers,
    'db.session.save' | 'db.stars.list' | 'db.stars.set'
> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async 'db.session.save'({ savedConnectionId, session }) {
            setSession(savedConnectionId, session);
            return { ok: true };
        },

        // eslint-disable-next-line @typescript-eslint/require-await
        async 'db.stars.list'({ savedConnectionId }) {
            return { stars: listStars(savedConnectionId) };
        },

        // eslint-disable-next-line @typescript-eslint/require-await
        async 'db.stars.set'({ savedConnectionId, database, table, schema, starred }) {
            setStar(savedConnectionId, { database, schema, table, starred });
            return { ok: true };
        },
    };
}

export function commandsSaved(
    send: Send,
): Pick<
    Handlers,
    | 'db.saved.list'
    | 'db.saved.save'
    | 'db.saved.delete'
    | 'db.saved.connect'
    | 'db.saved.export'
    | 'db.saved.import'
    | 'db.session.save'
    | 'db.stars.list'
    | 'db.stars.set'
> {
    return {
        ...commandsSavedCrud(),
        ...commandsSavedConnectAndFile(send),
        ...commandsSessionsAndStars(),
    };
}
