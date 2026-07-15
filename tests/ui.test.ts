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

import { launchApp, REACT_SETTERS, type AppSession } from './helpers/app.ts';
import { MYSQL, PG } from './fixtures/config.ts';

const UI_ENABLED = process.env.SQUEAL_UI === '1';

let app: AppSession;

/** Tree rows: databases have a caret glyph, tables have an empty one. */
const clickRow = (kind: 'db' | 'table', label: string) => `
  [...document.querySelectorAll('.tree__row')]
    .filter(e => ${kind === 'db' ? "e.closest('.tree__children') === null" : "e.closest('.tree__children') !== null"})
    .find(e => e.querySelector('.tree__label').textContent === ${JSON.stringify(label)})
    .click(); true;`;

async function connect(cfg: typeof PG | typeof MYSQL): Promise<void> {
  await app.reload();
  await app.evaluate(`${REACT_SETTERS}
    setSelect(document.querySelector('#type'), ${JSON.stringify(cfg.type)});
    true;`);
  await Bun.sleep(200);
  await app.evaluate(`${REACT_SETTERS}
    setNative(document.querySelector('#host'), ${JSON.stringify(cfg.host)});
    setNative(document.querySelector('#port'), ${JSON.stringify(String(cfg.port))});
    setNative(document.querySelector('#user'), ${JSON.stringify(cfg.user)});
    setNative(document.querySelector('#password'), ${JSON.stringify(cfg.password)});
    true;`);
  await Bun.sleep(200);
  await app.evaluate(`document.querySelector('.connect__submit').click(); true;`);
  await Bun.sleep(3000);
}

describe.skipIf(!UI_ENABLED)('the real app', () => {
  beforeAll(async () => {
    app = await launchApp();
  });

  afterAll(async () => {
    await app?.stop();
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

      const sql = await app.evaluate<string>(`document.querySelector('.editor').value`);
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
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('.editor'), 'SELECT name, email FROM users ORDER BY id'); true;`);
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

    test('a SQL error is surfaced in the results pane', async () => {
      await app.evaluate(
        `${REACT_SETTERS} setNative(document.querySelector('.editor'), 'SELECT * FROM does_not_exist'); true;`
      );
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

      const sql = await app.evaluate<string>(`document.querySelector('.editor').value`);
      expect(sql).toContain('`users`');
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
});
