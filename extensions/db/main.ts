/**
 * Squeal database extension.
 *
 * Neutralino's runtime has no JS engine that can open a TCP socket to a
 * database, so it spawns this process (with Bun, which runs this TypeScript
 * directly -- no build step) and talks to it over a WebSocket.
 *
 * This file owns the transport and dispatch; drivers/ owns the per-engine SQL,
 * connection.ts owns a single server connection, and the `commands*.ts` files
 * each own one domain of COMMANDS below.
 */

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import { DB_RESPONSE_EVENT, type CommandName } from '../../shared/protocol/index.ts';
import { commandsConnection } from './commandsConnection.ts';
import { closeAllConnections } from './commandsConnectionCore.ts';
import { commandsAssistant } from './commandsAssistant.ts';
import { commandsAws } from './commandsAws.ts';
import { commandsMisc } from './commandsMisc.ts';
import { commandsSaved } from './commandsSaved.ts';
import { commandsUpdater } from './commandsUpdater.ts';
import { commandsWindow } from './commandsWindow.ts';
import { commandsWorkspaces } from './commandsWorkspaces.ts';
import type { Handlers } from './commandTypes.ts';
import { log } from './log.ts';

// Killing the app does not reliably close our socket: WebView2 child processes
// inherit the listening handle, so the connection can sit in ESTABLISHED forever
// and 'close' never fires. Without a liveness check this process would outlive
// every crash while still holding its database connections open, so we ping the
// app instead of trusting the socket.
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

let ws: WebSocket | null = null;
let accessToken = '';
let lastSeenAlive = Date.now();
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Init payload Neutralino writes to our stdin on startup. */
interface ExtensionInit {
    nlPort: string | number;
    nlToken: string;
    nlConnectToken: string;
    nlExtensionId: string;
}

/* ------------------------------------------------------------------ *
 * Commands (what the UI can ask for)
 * ------------------------------------------------------------------ */

const COMMANDS: Handlers = {
    ...commandsConnection(send),
    ...commandsSaved(send),
    ...commandsWorkspaces(),
    ...commandsAws(send),
    ...commandsWindow(),
    ...commandsMisc(),
    ...commandsUpdater(send),
    ...commandsAssistant(send),
};

/* ------------------------------------------------------------------ *
 * Neutralino extension transport
 * ------------------------------------------------------------------ */

function send(event: string, data: unknown): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
        JSON.stringify({
            id: randomUUID(),
            method: 'app.broadcast',
            accessToken,
            data: { event, data },
        }),
        (err) => {
            if (err) log.error(`send error: ${err.message}`);
        },
    );
}

// `RawData` covers configurations this socket never uses -- but ArrayBuffer's
// own `toString()` is `'[object ArrayBuffer]'`, not its bytes, so a plain
// `raw.toString()` would silently misparse if one ever arrived.
function rawDataToString(raw: WebSocket.RawData): string {
    if (Buffer.isBuffer(raw)) return raw.toString();
    if (Array.isArray(raw)) return Buffer.concat(raw).toString();
    return Buffer.from(raw).toString();
}

async function handleMessage(raw: WebSocket.RawData): Promise<void> {
    lastSeenAlive = Date.now();

    let message: { event?: string; data?: Record<string, unknown> };
    try {
        message = JSON.parse(rawDataToString(raw)) as {
            event?: string;
            data?: Record<string, unknown>;
        };
    } catch {
        return;
    }

    const name = message.event as CommandName | undefined;
    if (!name || !(name in COMMANDS)) return;

    const { reqId, ...payload } = (message.data ?? {}) as { reqId?: number };
    try {
        // The payload is user-supplied JSON; the Handlers map is what pins its shape.
        const handler = COMMANDS[name] as (req: unknown) => Promise<unknown>;
        const data = await handler(payload);
        send(DB_RESPONSE_EVENT, { reqId, ok: true, data });
    } catch (err) {
        send(DB_RESPONSE_EVENT, {
            reqId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

let shuttingDown = false;
async function shutdown(code = 0): Promise<never> {
    if (!shuttingDown) {
        shuttingDown = true;
        if (heartbeat) clearInterval(heartbeat);
        await closeAllConnections();
    }
    process.exit(code);
}

function startHeartbeat(): void {
    lastSeenAlive = Date.now();
    heartbeat = setInterval(() => {
        if (Date.now() - lastSeenAlive > HEARTBEAT_TIMEOUT_MS) {
            log.warn('app stopped responding; shutting down');
            void shutdown(0);
            return;
        }
        if (ws?.readyState === WebSocket.OPEN) ws.ping();
    }, HEARTBEAT_INTERVAL_MS);
}

function start(init: ExtensionInit): void {
    accessToken = init.nlToken;

    const url =
        `ws://localhost:${init.nlPort}?extensionId=${encodeURIComponent(init.nlExtensionId)}` +
        `&connectToken=${encodeURIComponent(init.nlConnectToken)}`;

    ws = new WebSocket(url);
    ws.on('open', () => {
        log.info('connected to app');
        startHeartbeat();
    });
    ws.on('pong', () => {
        lastSeenAlive = Date.now();
    });
    ws.on('message', (raw) => void handleMessage(raw));
    ws.on('error', (err) => {
        log.error(`socket error: ${err.message}`);
        void shutdown(1);
    });
    // Belt and braces: exit on a clean close too, without waiting for the heartbeat.
    ws.on('close', () => {
        log.info('app closed the connection; shutting down');
        void shutdown(0);
    });
}

// Neutralino writes the connection details to stdin as a single JSON line.
let stdinBuffer = '';
process.stdin.on('data', (chunk: Buffer) => {
    stdinBuffer += chunk.toString();
    try {
        const init = JSON.parse(stdinBuffer) as ExtensionInit;
        stdinBuffer = '';
        start(init);
    } catch {
        // Partial JSON - wait for the rest of the line.
    }
});

process.on('SIGINT', () => {
    log.info('received SIGINT; shutting down');
    void shutdown(0);
});
process.on('SIGTERM', () => {
    log.info('received SIGTERM; shutting down');
    void shutdown(0);
});

// Unhandled errors that reach the process would otherwise kill the extension
// without closing database connections. Log and shut down so the connections
// are released before the process exits.
process.on('uncaughtException', (err) => {
    log.error(`uncaught exception: ${err.message}`);
    void shutdown(1);
});
process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    log.error(`unhandled rejection: ${message}`);
    void shutdown(1);
});
