/**
 * Request/response layer over the Neutralino extension channel.
 *
 * The native bridge is fire-and-forget in both directions: we `dispatch` an
 * event out, and replies arrive later as a broadcast on `db.response`. To get
 * something await-able, each call is tagged with a reqId that the extension
 * echoes back, and this module matches the reply to its pending promise.
 *
 * `call` is typed from the shared Commands map, so a wrong payload or a bad
 * command name is a compile error rather than a silent timeout.
 */

import {
    DB_RESPONSE_EVENT,
    type CommandName,
    type CommandReq,
    type CommandRes,
    type DbResponse,
} from '../../../../shared/protocol/index.ts';

const EXT_ID = 'js.squeal.db';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * How often to check the extension is still there once it has connected once.
 * Mirrors the extension's own heartbeat cadence (`HEARTBEAT_INTERVAL_MS` in
 * `main.ts`) rather than inventing a different rhythm for the same question
 * asked from the other side.
 */
const EXTENSION_WATCHDOG_INTERVAL_MS = 10_000;

/** Same deadline `useWindowChrome`'s `close()` gives `app.exit()` before forcing it. */
const RESTART_FORCE_KILL_MS = 2_000;

/**
 * What every timed-out call rejects with, generically. Exported so a caller
 * that asked for a specific `timeoutMs` -- `runQuery`/`browseTable`, naming a
 * setting the user can raise -- can tell "this is the timeout" apart from any
 * other rejection and say something more useful than this can.
 */
export const TIMEOUT_ERROR_MESSAGE = 'The database did not respond in time.';

interface Pending {
    resolve: (value: never) => void;
    reject: (reason: Error) => void;
    /** Absent when the caller asked for no timeout at all -- see `call`. */
    timer?: ReturnType<typeof setTimeout>;
}

let nextReqId = 1;
const pending = new Map<number, Pending>();
let extensionReady: Promise<void> | null = null;
let intentionalExit = false;

/**
 * Call before this process asks itself to exit on purpose -- the window
 * closing, or the updater handing off to a relaunch it already controls --
 * so `watchExtension` below does not read the extension going away as a
 * surprise and restart the app a second time on top of an exit already in
 * flight.
 */
export function markIntentionalExit(): void {
    intentionalExit = true;
}

function onResponse(evt: CustomEvent): void {
    const detail = evt.detail as DbResponse | undefined;
    if (!detail) return;

    const entry = pending.get(detail.reqId);
    if (!entry) return;

    pending.delete(detail.reqId);
    clearTimeout(entry.timer);

    if (detail.ok) entry.resolve(detail.data as never);
    else entry.reject(new Error(detail.error || 'Unknown database error'));
}

async function waitForExtension(): Promise<void> {
    const stats = await Neutralino.extensions.getStats();
    if (stats.connected.includes(EXT_ID)) return;

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            void Neutralino.events.off('extensionReady', handler);
            reject(new Error('The database extension failed to start. Is Bun on your PATH?'));
        }, 15_000);

        function handler(evt: CustomEvent): void {
            if (evt.detail !== EXT_ID) return;
            clearTimeout(timer);
            void Neutralino.events.off('extensionReady', handler);
            resolve();
        }

        void Neutralino.events.on('extensionReady', handler);
    });
}

/**
 * The extension can exit for reasons entirely outside its control -- the one
 * seen in practice is a socket dropped across sleep/resume overnight -- and
 * every bridge call's own timeout only covers a call already in flight when
 * that happens. Nothing else ever asks "is it still there", so a session left
 * open past the drop would otherwise sit forever with no way back. This is
 * that ask, on the same cadence the extension itself pings the app.
 */
async function watchExtension(): Promise<void> {
    if (intentionalExit) return;
    const stats = await Neutralino.extensions.getStats().catch(() => null);
    if (!stats || intentionalExit || stats.connected.includes(EXT_ID)) return;

    markIntentionalExit();
    void Neutralino.debug
        .log('extension disconnected unexpectedly; restarting the app', 'WARNING')
        .catch(() => undefined);

    try {
        await Neutralino.app.restartProcess();
    } catch (err) {
        // The replacement never got spawned -- `restartProcess` awaits that
        // before it fires its own exit, so a rejection here means this process
        // is still the only one running. Forcing it closed would leave nothing
        // behind, which is worse than a session that outlives this bad attempt.
        void Neutralino.debug
            .log(
                `restartProcess() failed, leaving the app running: ${err instanceof Error ? err.message : String(err)}`,
                'ERROR',
            )
            .catch(() => undefined);
        return;
    }

    // The replacement is already up by this point. `restartProcess` fires its
    // own `app.exit()` without waiting on it, and that native shutdown path is
    // known to go unanswered on some machines -- see `useWindowChrome`'s
    // `close()`, which hit exactly this on a machine where the install
    // directory was read-only. Left alone, that would leave this window
    // running forever alongside the one it just spawned. If exit succeeds,
    // this process is gone before the timer below ever gets to fire; if it
    // does not, the timer is what forces it closed.
    setTimeout(() => {
        void Neutralino.debug
            .log(
                'app.exit() during restart did not complete within 2s; forcing killProcess()',
                'ERROR',
            )
            .catch(() => undefined);
        void Neutralino.app.killProcess();
    }, RESTART_FORCE_KILL_MS);
}

export function initBridge(): void {
    Neutralino.init();
    void Neutralino.events.on(DB_RESPONSE_EVENT, onResponse);
    void Neutralino.events.on('windowClose', () => {
        markIntentionalExit();
        void Neutralino.app.exit();
    });

    // Kicked off once at startup; every call awaits this before dispatching, so
    // queries fired before the extension is up simply wait rather than vanish.
    // The watchdog only starts once that first connection has actually
    // happened -- a startup failure is a different problem, already surfaced
    // by this same promise rejecting.
    extensionReady = waitForExtension();
    void extensionReady.then(() => {
        setInterval(() => void watchExtension(), EXTENSION_WATCHDOG_INTERVAL_MS);
    });
}

export async function call<K extends CommandName>(
    event: K,
    payload: CommandReq<K>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    signal?: AbortSignal,
): Promise<CommandRes<K>> {
    await extensionReady;
    const reqId = nextReqId++;

    return new Promise<CommandRes<K>>((resolve, reject) => {
        const cleanup = () => {
            pending.delete(reqId);
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
            cleanup();
            reject(new Error('Cancelled.'));
        };

        signal?.addEventListener('abort', onAbort, { once: true });

        // `Infinity` is a caller asking for no timeout at all -- a long-running
        // query someone raised the setting for. Skipping the timer rather than
        // handing `setTimeout` an infinite delay matters: a delay that does not
        // fit in a 32-bit int fires almost immediately instead of never, which
        // is the opposite of what was asked for.
        const timer = Number.isFinite(timeoutMs)
            ? setTimeout(() => {
                  cleanup();
                  reject(new Error(TIMEOUT_ERROR_MESSAGE));
              }, timeoutMs)
            : undefined;

        pending.set(reqId, { resolve, reject, timer });

        Neutralino.extensions
            .dispatch(EXT_ID, event, { ...payload, reqId })
            .catch((err: unknown) => {
                cleanup();
                reject(err instanceof Error ? err : new Error(String(err)));
            });
    });
}
