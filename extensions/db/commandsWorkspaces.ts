import {
    addEnvironment,
    deleteEnvironment,
    deleteWorkspace,
    listEnvironments,
    listWorkspaces,
    saveWorkspace,
} from './store.ts';
import type { Handlers } from './commandTypes.ts';

/* eslint-disable @typescript-eslint/require-await -- Handlers requires every
   command to return a Promise so the dispatcher can await them uniformly; not
   every handler happens to need one. */
export function commandsWorkspaces(): Pick<
    Handlers,
    | 'db.workspaces.list'
    | 'db.workspaces.save'
    | 'db.workspaces.delete'
    | 'db.environments.list'
    | 'db.environments.add'
    | 'db.environments.remove'
> {
    return {
        /* -- Workspaces (store.ts owns the grouping and the cascade) --------- */

        async 'db.workspaces.list'() {
            return { workspaces: listWorkspaces() };
        },

        async 'db.workspaces.save'({ id, name, icon }) {
            return { workspace: saveWorkspace({ id, name, icon }) };
        },

        async 'db.workspaces.delete'({ id }) {
            deleteWorkspace(id);
            return { ok: true };
        },

        /* -- Environments (store.ts owns the picklist; connections stay text) - */

        async 'db.environments.list'() {
            return { environments: listEnvironments() };
        },

        async 'db.environments.add'({ name }) {
            return { environment: addEnvironment(name) };
        },

        async 'db.environments.remove'({ id }) {
            deleteEnvironment(id);
            return { ok: true };
        },
    };
}
/* eslint-enable @typescript-eslint/require-await */
