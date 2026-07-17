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

/** The tree is one database's tables, flat: a row is a table and nothing else. */
const clickTable = (label: string) => `
  [...document.querySelectorAll('.tree__row')]
    .find(e => e.querySelector('.tree__label').textContent === ${JSON.stringify(label)})
    .click(); true;`;

/** The database is picked from a select now, so React's own setter is the way in. */
const selectDatabase = (name: string) => `${REACT_SETTERS}
  setSelect(document.querySelector('.sidebar__head .select'), ${JSON.stringify(name)});
  true;`;

/** The rail, top to bottom: one mark per open connection. */
const railMarks = `[...document.querySelectorAll('.rail__mark')].map(e => e.textContent)`;
/** The environment travels as data, so the test reads the fact and not a colour. */
const railEnvs = `[...document.querySelectorAll('.rail__item')].map(e => e.dataset.env)`;
const activeRail = `
  [...document.querySelectorAll('.rail__item')]
    .findIndex(e => e.classList.contains('rail__item--active'))`;
const clickRail = (i: number) => `document.querySelectorAll('.rail__item')[${i}].click(); true;`;

/** The tab strip, left to right. */
const tabLabels = `[...document.querySelectorAll('.tabs__label')].map(e => e.textContent)`;
const activeTabLabel = `document.querySelector('.tabs__tab--active .tabs__label')?.textContent ?? ''`;

/** Tabs are matched on exact label text, same rule as every other selector here. */
const tab = (label: string) => `
  [...document.querySelectorAll('.tabs__tab')]
    .find(e => e.querySelector('.tabs__label').textContent === ${JSON.stringify(label)})`;
const clickTab = (label: string) => `${tab(label)}.querySelector('.tabs__pick').click(); true;`;
const closeTab = (label: string) => `${tab(label)}.querySelector('.tabs__close').click(); true;`;
const newTab = `document.querySelector('.tabs__new').click(); true;`;

/*
 * The editor is Monaco, so its text is in a model rather than in a DOM value:
 * there is nothing to read with `.value` and nothing REACT_SETTERS can type
 * into. `window.squealEditor` is the seam the app exposes for exactly this.
 * Writing through it goes the same way a keystroke does -- the model change
 * fires the editor's own listener -- so React's state follows as it would.
 *
 * Still one editor with tabs: they swap the model underneath it. It holds no
 * model at all while a grid tab is showing, which is why the reads below guard.
 */
const editorText = `window.squealEditor.getModel()?.getValue() ?? null`;
const setEditorText = (sql: string) => `window.squealEditor.setValue(${JSON.stringify(sql)}); true;`;

/**
 * Types a query, puts the cursor where the `|` was, and reads the popup's labels.
 *
 * Three things here are the test earning its keep rather than ceremony:
 *
 * - **The `|` marks the cursor**, because every one of these assertions is about
 *   a position and a hardcoded column number is a magic number that silently
 *   stops meaning the same place the moment the query beside it is edited.
 * - **The sleep before triggering is not padding.** The columns of anything in
 *   the FROM are fetched over the bridge off the text changing, so the round
 *   trip has to land before the popup is asked what it knows.
 * - **The labels are read, not the row text.** A row's `textContent` is the
 *   label *and* its type detail run together, so `.includes` on it would match
 *   far too much -- and the labels come back as exact strings, which is what
 *   lets these use `toContain` and mean it. `active_users` matching a search for
 *   `users` is a mistake this suite has already made once.
 */
async function suggest(sql: string): Promise<string[]> {
  const column = sql.indexOf('|') + 1;
  await app.evaluate(setEditorText(sql.replace('|', '')));
  await Bun.sleep(1200);

  await app.evaluate(`
    window.squealEditor.setPosition({ lineNumber: 1, column: ${column} });
    window.squealEditor.focus();
    window.squealEditor.getAction('editor.action.triggerSuggest').run(); true;`);
  await Bun.sleep(800);

  return app.evaluate<string[]>(`
    [...document.querySelectorAll('.suggest-widget .monaco-list-row .label-name')]
      .map(e => e.textContent)`);
}

/** The results bar's label: which table, and which rows of it are on screen. */
const barText = `document.querySelector('.results__bar span').textContent`;

