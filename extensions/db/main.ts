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
  AWS_SSO_PROMPT_EVENT,
  CONNECT_PROGRESS_EVENT,
  CONNECTION_STATE_EVENT,
  DB_RESPONSE_EVENT,
  UPDATE_PROGRESS_EVENT,
  type CommandName,
  type CommandReq,
  type CommandRes,
  type ConnectionConfig,
  type QueryResult,
  type SqlDialect,
} from '../../shared/protocol/index.ts';
import { fitMaximizedToWorkArea, matchWindowFrame } from './chrome.ts';
import { credentialStatus, ssoLogin } from './iam.ts';
import { applyUpdate, checkForUpdate, downloadUpdate } from './updater.ts';
import { openConnection, type ConnectionHandle } from './connection.ts';
import { log } from './log.ts';
import {
  addEnvironment,
  dataDir,
  deleteEnvironment,
  deleteQuery,
  deleteSaved,
  deleteWorkspace,
  getSession,
  listEnvironments,
  listQueries,
  listSaved,
  listSettings,
  listStars,
  listWorkspaces,
  resolveSaved,
  saveConnection,
  saveQuery,
  saveWorkspace,
  setSession,
  setSetting,
  setStar,
  storedPassword,
} from './store.ts';

// Killing the app does not reliably close our socket: WebView2 child processes
// inherit the listening handle, so the connection can sit in ESTABLISHED forever
// and 'close' never fires. Without a liveness check this process would outlive
// every crash while still holding its database connections open, so we ping the
// app instead of trusting the socket.
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

/** Above this, a query is worth a line in the log -- never the query itself. */
const SLOW_QUERY_MS = 2_000;

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
  log.info(`disconnected ${connectionId}`);
}

/* ------------------------------------------------------------------ *
 * Commands (what the UI can ask for)
 * ------------------------------------------------------------------ */

type Handlers = { [K in CommandName]: (req: CommandReq<K>) => Promise<CommandRes<K>> };

/** Open, verify and register a connection -- what both connect paths mean by it. */
async function establish(
  config: ConnectionConfig,
  readOnly: boolean
): Promise<{ connectionId: string; databases: string[]; dialect: SqlDialect; defaultSchema?: string }> {
  // Minted before the connection is opened rather than after, because a drop is
  // reported by naming the connection it happened to -- and a connection can be
  // dropped from its very first idle second, which is well before an id assigned
  // on the way out would exist. A failed connect simply never registers it.
  const connectionId = randomUUID();

  const conn = await openConnection(
    config,
    readOnly,
    (phase) => send(CONNECT_PROGRESS_EVENT, { phase }),
    (state, reason) => {
      // The one thing in here with no other way to surface: a drop is not a
      // command's failure, so nothing carries it back over the bridge on its own.
      if (state === 'lost') log.warn(`connection lost ${connectionId}: ${reason ?? 'no reason given'}`);
      else log.info(`connection restored ${connectionId}`);
      send(CONNECTION_STATE_EVENT, { connectionId, state, reason });
    }
  );
  const databases = await conn.listDatabases();

  connections.set(connectionId, conn);
  log.info(`connected ${connectionId} (${conn.dialect}${readOnly ? ', read-only' : ''})`);
  return { connectionId, databases, dialect: conn.dialect, defaultSchema: conn.defaultSchema };
}

