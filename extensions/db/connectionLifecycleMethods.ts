import type { Driver } from './drivers/index.ts';
import type { ConnectionState } from './connectionState.ts';
import type { ConnectionHandle } from './connectionTypes.ts';

/**
 * How long a polite close may take before the socket is taken from under it.
 *
 * `closeClient` waits for the server to acknowledge the goodbye, and a server
 * that has already gone never will -- so *Disconnect* would sit there until TCP
 * gave up, minutes later, on a connection the user has already finished with.
 * Long enough that a healthy server always wins the race, short enough that a
 * dead one is not a wait anybody notices.
 */
const CLOSE_TIMEOUT_MS = 2_000;

export function connectionLifecycleMethods<C>(
    state: ConnectionState<C>,
    driver: Driver<C>,
): Pick<ConnectionHandle, 'setReadOnly' | 'close'> {
    return {
        async setReadOnly(value) {
            // Remember first, so a client created mid-flight by a racing query already
            // reads the new mode in `getClient`, then bring the open ones into line.
            state.readOnly = value;
            await Promise.all(
                [...state.clients.values()].map((client) => driver.setReadOnly(client, value)),
            );
        },

        /**
         * Tear the connection down without waiting on a server that may be gone.
         *
         * The map is cleared first, which is what tells the `onClientLost` handlers
         * above that these endings are ours and not a drop worth reporting.
         *
         * Each client then gets `CLOSE_TIMEOUT_MS` to say goodbye properly and is
         * hung up on if it does not. Waiting indefinitely is what made *Disconnect*
         * from a dropped connection sit for a minute and then fail: a half-open
         * socket has nobody left to answer the goodbye, and neither library gives up
         * before TCP does.
         */
        async close() {
            const open = [...state.clients.values()];
            state.clients.clear();
            await Promise.all(
                open.map(async (client) => {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    const hangUp = new Promise<void>((resolve) => {
                        timer = setTimeout(() => {
                            try {
                                driver.destroyClient(client);
                            } catch {
                                // Nothing left to do for a socket that will not even be dropped.
                            }
                            resolve();
                        }, CLOSE_TIMEOUT_MS);
                    });
                    try {
                        await Promise.race([driver.closeClient(client), hangUp]);
                    } catch {
                        // Already-dead sockets are fine to ignore; we're tearing down anyway.
                    } finally {
                        clearTimeout(timer);
                    }
                }),
            );
        },
    };
}
