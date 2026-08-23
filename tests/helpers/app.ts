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
     * Press a chord as the *host* sees it, not as a synthetic `KeyboardEvent`.
     *
     * The difference is the whole reason this exists. A dispatched `KeyboardEvent`
     * enters at the DOM and can only ever reach DOM listeners; a real keypress is
     * seen by the embedder first, so a chord the webview claims as a browser
     * accelerator (Ctrl+W closing the window is the one that matters here) never
     * reaches the app at all. `Input.dispatchKeyEvent` goes in at the same place
     * a physical key does, which is the only way a test can tell the two apart.
     */
    press(
        key: string,
        modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean },
    ): Promise<void>;
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
 *
 * `<Select>` is not a native `<select>` — it is a focusable div plus a floating
 * listbox, so there is no `.value` to set and no `option` to enumerate while it
 * is shut, and no `.disabled` either (it is `aria-disabled`). Everything below
 * drives it the way a user does: click to open, click a row to choose. A
 * searchable one is typed into at `[data-testid="<id>-search"]`, which is inside
 * the *trigger* and exists only while the list is open.
 *
 * **Both halves are async, and that is the part worth knowing.** A `click()`
 * dispatched from a script is not a trusted event, so React does not flush it
 * synchronously the way it flushes a real one — the popup is *not* in the DOM
 * on the next line. `pickOption` and `optionsOf` therefore return promises and
 * poll for the listbox, and every caller must make one the completion value of
 * its `evaluate` (no trailing `true;`), which `awaitPromise` then waits on.
 * Fire one and carry on and it reads as "no option X": the list simply had not
 * rendered yet.
 *
 * The second half of that matters for ordering too. An option's click handler
 * closes over the state of the render that opened the popup, so anything typed
 * into the same form *between* the open and the choose is discarded when the
 * choose lands. Pick first, await it, then type — never both in one script.
 */
export const REACT_SETTERS = `
function setNative(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function waitForNode(selector) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    (function poll() {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      if (Date.now() - startedAt > 4000) return reject(new Error('never appeared: ' + selector));
      setTimeout(poll, 30);
    })();
  });
}
function pickOption(el, value) {
  el.click();
  return waitForNode('[role="listbox"] [role="option"][data-value="' + value + '"]').then((o) => o.click());
}
function selectValue(testid) {
  return document.querySelector('[data-testid="' + testid + '"]').getAttribute('data-value');
}
/** Opens the listbox, reads a field off every row, shuts it again. */
function optionsOf(testid, field) {
  const trigger = document.querySelector('[data-testid="' + testid + '"]');
  trigger.click();
  return waitForNode('[role="listbox"] [role="option"]').then(() => {
    const rows = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
    const read = rows.map((e) => (field === 'value' ? e.getAttribute('data-value') : e.textContent));
    trigger.click();
    return read;
  });
}`;

async function findPage(tries = 120): Promise<Target> {
    let lastSeen: string[] | null = null;
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
            const targets = (await res.json()) as Target[];
            lastSeen = targets.map((t) => `${t.type}:${t.title}`);
            const page = targets.find((t) => t.title === PAGE_TITLE && t.type === 'page');
            if (page) return page;
        } catch {
            // Not up yet.
        }
        await Bun.sleep(1000);
    }
    // Distinguishes "the port never answered at all" from "it answered with
    // something other than the page we wanted" -- the same crash-vs-cold-start
    // question a bare timeout can't answer on its own.
    throw new Error(
        lastSeen
            ? `app never exposed a CDP target titled "${PAGE_TITLE}"; saw: ${lastSeen.join(', ') || '(none)'}`
            : `app never exposed a CDP page target; port ${CDP_PORT} never answered`,
    );
}

/** Is anything answering on the debugging port right now? */
async function cdpAlive(): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, {
            signal: AbortSignal.timeout(1000),
        });
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
 * `force` skips the "is anything on the port" check. Two callers need that:
 * `reap.ts`, which runs *before* the port matters — `test:ui` compiles the
 * extension first, and `bun build --compile` cannot overwrite a running `.exe`,
 * so a stray extension fails the run at `EPERM` before a single test starts —
 * and `launchApp` itself, because a `bun start`/`bun run dev` instance carries
 * no fixed debug port and so is invisible to the port check even though it
 * still collides with the one about to be spawned; see its call site.
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
    throw new Error(
        `a previous app is still holding port ${CDP_PORT}; kill it before running the UI suite`,
    );
}

