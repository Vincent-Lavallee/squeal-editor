import {
    dataDir,
    deleteConversation,
    deleteQuery,
    getConversation,
    listConversations,
    listQueries,
    listSettings,
    saveConversation,
    saveQuery,
    setSetting,
} from './store.ts';
import type { Handlers } from './commandTypes.ts';

/* eslint-disable @typescript-eslint/require-await -- Handlers requires every
   command to return a Promise so the dispatcher can await them uniformly; not
   every handler happens to need one. */
export function commandsMisc(): Pick<
    Handlers,
    | 'queries.list'
    | 'queries.save'
    | 'queries.delete'
    | 'conversations.list'
    | 'conversations.get'
    | 'conversations.save'
    | 'conversations.delete'
    | 'settings.list'
    | 'settings.set'
    | 'app.dataDir'
> {
    return {
        /* -- Saved queries (the same store, and about no connection either) --- */

        async 'queries.list'() {
            return { queries: listQueries() };
        },

        async 'queries.save'({ id, name, sql }) {
            return { query: saveQuery({ id, name, sql }) };
        },

        async 'queries.delete'({ id }) {
            deleteQuery(id);
            return { ok: true };
        },

        /* -- Assistant conversations (the store, not the provider) ------------ */

        async 'conversations.list'() {
            return { conversations: listConversations() };
        },

        async 'conversations.get'({ id }) {
            return { conversation: getConversation(id) };
        },

        async 'conversations.save'({ id, title, body }) {
            return { updatedAt: saveConversation({ id, title, body }) };
        },

        async 'conversations.delete'({ id }) {
            deleteConversation(id);
            return { ok: true };
        },

        /* -- User settings (the same store, and about no connection) ---------- */

        async 'settings.list'() {
            return { settings: listSettings() };
        },

        async 'settings.set'({ key, value }) {
            setSetting(key, value);
            return { ok: true };
        },

        /* -- The app itself -------------------------------------------------- */

        async 'app.dataDir'() {
            return { path: dataDir() };
        },
    };
}
/* eslint-enable @typescript-eslint/require-await */