const COMMANDS: Handlers = {
  async 'db.connect'({ config, readOnly }) {
    return establish(config, readOnly);
  },

  /**
   * Open a connection from values still being typed, name what answered, and
   * close it again -- never reaching `connections`, so there is no id to hand
   * back and nothing for a later command to find.
   *
   * The close runs in a `finally` because the version query is the step most
   * likely to fail after the socket is up: a connection opened and then
   * abandoned by an early return is exactly the orphan the heartbeat exists to
   * catch, and one this side can simply not create. `readOnly` is not asked for
   * -- a test writes nothing either way, and a session policy is not part of
   * whether the credentials are right.
   *
   * No progress is broadcast either. `CONNECT_PROGRESS_EVENT` is read as "the
   * connect you started is at this phase", and a test is not one -- the phase
   * would outlive it and describe a connection that never opened.
   */
  async 'db.test'({ config, password }) {
    const secret = password.mode === 'typed' ? password.password : await storedPassword(password.savedConnectionId);
    const conn = await openConnection({ ...config, password: secret }, false);
    try {
      return { serverVersion: await conn.serverVersion() };
    } finally {
      await conn.close();
    }
  },

  async 'db.databases'({ connectionId }) {
    return { databases: await getConnection(connectionId).listDatabases() };
  },

  async 'db.tables'({ connectionId, database }) {
    return { tables: await getConnection(connectionId).listTables(database) };
  },

  async 'db.columns'({ connectionId, database, table, schema }) {
    return { columns: await getConnection(connectionId).listColumns(database, { table, schema }) };
  },

  async 'db.tableKey'({ connectionId, database, table, schema }) {
    return { keyColumns: await getConnection(connectionId).rowKey(database, { table, schema }) };
  },

  async 'db.query'({ connectionId, database, sql, sort }) {
    const conn = getConnection(connectionId);
    const startedAt = Date.now();
    const outcome = await conn.query(database, sql, sort);
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_QUERY_MS) log.warn(`slow query on ${connectionId} (${database ?? 'default'}): ${durationMs}ms`);
    return { ...outcome, durationMs } as QueryResult;
  },

  async 'db.browse'({ connectionId, database, table, schema, offset, filter, sort }) {
    const conn = getConnection(connectionId);
    const startedAt = Date.now();
    const { columns, rows, ...page } = await conn.browse(database, { table, schema }, offset, filter, sort);
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_QUERY_MS) log.warn(`slow browse on ${connectionId} (${database}.${table}): ${durationMs}ms`);
    return { result: { columns, rows, durationMs }, ...page };
  },

  async 'db.ddl'({ connectionId, database, table, schema, kind }) {
    return { ddl: await getConnection(connectionId).tableDdl(database, { table, schema }, kind) };
  },

  async 'db.triggers'({ connectionId, database, table, schema }) {
    return { triggers: await getConnection(connectionId).listTriggers(database, { table, schema }) };
  },

  async 'db.triggerDdl'({ connectionId, database, table, schema, trigger }) {
    return { ddl: await getConnection(connectionId).triggerDdl(database, { table, schema }, trigger) };
  },

  async 'db.functions'({ connectionId, database }) {
    return { functions: await getConnection(connectionId).listFunctions(database) };
  },

  async 'db.functionDdl'({ connectionId, database, function: func, schema, kind }) {
    return { ddl: await getConnection(connectionId).functionDdl(database, func, kind, schema) };
  },

  async 'db.drop'({ connectionId, database, table, schema, kind }) {
    await getConnection(connectionId).dropRelation(database, { table, schema }, kind);
    return { ok: true };
  },

  async 'db.write'({ connectionId, database, table, schema, edits, deletes }) {
    return { affectedRows: await getConnection(connectionId).write(database, { table, schema }, edits, deletes) };
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

  async 'db.saved.save'({ id, workspaceId, name, config, environment, readOnly, password, color }) {
    return { connection: await saveConnection({ id, workspaceId, name, config, environment, readOnly, password, color }) };
  },

  async 'db.saved.delete'({ id }) {
    deleteSaved(id);
    return { ok: true };
  },

  async 'db.saved.connect'({ id, password }) {
    const { config, password: secret, name, environment, workspaceId, color, readOnly } = await resolveSaved(id, password);
    return {
      ...(await establish({ ...config, password: secret }, readOnly)),
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

  async 'db.session.save'({ savedConnectionId, session }) {
    setSession(savedConnectionId, session);
    return { ok: true };
  },

  async 'db.stars.list'({ savedConnectionId }) {
    return { stars: listStars(savedConnectionId) };
  },

  async 'db.stars.set'({ savedConnectionId, database, table, schema, starred }) {
    setStar(savedConnectionId, database, schema, table, starred);
    return { ok: true };
  },

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

  /* -- AWS credentials (iam.ts explains why the CLI does this) ---------- */

  async 'aws.credentialStatus'({ profile }) {
    return credentialStatus(profile);
  },

  async 'aws.ssoLogin'({ profile }) {
    // Broadcast rather than returned: the URL and the code are what the user has
    // to act on, and they arrive while this is still waiting for them to.
    await ssoLogin(profile, (prompt) => send(AWS_SSO_PROMPT_EVENT, prompt));
    return { ok: true };
  },

  /* -- The window (chrome.ts explains why this lives here) ------------- */

  async 'window.matchFrame'({ pid, colour }) {
    return { applied: matchWindowFrame(pid, colour) };
  },

  async 'window.fitMaximized'({ pid }) {
    return { applied: fitMaximizedToWorkArea(pid) };
  },

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
    }),
    (err) => {
      if (err) log.error(`send error: ${err.message}`);
    }
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
  ws.on('message', handleMessage);
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
