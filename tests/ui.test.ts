/**
 * Drives the real app: launches it, fills the form, clicks the tree, runs SQL.
 * Windows-only (see helpers/app.ts) and needs `bun run test:db:up` first.
 *
 *   bun run test:ui
 *
 * `bun test` is a builtin that discovers every *.test.ts, so a bare `bun test`
 * would try to launch a window and fail. This suite therefore opts out unless
 * SQUEAL_UI=1, which `bun run test:ui` sets along with a longer timeout.
 *
 * Selectors match on exact label text. An earlier version used
 * `textContent.includes('users')`, which silently clicked `active_users` and
 * produced three confusing failures -- keep them exact.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchApp, REACT_SETTERS, type AppSession } from './helpers/app.ts';
import { MYSQL, PG } from './fixtures/config.ts';

const UI_ENABLED = process.env.SQUEAL_UI === '1';

/**
 * The app under test must not read, write or delete the saved connections
 * belonging to whoever is running this. Both are inherited by the extension
 * through `neu run`.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'squeal-ui-'));
const KEYCHAIN_SERVICE = `squeal-ui-test-${Bun.randomUUIDv7()}`;

let app: AppSession;

/** Tree rows: databases have a caret glyph, tables have an empty one. */
const clickRow = (kind: 'db' | 'table', label: string) => `
  [...document.querySelectorAll('.tree__row')]
    .filter(e => ${kind === 'db' ? "e.closest('.tree__children') === null" : "e.closest('.tree__children') !== null"})
    .find(e => e.querySelector('.tree__label').textContent === ${JSON.stringify(label)})
    .click(); true;`;

/*
 * The editor is Monaco, so its text is in a model rather than in a DOM value:
 * there is nothing to read with `.value` and nothing REACT_SETTERS can type
 * into. `window.squealEditor` is the seam the app exposes for exactly this.
 * Writing through it goes the same way a keystroke does -- the model change
 * fires the editor's own listener -- so React's state follows as it would.
 */
const editorText = `window.squealEditor.getValue()`;
const setEditorText = (sql: string) => `window.squealEditor.setValue(${JSON.stringify(sql)}); true;`;

/** A saved row by exact name -- `.includes` would match a longer neighbour. */
const savedRow = (name: string) => `
  [...document.querySelectorAll('.saved__row')]
    .find(e => e.querySelector('.saved__name').textContent === ${JSON.stringify(name)})`;

/**
 * Fills the connect form and submits. A blank `name` connects without saving.
 *
 * The launch screen is the list once anything is saved, so this steps through
 * "+ New connection" when it is showing -- a no-op when the form is already up.
 */
async function connect(cfg: typeof PG | typeof MYSQL, name = ''): Promise<void> {
  await app.reload();
  await app.evaluate(`document.querySelector('.saved__new')?.click(); true;`);
  await Bun.sleep(300);

  await app.evaluate(`${REACT_SETTERS}
    setSelect(document.querySelector('#type'), ${JSON.stringify(cfg.type)});
    true;`);
  await Bun.sleep(200);
  await app.evaluate(`${REACT_SETTERS}
    setNative(document.querySelector('#name'), ${JSON.stringify(name)});
    setNative(document.querySelector('#host'), ${JSON.stringify(cfg.host)});
    setNative(document.querySelector('#port'), ${JSON.stringify(String(cfg.port))});
    setNative(document.querySelector('#user'), ${JSON.stringify(cfg.user)});
    setNative(document.querySelector('#password'), ${JSON.stringify(cfg.password)});
    true;`);
  await Bun.sleep(200);
  await app.evaluate(`document.querySelector('.connect__submit').click(); true;`);
  await Bun.sleep(3000);
}

/**
 * Disconnect lives in the titlebar's File menu. The two steps cannot be one
 * evaluate: the list is only rendered once React has re-rendered the open menu,
 * so clicking the trigger and the item in the same turn finds nothing.
 */
async function disconnect(): Promise<void> {
  await app.evaluate(`document.querySelector('.menu__trigger').click(); true;`);
  await Bun.sleep(200);
  await app.evaluate(`
    [...document.querySelectorAll('.menu__item')]
      .find(e => e.textContent === 'Disconnect')
      .click(); true;`);
  await Bun.sleep(800);
}