/** Prev/Next carry an icon beside the word, so match the trimmed text. */
const pagerBtn = (label: 'Prev' | 'Next') => `
  [...document.querySelectorAll('.results__pager .btn')]
    .find(e => e.textContent.trim() === ${JSON.stringify(label)})`;

/** A saved row by exact name -- `.includes` would match a longer neighbour. */
const savedRow = (name: string) => `
  [...document.querySelectorAll('.saved__row')]
    .find(e => e.querySelector('.saved__name').textContent === ${JSON.stringify(name)})`;

/**
 * Fills the connect form and submits. A blank `name` connects without saving.
 *
 * The launch screen is the list once anything is saved, so this steps through
 * "+ New connection" when it is showing -- a no-op when the form is already up.
 * With one workspace the picker is skipped, so there is never a step for it
 * here; the workspace describe is what drives that screen.
 */
async function fillConnectForm(
  cfg: typeof PG | typeof MYSQL,
  name = '',
  environment?: string
): Promise<void> {
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

  if (environment) {
    // Asked for whether or not the connection will be saved: it is the rail's
    // colour now, not only a heading in a list an unnamed one never joins.
    await app.evaluate(`${REACT_SETTERS}
      setSelect(document.querySelector('#environment'), ${JSON.stringify(environment)});
      true;`);
    await Bun.sleep(200);
  }

  await app.evaluate(`document.querySelector('.connect__submit').click(); true;`);
  await Bun.sleep(3000);
}

async function connect(cfg: typeof PG | typeof MYSQL, name = '', environment?: string): Promise<void> {
  await app.reload();
  await fillConnectForm(cfg, name, environment);
}

/**
 * Opens a *second* connection, leaving the first one open -- the rail's "+",
 * which is the only route to the connect screen that does not go through a
 * reload. Deliberately not `connect`: reloading is what this must not do.
 */
