/**
 * The saved-connection store: named servers on disk, passwords encrypted.
 *
 * Why this lives in the extension and not the webview: encryption is only worth
 * anything if the key is somewhere the ciphertext is not. The webview has no
 * keychain, so a key it held would end up in localStorage right next to the
 * thing it encrypts, which is obfuscation wearing a hat. This process can reach
 * the OS credential store, so it owns the store outright and the UI never
 * receives a password back -- only `hasPassword`.
 *
 * Two Bun builtins do the work, which is why the feature added no dependencies:
 * `bun:sqlite` for the rows and `Bun.secrets` for the key (Credential Manager on
 * Windows, Keychain on macOS, libsecret on Linux).
 *
 * Split by concern: `storeCore.ts` is the SQLite singleton and the row shapes;
 * `storeCrypto.ts` is the password encryption; `storeConnections.ts` is the
 * saved-connection CRUD; `storeImport.ts` merges an exported address book in;
 * `storeWorkspaces.ts`, `storeEnvironments.ts`, `storeSettings.ts`,
 * `storeStars.ts`, `storeQueries.ts`, `storeSessions.ts`, `storeConversations.ts`
 * are each the one table they name.
 */

import { closeCoreStore, dataDir, open } from './storeCore.ts';
import { resetEncryptionKey } from './storeCrypto.ts';

export { dataDir, open };
export {
    findRow,
    listSaved,
    resolveSaved,
    saveConnection,
    storedPassword,
    toSaved,
    deleteSaved,
    writeConnection,
    type SaveInput,
} from './storeConnections.ts';
export {
    importAddressBook,
    type ImportedConnection,
    type ImportedWorkspace,
} from './storeImport.ts';
export { addEnvironment, deleteEnvironment, listEnvironments } from './storeEnvironments.ts';
export {
    deleteWorkspace,
    listWorkspaces,
    saveWorkspace,
    type WorkspaceInput,
} from './storeWorkspaces.ts';
export { listSettings, setSetting } from './storeSettings.ts';
export { listStars, setStar, type SetStarArgs, type StarredTable } from './storeStars.ts';
export { deleteQuery, listQueries, saveQuery, type SavedQuery } from './storeQueries.ts';
export { getSession, setSession } from './storeSessions.ts';
export {
    deleteConversation,
    getConversation,
    listConversations,
    saveConversation,
} from './storeConversations.ts';

/** Tests only: the store is a process-lifetime singleton in the app itself. */
export function closeStore(): void {
    closeCoreStore();
    resetEncryptionKey();
}