describe.skipIf(!UI_ENABLED)('the real app', () => {
  beforeAll(async () => {
    app = await launchApp({ SQUEAL_DATA_DIR: DATA_DIR, SQUEAL_KEYCHAIN_SERVICE: KEYCHAIN_SERVICE });
  });

  afterAll(async () => {
    await app?.stop();
    // The keychain entry outlives both the app and the temp dir.
    await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name: 'connection-key' }).catch(() => undefined);
    // Best-effort: the extension is *designed* to outlive the app by up to the
    // heartbeat timeout, and until it exits it still holds connections.db open,
    // which Windows reports as EBUSY. A temp directory is not worth failing the
    // suite over -- the OS sweeps it up.
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      // Still held by the extension; it will go when the process does.
    }
  });

  describe('postgres', () => {
    beforeAll(async () => {
      await connect(PG);
    });

    test('connects and renders the shell', async () => {
      const shell = await app.evaluate<boolean>(`!!document.querySelector('.sidebar')`);
      if (!shell) {
        throw new Error(
          await app.evaluate<string>(`document.querySelector('.callout--error')?.textContent ?? 'no error shown'`)
        );
      }
      expect(shell).toBe(true);
    });

    test('lists databases', async () => {
      const dbs = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.tree__row')].map(e => e.querySelector('.tree__label')?.textContent)`
      );
      expect(dbs).toContain('shop');
    });

    test('expanding a database loads its tables', async () => {
      await app.evaluate(clickRow('db', 'shop'));
      await Bun.sleep(1500);
      const tables = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.tree__children .tree__label')].map(e => e.textContent)`
      );
      expect(tables).toContain('users');
      expect(tables).toContain('reporting.daily_stats');
    });

    test('clicking a table previews it', async () => {
      await app.evaluate(clickRow('table', 'users'));
      await Bun.sleep(2000);

      const sql = await app.evaluate<string>(editorText);
      expect(sql).toMatch(/SELECT \* FROM "users" LIMIT 100/);

      const headers = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.grid thead th')].map(e => e.textContent).filter(Boolean)`
      );
      expect(headers).toContain('email');

      const rows = await app.evaluate<number>(`document.querySelectorAll('.grid tbody tr').length`);
      expect(rows).toBe(2);
    });

    test('NULL is rendered distinctly, not as empty or "null"', async () => {
      expect(await app.evaluate<boolean>(`!!document.querySelector('.grid .null')`)).toBe(true);
    });

    test('Ctrl+Enter runs the editor contents', async () => {
      await app.evaluate(setEditorText('SELECT name, email FROM users ORDER BY id'));
      await Bun.sleep(200);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(1500);

      const headers = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.grid thead th')].map(e => e.textContent).filter(Boolean)`
      );
      expect(headers).toEqual(['name', 'email']);
    });

    /*
     * The point of reporting the dialect as data: nothing in the renderer maps
     * an engine to a grammar, so the only way to know this is wired is to ask
     * the editor which language it ended up in after a real connect.
     */
    test('highlights with the dialect the engine reported', async () => {
      expect(await app.evaluate<string>(`window.squealEditor.getModel().getLanguageId()`)).toBe('pgsql');
    });

    test('keywords are highlighted, not left as plain text', async () => {
      await app.evaluate(setEditorText("SELECT 'x' -- comment"));
      await Bun.sleep(400);
      // Monaco paints each token in its own span, so a themed keyword is a span
      // with a colour of its own. One undifferentiated run means no grammar ran.
      const colours = await app.evaluate<string[]>(`
        [...document.querySelectorAll('.view-lines .view-line span span')]
          .map(e => getComputedStyle(e).color)`);
      expect(new Set(colours).size).toBeGreaterThan(1);
    });

    test('find and replace is available over the editor text', async () => {
      await app.evaluate(setEditorText('SELECT id FROM users'));
      await Bun.sleep(200);
      await app.evaluate(`window.squealEditor.getAction('editor.action.startFindReplaceAction').run()`);
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(`!!document.querySelector('.find-widget.visible')`)).toBe(true);

      // Not just the widget: the action it exists for has to reach the text.
      await app.evaluate(`
        const c = window.squealEditor.getContribution('editor.contrib.findController');
        c.getState().change({ searchString: 'id', replaceString: 'email' }, false);
        c.replaceAll(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string>(editorText)).toBe('SELECT email FROM users');

      // `closeFindWidget` is a command rather than an editor action, so it is
      // triggered, not fetched -- getAction would hand back null.
      await app.evaluate(`window.squealEditor.trigger('test', 'closeFindWidget', null); true;`);
    });

    /*
     * There is no autocomplete yet, so nothing may be offered. Word-based
     * suggestions are on by default and would propose the identifiers already
     * typed -- a schema-blind guess dressed up as knowledge. Asking for
     * suggestions outright is the strongest way to prove they are gone.
     *
     * Count the rows, not the widget: explicitly triggering suggest always
     * shows it, in a "No suggestions." message state with nothing in it. The
     * widget being up is not the bug; something to click would be. `em` here
     * is the live bait -- `email` is on screen, so word-based would offer it.
     */
    test('nothing is suggested: word-based suggestions are off', async () => {
      await app.evaluate(setEditorText('SELECT email FROM users WHERE em'));
      await Bun.sleep(200);
      await app.evaluate(`
        window.squealEditor.setPosition({ lineNumber: 1, column: 33 });
        window.squealEditor.focus();
        window.squealEditor.getAction('editor.action.triggerSuggest').run(); true;`);
      await Bun.sleep(800);

      const rows = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.suggest-widget .monaco-list-row')].map(e => e.textContent)`
      );
      expect(rows).toEqual([]);
    });

    test('a SQL error is surfaced in the results pane', async () => {
      await app.evaluate(setEditorText('SELECT * FROM does_not_exist'));
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('.toolbar .btn--primary').click(); true;`);
      await Bun.sleep(1500);

      const err = await app.evaluate<string>(`document.querySelector('.note--error')?.textContent ?? ''`);
      expect(err).toMatch(/does_not_exist/);
    });

    test('selecting another database updates the context', async () => {
      await app.evaluate(clickRow('db', 'postgres'));
      await Bun.sleep(1200);
      const ctx = await app.evaluate<string>(`document.querySelector('.toolbar__context').textContent`);
      expect(ctx.trim()).toBe('postgres');
    });
  });

  describe('mysql', () => {
    beforeAll(async () => {
      await connect(MYSQL);
    });

    test('connects and shows the MySQL badge', async () => {
      expect(await app.evaluate<boolean>(`!!document.querySelector('.sidebar')`)).toBe(true);
      expect(await app.evaluate<string>(`document.querySelector('.badge').textContent`)).toBe('MySQL');
    });

    test('uses backtick quoting for previews', async () => {
      await app.evaluate(clickRow('db', 'shop'));
      await Bun.sleep(1500);
      await app.evaluate(clickRow('table', 'users'));
      await Bun.sleep(2000);

      const sql = await app.evaluate<string>(editorText);
      expect(sql).toContain('`users`');
    });

    // The same assertion the Postgres block makes, and the pair is the test:
    // one engine agreeing proves nothing, two disagreeing proves it is data.
    test('highlights with the dialect the engine reported', async () => {
      expect(await app.evaluate<string>(`window.squealEditor.getModel().getLanguageId()`)).toBe('mysql');
    });

    test('BIGINT past 2^53 reaches the grid intact', async () => {
      const cells = await app.evaluate<string[][]>(
        `[...document.querySelectorAll('.grid tbody tr')].map(tr =>
           [...tr.querySelectorAll('td')].slice(1).map(td => td.textContent))`
      );
      const headers = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.grid thead th')].map(e => e.textContent).filter(Boolean)`
      );
      expect(cells[0]![headers.indexOf('big')]).toBe('9007199254740993');
    });
  });

  /*
   * The window is borderless, so these buttons are the only way to maximise or
   * restore it. Asking Neutralino what the window actually did is the whole
   * point -- a test that only checked our own icon would pass while the window
   * sat there ignoring the click.
   */
  describe('titlebar', () => {
    /*
     * The frame paint is the one thing here the DOM cannot show: the band lives
     * in the non-client area. Asking the extension to do it again and requiring
     * `applied` proves the whole path -- pid found, window matched, and Windows
     * accepting the colour -- rather than that we sent a message.
     *
     * Windows-only by nature, and the suite only runs on Windows (helpers/app.ts).
     */
    test('the window frame is painted to match the app', async () => {
      const applied = await app.evaluate<boolean>(`
        (async () => {
          const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
          const res = await Neutralino.extensions.getStats();
          return new Promise((resolve) => {
            const reqId = 999001;
            const onReply = (e) => {
              if (e.detail?.reqId !== reqId) return;
              Neutralino.events.off('db.response', onReply);
              resolve(e.detail.ok && e.detail.data.applied === true);
            };
            Neutralino.events.on('db.response', onReply);
            Neutralino.extensions.dispatch('js.squeal.db', 'window.matchFrame', {
              reqId, pid: NL_PID, colour: bg,
            });
          });
        })()`);
      expect(applied).toBe(true);
    });

    // The bar is the only place the server is named now that the tree's header
    // stopped repeating it.
    test('names the connected server', async () => {
      expect(await app.evaluate<string>(`document.querySelector('.titlebar__title').textContent`))
        .toBe(`${MYSQL.user}@${MYSQL.host}:${MYSQL.port}`);
    });

    test('the maximise button maximises the real window, and restores it', async () => {
      const clickMaximise = `[...document.querySelectorAll('.titlebar__btn')][1].click(); true;`;

      await app.evaluate(clickMaximise);
      await Bun.sleep(600);
      expect(await app.evaluate<boolean>(`Neutralino.window.isMaximized()`)).toBe(true);

      await app.evaluate(clickMaximise);
      await Bun.sleep(600);
      expect(await app.evaluate<boolean>(`Neutralino.window.isMaximized()`)).toBe(false);
    });

    test('the File menu opens, and closes on Escape', async () => {
      // Disconnect is only offered with a session open; say so rather than
      // inherit it from whichever describe ran last.
      expect(await app.evaluate<boolean>(`!!document.querySelector('.sidebar')`)).toBe(true);

      await app.evaluate(`document.querySelector('.menu__trigger').click(); true;`);
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('.menu__item')].map(e => e.textContent)`))
        .toEqual(['Disconnect', 'Exit']);

      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true;`
      );
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('.menu__item').length`)).toBe(0);
    });
  });

  // The point of the feature: reach yesterday's database without retyping it.
  // These run last because they are the only ones that write to the store.
  describe('saved connections', () => {
    test('naming a connection saves it, and it survives a reload', async () => {
      await connect(PG, 'pg-fixture');
      expect(await app.evaluate<boolean>(`!!document.querySelector('.sidebar')`)).toBe(true);

      await app.reload();
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('.saved__name')].map(e => e.textContent)`))
        .toEqual(['pg-fixture']);
    });

    test('an unnamed connection is not saved', async () => {
      await connect(MYSQL);
      await app.reload();
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('.saved__name')].map(e => e.textContent)`))
        .toEqual(['pg-fixture']);
    });

    test('the row shows the server it will reach', async () => {
      const label = await app.evaluate<string>(`${savedRow('pg-fixture')}.querySelector('.saved__server').textContent`);
      expect(label).toContain(`${PG.user}@${PG.host}:${PG.port}`);
    });

    test('picking it connects with no password typed', async () => {
      await app.evaluate(`${savedRow('pg-fixture')}.querySelector('.saved__pick').click(); true;`);
      await Bun.sleep(3000);

      const shell = await app.evaluate<boolean>(`!!document.querySelector('.sidebar')`);
      if (!shell) {
        throw new Error(
          await app.evaluate<string>(`document.querySelector('.callout--error')?.textContent ?? 'no error shown'`)
        );
      }
      // It must be a real session, not just a routed screen.
      const dbs = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.tree__label')].map(e => e.textContent)`
      );
      expect(dbs).toContain('shop');
    });

    test('editing renames it in place', async () => {
      await disconnect();
      await Bun.sleep(400);

      await app.evaluate(`${savedRow('pg-fixture')}.querySelector('.saved__actions .btn').click(); true;`);
      await Bun.sleep(500);
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('#name'), 'pg-renamed'); true;`);
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('.connect__submit').click(); true;`);
      await Bun.sleep(1500);

      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('.saved__name')].map(e => e.textContent)`))
        .toEqual(['pg-renamed']);
    });

    test('the kept password still connects after an edit that never saw it', async () => {
      await app.evaluate(`${savedRow('pg-renamed')}.querySelector('.saved__pick').click(); true;`);
      await Bun.sleep(3000);
      expect(await app.evaluate<boolean>(`!!document.querySelector('.sidebar')`)).toBe(true);
      await disconnect();
    });

    test('deleting asks first, then removes it', async () => {
      // The second action button is Delete; it confirms in place rather than in a dialog.
      await app.evaluate(`${savedRow('pg-renamed')}.querySelectorAll('.saved__actions .btn')[1].click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string>(`${savedRow('pg-renamed')}.querySelector('.saved__hint').textContent`))
        .toBe('Delete?');

      await app.evaluate(`${savedRow('pg-renamed')}.querySelectorAll('.saved__actions .btn')[0].click(); true;`);
      await Bun.sleep(800);
      expect(await app.evaluate<number>(`document.querySelectorAll('.saved__row').length`)).toBe(0);
    });
  });
});
