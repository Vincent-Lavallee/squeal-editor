/**
 * Launches the real app and drives its page over the Chrome DevTools Protocol.
 *
 * WebView2 only exposes CDP when asked via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
 * so this path is Windows-only. That is why the UI suite is a separate script
 * (`bun run test:ui`) rather than part of the default `bun test`.
 */

import { $ } from 'bun';
import WebSocket from 'ws';

const CDP_PORT = 9333;
const PAGE_TITLE = 'Squeal Editor';

interface Target {
  title: string;
  type: string;
  webSocketDebuggerUrl: string;
}

export interface Page {
  /** Evaluate in the page and return the value. Throws if the page throws. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /**
   * Re-evaluate `expression` until it yields something other than `null` or
   * `undefined`, and return that. Throws when it never does.
   *
   * The alternative is `evaluate` after a fixed `Bun.sleep`, which is what most
   * of this suite still does and what it should stop doing. A sleep encodes how
   * long the step took on the machine it was written on; anything that shifts
   * the timing — a slower box, a feature added upstream, one more test running
   * first — turns it into a failure that reads as a broken app rather than as a
   * short wait. Prefer this wherever the thing being waited for is observable.
   *
   * The expression must return `null` for "not yet", not `false`: a predicate
   * answering a genuine `false` is a value, and swallowing it would make this
   * hang instead of failing the assertion it was asked about.
   */
  waitFor<T = unknown>(expression: string, timeoutMs?: number): Promise<T>;
  reload(): Promise<void>;
  screenshot(path: string): Promise<void>;
}

export interface AppSession extends Page {
  stop(): Promise<void>;
}

/**
 * React tracks its own value on DOM nodes, so assigning .value is ignored.
 * Prepend this to any script that needs to type into a controlled input.
 */
export const REACT_SETTERS = `
function setNative(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function setSelect(el, value) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}`;

async function findPage(tries = 40): Promise<Target> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const targets = (await res.json()) as Target[];
      const page = targets.find((t) => t.title === PAGE_TITLE && t.type === 'page');
      if (page) return page;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(1000);
  }
  throw new Error('app never exposed a CDP page target');
}

/** Is anything answering on the debugging port right now? */
async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Kill any app left behind by an earlier run, before starting one.
 *
 * **This is the single most important line in the harness, and its absence cost
 * a full day.** The debugging port is a fixed 9333 and `findPage` matches on the
 * window *title*, so an instance orphaned by a crashed, killed or timed-out run
 * is indistinguishable from the one about to be spawned — and the suite silently
 * drives the orphan instead: a different `SQUEAL_DATA_DIR`, already connected,
 * already past the connect screen. Every test then fails at once for reasons
 * that look unrelated to each other and to the real cause (`#type` missing reads
 * as `Illegal invocation` from `setSelect`, and a busy orphan reads as
 * `Runtime.evaluate timed out`), and it reproduces on a clean checkout, so it
 * looks like the app is broken rather than the harness.
 *
 * Reaping by name is the same blunt instrument `stop()` already uses, so this
 * takes a developer's own open copy of the app with it — that was already true
 * of running the suite and is the accepted cost of a fixed port.
 *
 * `force` skips the "is anything on the port" check, for the one caller that
 * runs *before* the port matters: `test:ui` compiles the extension first, and
 * `bun build --compile` cannot overwrite a running `.exe` — so a stray extension
 * fails the run at `EPERM` before a single test starts, which is the same
 * stray-process family one step upstream.
 */
export async function reapStaleApp(force = false): Promise<void> {
  if (!force && !(await cdpAlive())) return;

  if (process.platform === 'win32') {
    await $`taskkill /F /IM neutralino-win_x64.exe`.quiet().nothrow();
    // The extension outlives the app by design (the heartbeat), and while it
    // lives it holds the previous run's store open. Nothing here needs it.
    await $`taskkill /F /IM squeal-db-ext.exe`.quiet().nothrow();
  } else {
    await $`pkill -f neutralino`.quiet().nothrow();
  }

  // Wait for the port to actually go quiet: spawning while the old instance
  // still holds it is how two apps end up racing for one target list.
  for (let i = 0; i < 20; i++) {
    if (!(await cdpAlive())) return;
    await Bun.sleep(500);
  }
  throw new Error(`a previous app is still holding port ${CDP_PORT}; kill it before running the UI suite`);
}

/**
 * `env` reaches the extension: Neutralino spawns it as a child, so it inherits
 * whatever `neu run` was given. That is how the UI suite points the saved
 * connection store at a throwaway directory instead of the real one belonging
 * to whoever is running the tests.
 */
export async function launchApp(env: Record<string, string> = {}): Promise<AppSession> {
  // Never attach to a survivor of the last run -- see `reapStaleApp`.
  await reapStaleApp();

  const child = Bun.spawn(['bun', 'x', 'neu', 'run'], {
    env: {
      ...process.env,
      ...env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  const target = await findPage();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  let msgId = 0;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (!msg.id) return;
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result);
  });

  function send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (waiting.delete(id)) reject(new Error(`${method} timed out`));
      }, 20_000);
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  const page: AppSession = {
    async evaluate<T>(expression: string): Promise<T> {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? 'page threw during evaluate');
      }
      return r.result.value as T;
    },

    async waitFor<T>(expression: string, timeoutMs = 15_000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      let lastError: unknown = null;
      while (Date.now() < deadline) {
        try {
          const value = await this.evaluate<T>(expression);
          if (value !== null && value !== undefined) return value;
        } catch (err) {
          // A page mid-render can throw on a selector that is about to exist;
          // that is "not yet" too. The last one is reported if time runs out.
          lastError = err;
        }
        await Bun.sleep(100);
      }
      throw new Error(
        `waitFor timed out after ${timeoutMs}ms: ${expression.trim().slice(0, 120)}` +
          (lastError ? `\nlast error: ${String(lastError)}` : '')
      );
    },

    async reload() {
      await send('Page.reload');
      // Wait for React to have rendered *something* rather than for a fixed
      // interval. The bundle is several megabytes and the first screen also
      // waits on the extension answering `db.saved.list`, so how long this takes
      // is a property of the machine -- and the failure when it is too short is
      // a null element, which surfaces as an unrelated-looking TypeError deep in
      // whichever helper touched it first.
      await this.waitFor(`document.querySelector('#root')?.children.length > 0 ? true : null`);
    },

    async screenshot(path: string) {
      const r = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await Bun.write(path, Buffer.from(r.data, 'base64'));
    },

    async stop() {
      ws.close();
      child.kill();
      // `neu run` spawns the native binary as a child; killing the CLI leaves it
      // (and therefore the extension) behind, so reap the binary by name.
      if (process.platform === 'win32') {
        await $`taskkill /F /IM neutralino-win_x64.exe`.quiet().nothrow();
        // And the extension with it. It is *built* to outlive the app for up to
        // the heartbeat timeout, which is right in production and wrong here:
        // left running it keeps this run's store open and its socket bound, so
        // the next run starts against the previous one's leftovers.
        await $`taskkill /F /IM squeal-db-ext.exe`.quiet().nothrow();
      } else {
        await $`pkill -f neutralino`.quiet().nothrow();
        await $`pkill -f squeal-db-ext`.quiet().nothrow();
      }
    },
  };

  return page;
}
