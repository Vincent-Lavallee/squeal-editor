import type { ConnectionConfig } from '../../shared/protocol/index.ts';
import { withDriver, type Driver } from './drivers/index.ts';
import { connectionCatalogMethods } from './connectionCatalogMethods.ts';
import { connectionLifecycleMethods } from './connectionLifecycleMethods.ts';
import { connectionQueryMethods } from './connectionQueryMethods.ts';
import { useClient, type ConnectionState } from './connectionState.ts';
import {
    PAGE_SIZE,
    type ConnectionHandle,
    type ConnectionLifecycle,
    type TableRows,
} from './connectionTypes.ts';
import { connectionWriteMethods } from './connectionWriteMethods.ts';

export { PAGE_SIZE, type ConnectionHandle, type ConnectionLifecycle, type TableRows };

/**
 * Opens a connection and verifies it immediately, so bad credentials surface as
 * a failed "Connect" rather than later as a mystery error in the tree.
 *
 * `readOnly` is seeded before the eager `listDatabases()` forces the first client
 * open, so a connection asked to be read-only is never briefly writable.
 */
export async function openConnection(
    config: ConnectionConfig,
    readOnly: boolean,
    onProgress?: (phase: 'iam-token' | 'connecting' | 'verifying') => void,
    onLifecycle?: ConnectionLifecycle,
): Promise<ConnectionHandle> {
    // An IAM token is a bearer secret; sending it in the clear would hand it to
    // anyone on the wire. Refused here as well as in the UI, so the extension is
    // never the thing that lets an unencrypted IAM connection through.
    if (config.iam && !config.ssl) {
        throw new Error('AWS IAM authentication requires SSL. Enable SSL on this connection.');
    }
    const handle = withDriver(config.type, (driver) =>
        build(driver, { config, initialReadOnly: readOnly, onProgress, onLifecycle }),
    );
    // Force the default client open now; throws here if the server rejects us.
    onProgress?.('verifying');
    await handle.listDatabases();
    return handle;
}

function build<C>(
    driver: Driver<C>,
    args: {
        config: ConnectionConfig;
        initialReadOnly: boolean;
        onProgress?: (phase: 'iam-token' | 'connecting' | 'verifying') => void;
        onLifecycle?: ConnectionLifecycle;
    },
): ConnectionHandle {
    const { config, initialReadOnly, onProgress, onLifecycle } = args;
    const state: ConnectionState<C> = {
        clients: new Map(),
        readOnly: initialReadOnly,
        lost: false,
    };
    const use = <T>(database: string | undefined, run: (client: C) => Promise<T>) =>
        useClient({ state, driver, config, database, onProgress, onLifecycle, run });

    return {
        config,
        dialect: driver.dialect,
        defaultSchema: driver.defaultSchema,
        get readOnly() {
            return state.readOnly;
        },
        ...connectionCatalogMethods(use, driver, config),
        ...connectionQueryMethods(use, driver),
        ...connectionWriteMethods(use, driver),
        ...connectionLifecycleMethods(state, driver),
    };
}