/**
 * `env` reaches the extension: Neutralino spawns it as a child, so it inherits
 * whatever `neu run` was given. That is how the UI suite points the saved
 * connection store at a throwaway directory instead of the real one belonging
 * to whoever is running the tests.
 */
export async function launchApp(env: Record<string, string> = {}): Promise<AppSession> {
    // Never attach to a survivor of the last run -- see `reapStaleApp`. Forced,
    // because a `bun start`/`bun run dev` instance started during the build that
    // just ran has no fixed debug port and is invisible to the cdpAlive() check
    // otherwise -- and it still collides with the one about to be spawned.
    await reapStaleApp(true);

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
    const ws = new WebSocket(target.webSocketDebuggerUrl, {
        perMessageDeflate: false,
    });
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });

    let msgId = 0;
    // `any` here, deliberately: every pending call has its own T from `send<T>`
    // below, and this one map holds all of them at once -- there's no type
    // short of erasure that fits a resolver for every T in the same slot.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (!msg.id) return;
        const w = waiting.get(msg.id);
        if (!w) return;
        waiting.delete(msg.id);
        if (msg.error) w.reject(new Error(msg.error.message));
        else w.resolve(msg.result);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as `waiting` above.
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

    const rootRendered = `document.querySelector('#root')?.children.length > 0 ? true : null`;

    const page: AppSession = {
        async evaluate<T>(expression: string): Promise<T> {
            const r = await send('Runtime.evaluate', {
                // **The page's own GC may take a promise this is waiting on.**
                // `awaitPromise` holds it weakly, so a script whose value is a promise
                // — every `REACT_SETTERS` one — can answer with CDP error -32000,
                // `Promise was collected`, instead of a result. It surfaces as whatever
                // test was running when the reply landed, with a stack in the harness
                // and no relation to what that test was doing, and every test after it
                // inherits the screen the aborted one never cleaned up: one collected
                // promise reads as a dozen unrelated failures. Naming the value on
                // `window` roots it in the page for as long as the reply takes.
                //
                // `eval` rather than a wrapping function because these expressions are
                // statement lists whose *completion value* is the answer — `foo(); true;`
                // — and there is no `return` for a wrapper to carry out.
                expression: `window.__squealEval = eval(${JSON.stringify(expression)})`,
                awaitPromise: true,
                returnByValue: true,
            });
            if (r.exceptionDetails) {
                throw new Error(
                    r.exceptionDetails.exception?.description ?? 'page threw during evaluate',
                );
            }
            return r.result.value as T;
        },

        async press(key, modifiers = {}) {
            // CDP's bitmask: Alt 1, Ctrl 2, Meta 4, Shift 8.
            const mask =
                (modifiers.alt ? 1 : 0) | (modifiers.ctrl ? 2 : 0) | (modifiers.shift ? 8 : 0);
            const upper = key.length === 1 ? key.toUpperCase() : key;
            const common = {
                modifiers: mask,
                key: upper,
                code: key.length === 1 ? `Key${upper}` : key,
                windowsVirtualKeyCode: key.length === 1 ? upper.charCodeAt(0) : 0,
            };
            await send('Input.dispatchKeyEvent', { ...common, type: 'rawKeyDown' });
            await send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
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
                `waitFor timed out after ${timeoutMs}ms: ${expression.trim().slice(0, 120)}${
                    lastError ? `\nlast error: ${String(lastError)}` : ''
                }`,
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
            await this.waitFor(rootRendered);
        },

        async screenshot(path: string) {
            const r = await send<{ data: string }>('Page.captureScreenshot', {
                format: 'png',
            });
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

    // The CDP target exists as soon as the window opens, long before the bundle
    // has loaded and React has mounted -- returning here is what let a test run
    // start against a page that was "up enough to accept an evaluate and not up
    // enough to have rendered", the collapse `docs/testing.md` describes. Wait
    // for the same thing `reload()` waits for before handing the session back.
    await page.waitFor(rootRendered, 30_000);

    return page;
}
