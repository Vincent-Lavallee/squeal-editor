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

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let nextReqId = 1;
const pending = new Map<number, Pending>();
let extensionReady: Promise<void> | null = null;

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

export function initBridge(): void {
  Neutralino.init();
  void Neutralino.events.on(DB_RESPONSE_EVENT, onResponse);
  void Neutralino.events.on('windowClose', () => void Neutralino.app.exit());

  // Kicked off once at startup; every call awaits this before dispatching, so
  // queries fired before the extension is up simply wait rather than vanish.
  extensionReady = waitForExtension();
}

export async function call<K extends CommandName>(
  event: K,
  payload: CommandReq<K>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<CommandRes<K>> {
  await extensionReady;
  const reqId = nextReqId++;

  return new Promise<CommandRes<K>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('The database did not respond in time.'));
    }, timeoutMs);

    pending.set(reqId, { resolve: resolve as Pending['resolve'], reject, timer });

    Neutralino.extensions.dispatch(EXT_ID, event, { ...payload, reqId }).catch((err: unknown) => {
      pending.delete(reqId);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
