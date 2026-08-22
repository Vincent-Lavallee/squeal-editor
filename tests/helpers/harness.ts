/**
 * Stands in for Neutralino: hosts the WebSocket the extension dials back into,
 * spawns the extension exactly as the app does, and dispatches events at it.
 *
 * This is what lets the extension be tested without launching a window. The
 * transport it exercises is the real one -- stdin init, app.broadcast envelope,
 * reqId correlation -- so a protocol regression fails here.
 */

import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { Subprocess } from 'bun';

import type { CommandName, CommandReq, DbResponse } from '../../shared/protocol/index.ts';

const EXT_ID = 'js.squeal.db';
const TOKEN = 'test-token';
const EXT_MAIN = new URL('../../extensions/db/main.ts', import.meta.url).pathname.replace(
    /^\//,
    '',
);

export interface Harness {
    /** Dispatch a command and await the extension's reply, ok or not. */
    dispatch<K extends CommandName>(
        event: K,
        data: CommandReq<K> | Record<string, unknown>,
    ): Promise<DbResponse>;
    /** Dispatch and require success, returning the payload. */
    ok<K extends CommandName>(
        event: K,
        data: CommandReq<K> | Record<string, unknown>,
    ): Promise<unknown>;
    /**
     * Wait for a broadcast that is not a reply to anything -- connection state,
     * connect progress, download progress.
     *
     * `match` is how a test names the one it wants out of a stream that may carry
     * several: a dropped connection is announced by naming its own connectionId,
     * and a suite with more than one connection open will see the other's too.
     */
    waitFor(event: string, match: (data: never) => boolean, timeoutMs?: number): Promise<unknown>;
    stop(): Promise<void>;
}

/**
 * `env` is how the saved-connection suite points the extension at a throwaway
 * store and keychain entry. Both still exercise the real SQLite and the real OS
 * credential store -- only the names change, so a test run cannot read, write or
 * delete the connections you actually use.
 */
export async function startHarness(env: Record<string, string> = {}): Promise<Harness> {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const { port } = wss.address() as { port: number };

    const child: Subprocess = Bun.spawn(['bun', EXT_MAIN], {
        stdin: 'pipe',
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env, ...env },
    });
    child.stdin.write(
        JSON.stringify({
            nlPort: String(port),
            nlToken: TOKEN,
            nlConnectToken: 'ct',
            nlExtensionId: EXT_ID,
        }),
    );
    child.stdin.flush();

    const socket: WsSocket = await new Promise((resolve) =>
        wss.once('connection', (ws) => resolve(ws)),
    );

    let nextReqId = 1;
    const pending = new Map<number, (r: DbResponse) => void>();
    /** Broadcasts nobody has claimed yet, so a test that subscribes late still sees one. */
    const seen: Array<{ event: string; data: unknown }> = [];
    const watchers = new Set<(event: string, data: unknown) => void>();

    socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        // The extension must speak the envelope Neutralino expects.
        if (msg.method !== 'app.broadcast') return;
        if (msg.accessToken !== TOKEN) throw new Error('extension sent a bad access token');

        if (msg.data?.event !== 'db.response') {
            seen.push({ event: msg.data?.event, data: msg.data?.data });
            for (const watcher of watchers) watcher(msg.data?.event, msg.data?.data);
            return;
        }

        const payload = msg.data.data as DbResponse;
        pending.get(payload.reqId)?.(payload);
        pending.delete(payload.reqId);
    });

    function dispatch(event: string, data: Record<string, unknown>): Promise<DbResponse> {
        return new Promise((resolve, reject) => {
            const reqId = nextReqId++;
            pending.set(reqId, resolve);
            socket.send(JSON.stringify({ event, data: { ...data, reqId } }));
            setTimeout(() => {
                if (pending.delete(reqId)) reject(new Error(`${event} timed out`));
            }, 20_000);
        });
    }

    function waitFor(
        event: string,
        match: (data: never) => boolean,
        timeoutMs = 15_000,
    ): Promise<unknown> {
        const already = seen.find((b) => b.event === event && match(b.data as never));
        if (already) return Promise.resolve(already.data);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                watchers.delete(watcher);
                reject(new Error(`no ${event} broadcast within ${timeoutMs}ms`));
            }, timeoutMs);

            const watcher = (name: string, data: unknown) => {
                if (name !== event || !match(data as never)) return;
                clearTimeout(timer);
                watchers.delete(watcher);
                resolve(data);
            };
            watchers.add(watcher);
        });
    }

    return {
        dispatch: dispatch as Harness['dispatch'],
        waitFor,
        async ok(event, data) {
            const res = await dispatch(event as string, data as Record<string, unknown>);
            if (!res.ok) throw new Error(`${event} failed: ${res.error}`);
            return res.data;
        },
        async stop() {
            child.kill();
            await child.exited;
            // wss.close() waits for every client to go away, and a killed child's
            // socket can linger -- terminate rather than close, or teardown hangs.
            for (const client of wss.clients) client.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        },
    };
}
