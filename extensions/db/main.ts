/**
 * Squeal database extension.
 *
 * Neutralino's runtime has no JS engine that can open a TCP socket to a
 * database, so it spawns this process (with Bun, which runs this TypeScript
 * directly -- no build step) and talks to it over a WebSocket.
 *
 * This file owns the transport and the connection registry; drivers.ts owns the
 * per-engine SQL and connection.ts owns a single server connection. Everything
 * the UI can ask for is a handler in COMMANDS below.
 */

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import {
  DB_RESPONSE_EVENT,
  UPDATE_PROGRESS_EVENT,
  type CommandName,
  type CommandReq,
  type CommandRes,
  type ConnectionConfig,
  type QueryResult,
  type SqlDialect,
} from '../../shared/protocol.ts';
import { matchWindowFrame } from './chrome.ts';
import { applyUpdate, checkForUpdate, downloadUpdate } from './updater.ts';
import { openConnection, type ConnectionHandle } from './connection.ts';
import {
  deleteSaved,
  deleteWorkspace,
  listSaved,
  listWorkspaces,
  resolveSaved,
  saveConnection,
  saveWorkspace,
} from './store.ts';

// Killing the app does not reliably close our socket: WebView2 child processes
// inherit the listening handle, so the connection can sit in ESTABLISHED forever
// and 'close' never fires. Without a liveness check this process would outlive
// every crash while still holding its database connections open, so we ping the
// app instead of trusting the socket.
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

const connections = new Map<string, ConnectionHandle>();

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

function getConnection(connectionId: string): ConnectionHandle {
  const conn = connections.get(connectionId);
  if (!conn) throw new Error('Not connected - connect to a server first.');
  return conn;
}

async function closeConnection(connectionId: string): Promise<void> {
  const conn = connections.get(connectionId);
  if (!conn) return;
  connections.delete(connectionId);
  await conn.close();
}

/* ------------------------------------------------------------------ *
 * Commands (what the UI can ask for)
 * ------------------------------------------------------------------ */

type Handlers = { [K in CommandName]: (req: CommandReq<K>) => Promise<CommandRes<K>> };

/** Open, verify and register a connection -- what both connect paths mean by it. */
async function establish(
  config: ConnectionConfig,
  readOnly: boolean
): Promise<{ connectionId: string; databases: string[]; dialect: SqlDialect }> {
  const conn = await openConnection(config, readOnly);
  const databases = await conn.listDatabases();

  const connectionId = randomUUID();
  connections.set(connectionId, conn);
  return { connectionId, databases, dialect: conn.dialect };
}

const COMMANDS: Handlers = {
  async 'db.connect'({ config, readOnly }) {
    return establish(config, readOnly);
  },

  async 'db.databases'({ connectionId }) {
    return { databases: await getConnection(connectionId).listDatabases() };
  },

  async 'db.tables'({ connectionId, database }) {
    return { tables: await getConnection(connectionId).listTables(database) };
  },

  async 'db.columns'({ connectionId, database, table }) {
    return { columns: await getConnection(connectionId).listColumns(database, table) };
  },

  async 'db.query'({ connectionId, database, sql }) {
    const conn = getConnection(connectionId);
    const startedAt = Date.now();
    const outcome = await conn.query(database, sql);
    return { ...outcome, durationMs: Date.now() - startedAt } as QueryResult;
  },

  async 'db.browse'({ connectionId, database, table, offset }) {
    const conn = getConnection(connectionId);
    const startedAt = Date.now();
    const { columns, rows, ...page } = await conn.browse(database, table, offset);
    return { result: { columns, rows, durationMs: Date.now() - startedAt }, ...page };
  },

  async 'db.ddl'({ connectionId, database, table, kind }) {
    return { ddl: await getConnection(connectionId).tableDdl(database, table, kind) };
  },

  async 'db.drop'({ connectionId, database, table, kind }) {
    await getConnection(connectionId).dropRelation(database, table, kind);
    return { ok: true };
  },

  async 'db.write'({ connectionId, database, table, edits, deletes }) {
    return { affectedRows: await getConnection(connectionId).write(database, table, edits, deletes) };
  },

  async 'db.disconnect'({ connectionId }) {
    await closeConnection(connectionId);
    return { ok: true };
  },

  async 'db.readonly'({ connectionId, readOnly }) {
    await getConnection(connectionId).setReadOnly(readOnly);
    return { ok: true };
  },

  /* -- Saved connections (store.ts owns the file and the key) ---------- */

  async 'db.saved.list'() {
    return { connections: listSaved() };
  },

  async 'db.saved.save'({ id, workspaceId, name, config, environment, readOnly, password }) {
    return { connection: await saveConnection({ id, workspaceId, name, config, environment, readOnly, password }) };
  },

  async 'db.saved.delete'({ id }) {
    deleteSaved(id);
    return { ok: true };
  },

  async 'db.saved.connect'({ id, password }) {
    const { config, password: secret, name, environment, workspaceId, readOnly } = await resolveSaved(id, password);
    return {
      ...(await establish({ ...config, password: secret }, readOnly)),
      config,
      name,
      environment,
      workspaceId,
      readOnly,
    };
  },

  /* -- Workspaces (store.ts owns the grouping and the cascade) --------- */

  async 'db.workspaces.list'() {
    return { workspaces: listWorkspaces() };
  },

  async 'db.workspaces.save'({ id, name, icon, color }) {
    return { workspace: saveWorkspace({ id, name, icon, color }) };
  },

  async 'db.workspaces.delete'({ id }) {
    deleteWorkspace(id);
    return { ok: true };
  },

  /* -- The window (chrome.ts explains why this lives here) ------------- */

  async 'window.matchFrame'({ pid, colour }) {
    return { applied: matchWindowFrame(pid, colour) };
  },

  /* -- The updater (updater.ts explains why this lives here too) -------- */

  async 'update.check'({ currentVersion }) {
    return checkForUpdate(currentVersion);
  },

  async 'update.download'() {
    // Progress rides its own broadcast; this resolves only once staged + verified.
    await downloadUpdate((progress) => send(UPDATE_PROGRESS_EVENT, progress));
    return { ok: true };
  },

  async 'update.apply'() {
    applyUpdate();
    return { ok: true };
  },
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
    })
  );
}

async function handleMessage(raw: WebSocket.RawData): Promise<void> {
  lastSeenAlive = Date.now();

  let message: { event?: string; data?: Record<string, unknown> };
  try {
    message = JSON.parse(raw.toString());
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
    send(DB_RESPONSE_EVENT, { reqId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

let shuttingDown = false;
async function shutdown(code = 0): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true;
    if (heartbeat) clearInterval(heartbeat);
    await Promise.all([...connections.keys()].map(closeConnection));
  }
  process.exit(code);
}

function startHeartbeat(): void {
  lastSeenAlive = Date.now();
  heartbeat = setInterval(() => {
    if (Date.now() - lastSeenAlive > HEARTBEAT_TIMEOUT_MS) {
      process.stderr.write('[squeal-db] app stopped responding; shutting down\n');
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
  ws.on('open', startHeartbeat);
  ws.on('pong', () => {
    lastSeenAlive = Date.now();
  });
  ws.on('message', handleMessage);
  ws.on('error', (err) => {
    process.stderr.write(`[squeal-db] socket error: ${err.message}\n`);
  });
  // Belt and braces: exit on a clean close too, without waiting for the heartbeat.
  ws.on('close', () => void shutdown(0));
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

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