async function addConnection(
  cfg: typeof PG | typeof MYSQL,
  name = '',
  environment?: string
): Promise<void> {
  await app.evaluate(`document.querySelector('.rail__add').click(); true;`);
  await Bun.sleep(500);
  await fillConnectForm(cfg, name, environment);
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

    test('opens on one editor tab', async () => {
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1']);
    });

    test('offers the databases in the picker', async () => {
      const dbs = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.sidebar__head .select option')].map(e => e.textContent)`
      );
      expect(dbs).toContain('shop');
    });

    test('picking a database lists its tables', async () => {
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      const tables = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.tree__label')].map(e => e.textContent)`
      );
      expect(tables).toContain('users');
      expect(tables).toContain('reporting.daily_stats');
    });

    /*
     * The point of the whole feature: clicking a table no longer eats the query
     * being written. It opens a grid tab of its own instead, and the editor tab
     * is still sitting there with its text.
     *
     * The sentinel is the whole test. It is checked *after* switching back --
     * while the grid tab is up there is no model attached at all, which is the
     * other half of what "the editor is not on this tab" has to mean.
     */
    test('clicking a table opens a grid tab, leaving the editor tab alone', async () => {
      await app.evaluate(setEditorText('SELECT 1 -- still being written'));
      await Bun.sleep(200);

      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'users']);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('users');

      const headers = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.grid thead th')].map(e => e.textContent).filter(Boolean)`
      );
      expect(headers).toContain('email');
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid tbody tr').length`)).toBe(2);

      // A grid tab spends none of the screen on an editor nobody asked for.
      expect(await app.evaluate<boolean>(`!!document.querySelector('.main--grid')`)).toBe(true);
      expect(await app.evaluate<string | null>(editorText)).toBe(null);

      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);
      expect(await app.evaluate<string | null>(editorText)).toBe('SELECT 1 -- still being written');
    });

    test('each tab keeps its own text', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'users', 'Query 2']);

      await app.evaluate(setEditorText('SELECT 2 -- the second tab'));
      await Bun.sleep(300);

      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);
      expect(await app.evaluate<string | null>(editorText)).toBe('SELECT 1 -- still being written');

      await app.evaluate(clickTab('Query 2'));
      await Bun.sleep(400);
      expect(await app.evaluate<string | null>(editorText)).toBe('SELECT 2 -- the second tab');

      await app.evaluate(closeTab('Query 2'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'users']);
    });

    /*
     * Results are per tab, or switching tabs paints the last tab's rows under
     * this one's query. Two tabs holding different grids at once is the only way
     * to see that they are actually separate.
     */
    test('each tab keeps its own results', async () => {
      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(300);
      await app.evaluate(setEditorText('SELECT 42 AS answer'));
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('.toolbar .btn--primary').click(); true;`);
      await Bun.sleep(1500);

      const headers = `[...document.querySelectorAll('.grid thead th')].map(e => e.textContent).filter(Boolean)`;
      expect(await app.evaluate<string[]>(headers)).toEqual(['answer']);

      // The grid tab still holds the table it browsed, not this query's row.
      await app.evaluate(clickTab('users'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(headers)).toContain('email');

      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(headers)).toEqual(['answer']);
    });

    test('closing the last tab leaves an empty state', async () => {
      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
      await app.evaluate(closeTab('Query 1'));
      await Bun.sleep(400);

      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
      const note = await app.evaluate<string>(`document.querySelector('.results .note--muted')?.textContent ?? ''`);
      expect(note).toContain('Nothing open');
    });

    /*
     * The empty state has to have a way out of it, and `+` is the only one.
     *
     * There is no active tab to inherit a database from, so the tab opens on the
     * session's default -- and this asserts the *user-visible* consequences of
     * that (an enabled picker, a listed tree) rather than the state behind them.
     * `setSelect` would sail straight past a disabled picker: React's onChange
     * fires for a synthetic `change` event that no real click could produce, so
     * a test driving the picker that way passed while the app stranded you here.
     */
    test('a new tab from the empty state lands on a database', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(1500);

      // Not stranded: the picker names a real database and can be used.
      expect(await app.evaluate<boolean>(`document.querySelector('.sidebar__head .select').disabled`)).toBe(false);
      const picked = await app.evaluate<string>(`document.querySelector('.sidebar__head .select').value`);
      expect(picked).not.toBe('');
      const options = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.sidebar__head .select option')].map(e => e.value)`
      );
      expect(options).toContain(picked);

      // The tree answered for that database, rather than sitting blank because
      // nothing was ever fetched. "No tables" is a real answer -- the session
      // opens on the server's first database, which for Postgres is the empty
      // maintenance one -- so this asks for an answer, not for rows.
      expect(
        await app.evaluate<boolean>(
          `document.querySelectorAll('.tree__row').length > 0 || !!document.querySelector('.tree__note')`
        )
      ).toBe(true);

      // And the picker actually moves it -- back to somewhere the rest of the
      // block can work from.
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      const tables = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.tree__label')].map(e => e.textContent)`
      );
      expect(tables).toContain('users');
    });

    test('clicking a table twice opens a tab each time', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(1500);
      await app.evaluate(clickTable('users'));
      await Bun.sleep(1500);

      // Deliberately not deduped: comparing one table before and after a write
      // is the whole reason to open it twice.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 3', 'users', 'users']);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    // Two rows is under a page, so there is nowhere to go and nothing to offer.
    test('a table that fits on one page has no pager', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(`document.querySelectorAll('.results__pager').length`)).toBe(0);
      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('a table larger than a page pages forward and back', async () => {
      await app.evaluate(clickTable('events'));
      await Bun.sleep(2000);

      expect(await app.evaluate<string>(barText)).toContain('rows 1–100');
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid tbody tr').length`)).toBe(100);
      // Nothing before row 1.
      expect(await app.evaluate<boolean>(`${pagerBtn('Prev')}.disabled`)).toBe(true);

      await app.evaluate(`${pagerBtn('Next')}.click(); true;`);
      await Bun.sleep(1500);

      // 150 rows: the last page is the remainder, and the gutter counts from
      // where the page starts rather than calling this row 1 all over again.
      expect(await app.evaluate<string>(barText)).toContain('rows 101–150');
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid tbody tr').length`)).toBe(50);
      expect(await app.evaluate<string>(`document.querySelector('.grid tbody td.gutter').textContent`)).toBe('101');
      expect(await app.evaluate<boolean>(`${pagerBtn('Next')}.disabled`)).toBe(true);

      await app.evaluate(`${pagerBtn('Prev')}.click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(barText)).toContain('rows 1–100');

      await app.evaluate(closeTab('events'));
      await Bun.sleep(300);
    });

    test('NULL is rendered distinctly, not as empty or "null"', async () => {
      // Browse `users` in a tab of its own rather than inheriting whatever the
      // last test left in the grid: Grace's NULL email is the subject, and a
      // neighbour paging away to another table should fail that test, not this.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<boolean>(`!!document.querySelector('.grid .null')`)).toBe(true);
    });

    /*
     * A grid tab has nothing to run, and the editor pane is still mounted
     * underneath it -- one Monaco, every tab's model hanging off it -- so its
     * window listener is live and has to refuse for itself. The `users` grid tab
     * from the test above is still active, which is the case being made.
     */
    test('Ctrl+Enter does nothing on a grid tab', async () => {
      const before = await app.evaluate<string>(barText);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(1000);
      expect(await app.evaluate<string>(barText)).toBe(before);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
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

      // The grid now holds SQL the user wrote, and the extension will not
      // rewrite that to reach page 2 -- so there is no page 2 to offer.
      expect(await app.evaluate<number>(`document.querySelectorAll('.results__pager').length`)).toBe(0);
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

    test('the dialect\'s keywords are suggested', async () => {
      // ILIKE is Postgres', and the mysql describe asserts its absence: between
      // them, that is the proof the words come from the dialect the engine
      // reported rather than from one list of SQL-ish words up here.
      expect(await suggest('SELECT * FROM users WHERE name ILIK|')).toContain('ILIKE');
    });

    test('the database\'s tables are suggested', async () => {
      expect(await suggest('SELECT * FROM user|')).toContain('users');
    });

    test('a table\'s columns are suggested after its alias and a dot', async () => {
      // The alias is only knowable from the FROM further along the line, which
      // is the whole of what the scan is for.
      expect(await suggest('SELECT u.| FROM users u')).toContain('email');
    });

    test('a table\'s columns are suggested after its name and a dot', async () => {
      expect(await suggest('SELECT users.| FROM users')).toContain('email');
    });

    test('columns of a table in the FROM are suggested unqualified', async () => {
      // The case the feature is actually for: the FROM has already said which
      // table this is about, so `ema` is enough.
      expect(await suggest('SELECT ema| FROM users')).toContain('email');
    });

    test('a schema-qualified relation completes on its columns', async () => {
      // `reporting.daily_stats.` is a relation and a dot, not an alias and two
      // dots -- the one case where the qualifier itself contains one.
      expect(await suggest('SELECT reporting.daily_stats.| FROM reporting.daily_stats')).toContain('hits');
    });

    test('a quoted schema-qualified relation completes through its alias', async () => {
      // Each half quotes itself, which is ordinary Postgres and is the case a
      // pattern allowing only the whole name to be quoted reads as the schema
      // alone -- leaving the alias pointing at nothing. The name also has to
      // come out of the scan as `reporting.daily_stats`, the spelling the
      // catalog answers for, or the columns are fetched for a table that is not
      // there.
      expect(await suggest('SELECT d.| FROM "reporting"."daily_stats" d')).toContain('hits');
    });

    /*
     * The rule that survived autocomplete arriving, and the reason it is still
     * worth a test: word-based suggestions offer the identifiers already in the
     * document, which is a guess about a schema Monaco has never read. Now that
     * there are real suggestions to hide among, the bait has to be a word that
     * no keyword and no catalog could account for -- if `zzz_bait` is ever
     * offered, it can only have come from the document.
     */
    test('a word in the document is never suggested for being there', async () => {
      const rows = await suggest('SELECT * FROM users WHERE zzz_bait = 1 AND zzz|');
      expect(rows).not.toContain('zzz_bait');
    });

    test('a SQL error is surfaced in the results pane', async () => {
      await app.evaluate(setEditorText('SELECT * FROM does_not_exist'));
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('.toolbar .btn--primary').click(); true;`);
      await Bun.sleep(1500);

      const err = await app.evaluate<string>(`document.querySelector('.note--error')?.textContent ?? ''`);
      expect(err).toMatch(/does_not_exist/);
    });

    /*
     * The database binds to a tab, not to the connection: this is the assertion
     * the whole `tabsSlice` shape exists for. Moving one tab must leave the
     * other where it was -- switching database to check one thing cannot drag
     * every other tab along with it.
     */
    test('the database picker moves the active tab and no other', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      const second = await app.evaluate<string>(activeTabLabel);

      await app.evaluate(selectDatabase('postgres'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string>(`document.querySelector('.sidebar__head .select').value`)).toBe('postgres');

      // Back to the first tab: it never moved, so the picker still reads `shop`
      // and the tree is still showing shop's tables.
      await app.evaluate(clickTab('Query 3'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string>(`document.querySelector('.sidebar__head .select').value`)).toBe('shop');
      const tables = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.tree__label')].map(e => e.textContent)`
      );
      expect(tables).toContain('users');

      await app.evaluate(closeTab(second));
      await Bun.sleep(300);
    });

    /*
     * A grid tab is "this table, wherever I am pointed", so moving it re-browses
     * the same name in the new database -- and when it does not live there, the
     * error lands in this tab's own grid, which is where the action was taken.
     */
    test('moving a grid tab to a database without that table errors in that tab', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<string>(barText)).toContain('users');

      await app.evaluate(selectDatabase('postgres'));
      await Bun.sleep(2000);
      const err = await app.evaluate<string>(`document.querySelector('.note--error')?.textContent ?? ''`);
      expect(err).toMatch(/users/);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1200);
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

    /*
     * The page SQL and its quoting are the extension's now, so there is no text
     * up here to assert on -- `tests/extension.test.ts` checks the backticks
     * against the real server. What the UI can still prove is the part that
     * matters here: clicking a table fills the grid on this engine too.
     */
    test('clicking a table browses it', async () => {
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      const headers = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.grid thead th')].map(e => e.textContent).filter(Boolean)`
      );
      expect(headers).toContain('email');
    });

    /*
     * The same assertion the Postgres block makes, and the pair is the test: one
     * engine agreeing proves nothing, two disagreeing proves it is data.
     *
     * Asked of a tab opened *after* the connect, and of a model that has been
     * sitting in the background: the dialect has to reach every model, not just
     * whichever one was attached when the engine reported it.
     */
    test('highlights with the dialect the engine reported', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      expect(await app.evaluate<string>(`window.squealEditor.getModel().getLanguageId()`)).toBe('mysql');

      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);
      expect(await app.evaluate<string>(`window.squealEditor.getModel().getLanguageId()`)).toBe('mysql');

      // Hand the next test back the grid it is about.
      await app.evaluate(closeTab('Query 2'));
      await Bun.sleep(300);
      await app.evaluate(clickTab('users'));
      await Bun.sleep(400);
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

    /*
     * The other half of the Postgres block's ILIKE assertion, and the pair is
     * the test: one engine offering a word proves a list exists somewhere, two
     * engines offering *different* words proves the list is the dialect's.
     *
     * ILIKE is Postgres-only, so MySQL must not offer it -- while still being a
     * working editor that offers the words MySQL does have. Asserting only the
     * absence would also pass if completion were simply broken here.
     */
    test('the keywords follow the engine, not one list of SQL words', async () => {
      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);

      const rows = await suggest('SELECT * FROM users WHERE name LIK|');
      expect(rows).toContain('LIKE');
      expect(rows).not.toContain('ILIKE');
    });

    test('completes on this engine\'s own catalog', async () => {
      // `big` exists in MySQL's `users` and not in Postgres', so this is the
      // column list coming from the server actually connected to.
      expect(await suggest('SELECT bi| FROM users')).toContain('big');
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
        `[...document.querySelectorAll('.sidebar__head .select option')].map(e => e.textContent)`
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

  // Late on purpose: these leave a second workspace behind for most of their
  // run, and every describe above is written against a launch screen that skips
  // the picker. They end on a single empty workspace, which is what the describe
  // below then launches into.
  describe('workspaces', () => {
    const groupLabels = `[...document.querySelectorAll('.ws-group > .label')].map(e => e.textContent)`;
    const names = `[...document.querySelectorAll('.saved__name')].map(e => e.textContent)`;

    test('one workspace is skipped, and the bar names the one you are in', async () => {
      await connect(PG, 'ws-local');
      await disconnect();
      await Bun.sleep(400);

      // Straight to the connections: nothing was picked on the way in.
      expect(await app.evaluate<string>(`document.querySelector('.ws-bar__name').textContent`)).toBe('Default');
      expect(await app.evaluate<string[]>(names)).toEqual(['ws-local']);
    });

    test('connections sit under their environment, and empty ones are absent', async () => {
      expect(await app.evaluate<string[]>(groupLabels)).toEqual(['Local']);

      await connect(PG, 'ws-prod', 'production');
      await disconnect();
      await Bun.sleep(400);

      // Local before Production, and no headings for the two nobody used.
      expect(await app.evaluate<string[]>(groupLabels)).toEqual(['Local', 'Production']);
      expect(await app.evaluate<string[]>(names)).toEqual(['ws-local', 'ws-prod']);
    });

    test('the bar is the way to the picker, which is how a second one is made', async () => {
      await app.evaluate(`document.querySelector('.ws-bar').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(names)).toEqual(['Default']);

      await app.evaluate(`document.querySelector('.saved__new').click(); true;`);
      await Bun.sleep(400);
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('#workspace-name'), 'Acme'); true;`);
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('.connect__submit').click(); true;`);
      await Bun.sleep(1000);

      // A new workspace is empty, so it opens on the form rather than an empty box.
      expect(await app.evaluate<boolean>(`!!document.querySelector('#host')`)).toBe(true);
    });

    test('a second workspace makes the picker the way in, counting what each holds', async () => {
      await app.reload();
      await Bun.sleep(600);

      expect(await app.evaluate<string[]>(names)).toEqual(['Acme', 'Default']);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('.ws__count')].map(e => e.textContent)`))
        .toEqual(['0 connections', '2 connections']);
    });

    test('deleting one says what it will cost, then takes its connections with it', async () => {
      // The second action is Delete; the first is Edit, as on a connection row.
      await app.evaluate(`${savedRow('Default')}.querySelectorAll('.saved__actions .btn')[1].click(); true;`);
      await Bun.sleep(400);
      // The confirmation names the count because the connections go too -- and
      // their stored passwords with them.
      expect(await app.evaluate<string>(`${savedRow('Default')}.querySelector('.saved__hint').textContent`))
        .toBe('Delete with its 2 connections?');

      await app.evaluate(`${savedRow('Default')}.querySelectorAll('.saved__actions .btn')[0].click(); true;`);
      await Bun.sleep(800);
      expect(await app.evaluate<string[]>(names)).toEqual(['Acme']);

      // Back to one workspace, so the picker is skipped again -- and Acme is
      // empty, so the form is the screen, exactly as on a first run.
      await app.reload();
      await Bun.sleep(600);
      expect(await app.evaluate<boolean>(`!!document.querySelector('#host')`)).toBe(true);

      // Default's two connections went with it rather than being orphaned onto
      // Acme, which is the assertion the cascade is actually for.
      await app.evaluate(`
        [...document.querySelectorAll('.connect__actions .btn')]
          .find(e => e.textContent === 'Cancel').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('.ws__count')].map(e => e.textContent)`))
        .toEqual(['0 connections']);
    });

    test('the last workspace offers no Delete at all', async () => {
      // Refusing it in the store is the guarantee; not offering it is what keeps
      // the user from ever meeting the refusal.
      expect(await app.evaluate<string[]>(
        `[...${savedRow('Acme')}.querySelectorAll('.saved__actions .btn')].map(e => e.textContent)`
      )).toEqual(['Edit']);
    });
  });

  /*
   * Two servers at once. It runs after `workspaces` because it needs what that
   * one leaves -- a single empty workspace, so the picker is skipped and the
   * form is the launch screen -- and because it is the only describe here that
   * ends with more than one connection open.
   *
   * The two fixtures are what make this testable at all: both seed a database
   * called `shop`, and only Postgres's has a table in a second schema. That is
   * the collision, and it is a real one rather than a contrived name.
   */
  describe('multiple connections', () => {
    const treeLabels = `[...document.querySelectorAll('.tree__label')].map(e => e.textContent)`;

    beforeAll(async () => {
      await connect(PG, 'Shop dev', 'dev');
      await addConnection(MYSQL, 'Shop prod', 'production');
    });

    test('the rail lists both, in the order they were opened', async () => {
      expect(await app.evaluate<string[]>(railMarks)).toEqual(['SD', 'SP']);
    });

    test('each is coloured by its environment', async () => {
      // The fact, not the colour: CSS picks the hue off this, so asserting the
      // computed pixel would test the stylesheet rather than the app.
      expect(await app.evaluate<string[]>(railEnvs)).toEqual(['dev', 'production']);
    });

    test('opening the second lands you on it, and the titlebar follows', async () => {
      expect(await app.evaluate<number>(activeRail)).toBe(1);
      // The rail says which; the titlebar says what. Neither repeats the other.
      expect(await app.evaluate<string>(`document.querySelector('.titlebar__title').textContent`))
        .toBe(`${MYSQL.user}@${MYSQL.host}:${MYSQL.port}`);
    });

    test('each connection keeps its own tabs, numbered from its own Query 1', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Query 2']);

      // The first connection still has exactly the tab it had -- opening the
      // second did not close it, which is the whole point of the feature. And it
      // is Query 1: a second server's numbering is its own.
      await app.evaluate(clickRail(0));
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1']);
    });

    test('switching back restores the tab you were on, not the first one', async () => {
      await app.evaluate(clickRail(1));
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Query 2']);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('Query 2');
    });

    /*
     * The bug the tree's cache was re-keyed for. Both connections hold a `shop`,
     * so keyed by database alone the second one to ask reads the first one's
     * answer -- silently, and against a different engine entirely.
     */
    test("two connections holding a database called 'shop' do not share its tables", async () => {
      await app.evaluate(clickRail(0));
      await Bun.sleep(400);
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1800);
      expect(await app.evaluate<string[]>(treeLabels)).toContain('reporting.daily_stats');

      await app.evaluate(clickRail(1));
      await Bun.sleep(400);
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1800);
      const mysql = await app.evaluate<string[]>(treeLabels);
      // MySQL's shop has a `users`, so the tree did fetch and did answer...
      expect(mysql).toContain('users');
      // ...and it answered for MySQL. Postgres's schema-qualified table is the
      // proof: there is no such thing here, so its presence would mean this tree
      // had read the other connection's cache.
      expect(mysql).not.toContain('reporting.daily_stats');
    });

    test("each connection's tab runs against that connection", async () => {
      // Still on Shop prod (MySQL) from the test above.
      await app.evaluate(setEditorText('SELECT VERSION() AS v'));
      await Bun.sleep(200);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(1800);
      const mysql = await app.evaluate<string>(`document.querySelector('.grid tbody td:not(.gutter)').textContent`);
      expect(mysql).toContain('8.');

      await app.evaluate(clickRail(0));
      await Bun.sleep(500);
      await app.evaluate(setEditorText('SELECT version() AS v'));
      await Bun.sleep(200);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(1800);
      const pg = await app.evaluate<string>(`document.querySelector('.grid tbody td:not(.gutter)').textContent`);
      expect(pg).toContain('PostgreSQL');
    });

    test('disconnecting one leaves the other open, and lands you on it', async () => {
      // Disconnect is the titlebar's, and it has always meant the one in front.
      // Shop dev is in front, from the test above.
      await disconnect();
      await Bun.sleep(600);

      expect(await app.evaluate<string[]>(railMarks)).toEqual(['SP']);
      expect(await app.evaluate<number>(activeRail)).toBe(0);
      // Its tabs are still its own, and still both of them: closing one
      // connection is not closing the app.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Query 2']);
      expect(await app.evaluate<string>(`document.querySelector('.titlebar__title').textContent`))
        .toBe(`${MYSQL.user}@${MYSQL.host}:${MYSQL.port}`);
    });

    test('disconnecting the last one is the way back to the connect screen', async () => {
      await disconnect();
      await Bun.sleep(600);
      expect(await app.evaluate<boolean>(`!!document.querySelector('.rail')`)).toBe(false);
      expect(await app.evaluate<boolean>(`!!document.querySelector('.saved__row, #host')`)).toBe(true);
    });
  });
});
