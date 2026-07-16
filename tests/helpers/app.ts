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

/**
 * `env` reaches the extension: Neutralino spawns it as a child, so it inherits
 * whatever `neu run` was given. That is how the UI suite points the saved
 * connection store at a throwaway directory instead of the real one belonging
 * to whoever is running the tests.
 */
export async function launchApp(env: Record<string, string> = {}): Promise<AppSession> {
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

    async reload() {
      await send('Page.reload');
      await Bun.sleep(2500);
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
      } else {
        await $`pkill -f neutralino`.quiet().nothrow();
      }
    },
  };

  return page;
}
