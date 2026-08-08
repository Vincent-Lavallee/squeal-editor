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

import { $ } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { launchApp, REACT_SETTERS, type AppSession } from './helpers/app.ts';
import { MYSQL, PG, PG_CONTAINER } from './fixtures/config.ts';

const UI_ENABLED = process.env.SQUEAL_UI === '1';

/**
 * The app under test must not read, write or delete the saved connections
 * belonging to whoever is running this. Both are inherited by the extension
 * through `neu run`.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'squeal-ui-'));
const KEYCHAIN_SERVICE = `squeal-ui-test-${Bun.randomUUIDv7()}`;

let app: AppSession;

/** A tree row is a table now: a chevron that reveals its columns, plus the name
    that browses. Clicking the name is what opens the grid. */
const clickTable = (label: string) => `
  [...document.querySelectorAll('[data-testid="tree-row"]')]
    .find(e => e.querySelector('[data-testid="tree-label"]').textContent === ${JSON.stringify(label)})
    .querySelector('[data-testid="tree-name"]').click(); true;`;

/** The chevron is the other half of the row: it reveals the columns in place. */
const toggleTable = (label: string) => `
  [...document.querySelectorAll('[data-testid="tree-row"]')]
    .find(e => e.querySelector('[data-testid="tree-label"]').textContent === ${JSON.stringify(label)})
    .querySelector('[data-testid="tree-toggle"]').click(); true;`;

/** The one item whose name is `label`, so its revealed columns can be read. */
const treeItem = (label: string) => `
  [...document.querySelectorAll('[data-testid="tree-item"]')]
    .find(e => e.querySelector('[data-testid="tree-label"]')?.textContent === ${JSON.stringify(label)})`;

/** Every relation label in the tree, grouped or flat. */
const treeLabels = `[...document.querySelectorAll('[data-testid="tree-label"]')].map(e => e.textContent)`;

/** The schema headings, top to bottom. Empty when the tree is flat. */
const schemaLabels = `[...document.querySelectorAll('[data-testid="tree-schema-label"]')].map(e => e.textContent)`;

/** The relations under one schema heading, so a group can be read on its own. */
const treeLabelsIn = (schema: string) => `
  [...[...document.querySelectorAll('[data-testid="tree-schema"]')]
    .find(e => e.querySelector('[data-testid="tree-schema-label"]').textContent === ${JSON.stringify(schema)})
    .querySelectorAll('[data-testid="tree-label"]')].map(e => e.textContent)`;

/**
 * The function rows drawn anywhere in the tree. They answer to testids of their
 * own, never `tree-label`, so `treeLabelsIn` above stays a question about
 * relations -- which is what its tables-above-views assertion depends on.
 */
const functionLabels = `[...document.querySelectorAll('[data-testid="tree-function-label"]')].map(e => e.textContent)`;

const toggleFunctions = `
  document.querySelector('[data-testid="tree-functions-row"]').click(); true;`;

const toggleSchema = (schema: string) => `
  [...document.querySelectorAll('[data-testid="tree-schema-row"]')]
    .find(e => e.querySelector('[data-testid="tree-schema-label"]').textContent === ${JSON.stringify(schema)})
    .click(); true;`;

/** Type into the tree's filter, or clear it with an empty string. */
const setFilter = (text: string) =>
  `${REACT_SETTERS} setNative(document.querySelector('[data-testid="sidebar-filter"]'), ${JSON.stringify(text)}); true;`;

/**
 * The sidebar's *keep the tree on the tab's database* toggle. `aria-pressed` is
 * what says which way it is set -- the glyph never changes, only its colour.
 */
const clickSyncToggle = `document.querySelector('[data-testid="sidebar-sync-toggle"]').click(); true;`;
const syncToggleOn = `document.querySelector('[data-testid="sidebar-sync-toggle"]').getAttribute('aria-pressed') === 'true'`;
const syncToggleExists = `!!document.querySelector('[data-testid="sidebar-sync-toggle"]')`;

/** Summon the context menu on a row, at its own top-left corner. */
const rightClickTable = (label: string) => `
  (() => {
    const row = [...document.querySelectorAll('[data-testid="tree-row"]')]
      .find(e => e.querySelector('[data-testid="tree-label"]').textContent === ${JSON.stringify(label)});
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    return true;
  })()`;

/** The menu's items, top to bottom. */
const menuItemLabels = `[...document.querySelectorAll('[data-testid="context-menu-item"]')].map(e => e.textContent)`;
const contextItem = (label: string) => `
  [...document.querySelectorAll('[data-testid="context-menu-item"]')].find(e => e.textContent === ${JSON.stringify(label)})`;
const clickContextItem = (label: string) => `${contextItem(label)}.click(); true;`;
const pressEscape = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true;`;

/*
 * A chord, dispatched at an element and left to bubble the way a real keypress
 * travels: `Shell`'s listener is on the window, and firing at the window
 * directly would skip the propagation that decides whether Monaco gets there
 * first.
 */
const pressChord = (init: string) =>
  `document.body.dispatchEvent(new KeyboardEvent('keydown', { ${init}, bubbles: true })); true;`;

/**
 * The sidebar's picker: which database the *tree* is browsing. It moves nothing
 * else -- a tab already open keeps running where it runs.
 */
const selectDatabase = (name: string) => `${REACT_SETTERS}
  pickOption(document.querySelector('[data-testid="sidebar-db-select"]'), ${JSON.stringify(name)});`;
/** What the tree is browsing, read off that picker. */
const treeDatabase = `document.querySelector('[data-testid="sidebar-db-select"]').getAttribute('data-value')`;

/**
 * The editor toolbar's picker: which database *this tab* runs against. The
 * caret hangs off the Run button and the name is the label at the bar's left,
 * which is what `editorDatabase` reads back.
 */
const selectTabDatabase = (name: string) => `${REACT_SETTERS}
  pickOption(document.querySelector('[data-testid="editor-db-select"]'), ${JSON.stringify(name)});`;
const editorDatabase = `document.querySelector('[data-testid="editor-db-label"]')?.textContent ?? ''`;

/** The rail, top to bottom: one chip per open connection, named. */
const railNames = `[...document.querySelectorAll('[data-testid="rail-name"]')].map(e => e.textContent)`;
/** The environment is a text tag now, not a colour: read it back verbatim -- the store's own text, not a lookup off it. */
const railEnvs = `[...document.querySelectorAll('[data-testid="rail-env"]')].map(e => e.textContent)`;
const activeRail = `
  [...document.querySelectorAll('[data-testid="rail-item"]')]
    .findIndex(e => e.getAttribute('aria-current') === 'true')`;
const clickRail = (i: number) => `document.querySelectorAll('[data-testid="rail-item"]')[${i}].click(); true;`;
const rightClickRail = (i: number) => `(() => {
  const el = document.querySelectorAll('[data-testid="rail-item"]')[${i}];
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
  return true;
})()`;

/** The tab strip, left to right. */
const tabLabels = `[...document.querySelectorAll('[data-testid="tab-label"]')].map(e => e.textContent)`;
const activeTabLabel = `document.querySelector('[data-testid="tab-pick"][aria-selected="true"] [data-testid="tab-label"]')?.textContent ?? ''`;

/** Tabs are matched on exact label text, same rule as every other selector here. */
const tab = (label: string) => `
  [...document.querySelectorAll('[data-testid="tab"]')]
    .find(e => e.querySelector('[data-testid="tab-label"]').textContent === ${JSON.stringify(label)})`;
const clickTab = (label: string) => `${tab(label)}.querySelector('[data-testid="tab-pick"]').click(); true;`;
const closeTab = (label: string) => `${tab(label)}.querySelector('[data-testid="tab-close"]').click(); true;`;
/** Is the unsaved-changes dialog up? Its absence is as much a result as its presence. */
const closeConfirmShowing = `document.querySelector('[data-testid="close-confirm"]') !== null`;
const answerCloseConfirm = `document.querySelector('[data-testid="close-confirm"] [data-testid="modal-submit"]').click(); true;`;
// `Modal` closes on an overlay click, not on Escape, so the way out is the button.
const cancelCloseConfirm = `
  [...document.querySelectorAll('[data-testid="close-confirm"] button')]
    .find(b => b.textContent === 'Cancel').click(); true;`;
const newTab = `document.querySelector('[data-testid="tab-new"]').click(); true;`;
const rightClickTab = (label: string) => `(() => {
  const el = ${tab(label)};
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
  return true;
})()`;

/*
 * Dragging is three events and they are dispatched as three separate steps on
 * purpose: the strip remembers what is being dragged in React state, so the
 * `dragover` that decides where it lands has to run after that state has
 * committed. Firing all three in one evaluate reads the state as it was before
 * `dragstart`, and nothing moves.
 *
 * These are plain MouseEvents with no `dataTransfer`, which is exactly why the
 * strip keeps the dragged id in state rather than in the drag payload -- a
 * handler that read `e.dataTransfer.getData()` could not be driven from here.
 */
const dragTabStart = (label: string) =>
  `${tab(label)}.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true })); true;`;
/** Over the left half of `label`, which means "drop it in front of this one". */
const dragTabOver = (label: string) => `(() => {
  const el = ${tab(label)};
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('dragover',
    { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 5 }));
  return true;
})()`;
const dropTab = (label: string) =>
  `${tab(label)}.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true })); true;`;

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
 * Select whole lines, the way dragging down the gutter does. The end column is
 * read off the model rather than counted here, so this stays a selection of the
 * line and not an assertion about how long the line is. Wrapped in an IIFE
 * because a bare `const` here would declare into the page's global scope and
 * throw on the second call.
 */
const selectLines = (from: number, to: number) => `(() => {
  const model = window.squealEditor.getModel();
  window.squealEditor.setSelection({
    startLineNumber: ${from}, startColumn: 1,
    endLineNumber: ${to}, endColumn: model.getLineMaxColumn(${to}),
  });
  return true;
})()`;

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

/**
 * Opens the popup the same way, takes the item it has selected, and reads back
 * what landed in the editor.
 *
 * What a suggestion *inserts* is not what it is labelled -- an identifier the
 * server would not resolve bare goes in quoted -- so reading the model is the
 * only way to see the difference. `acceptSelectedSuggestion` is one of Monaco's
 * commands rather than an action (the `closeFindWidget` distinction again), so
 * it is triggered and not fetched; its precondition is the popup being visible
 * and the editor focused, both of which `suggest` has just arranged.
 */
async function acceptSuggestion(sql: string): Promise<string> {
  await suggest(sql);
  await app.evaluate(`window.squealEditor.trigger('test', 'acceptSelectedSuggestion', {}); true;`);
  await Bun.sleep(300);
  return app.evaluate<string>(editorText);
}

/** The results bar's label: which table, and which rows of it are on screen. */
const barText = `document.querySelector('[data-testid="results-bar"]').textContent`;

/** Prev/Next carry an icon beside the word, so match the trimmed text. */
const pagerBtn = (label: 'Prev' | 'Next') => `
  [...document.querySelectorAll('[data-testid="results-pager"] button')]
    .find(e => e.textContent.trim() === ${JSON.stringify(label)})`;

/** How many rows the grid is showing -- what a filter changes. */
const rowCount = `document.querySelectorAll('.grid tbody tr').length`;
/** The grid's scrolling box, which is what remembers where a tab was left. */
const gridScroll = `document.querySelector('[data-testid="grid-scroll"]')`;
/** Click a column header by name -- the whole header is the sort target. */
const clickHeader = (name: string) => `
  [...document.querySelectorAll('.grid thead th')]
    .find(e => e.querySelector('[data-testid="grid-col-name"]')?.textContent === ${JSON.stringify(name)})
    .click(); true;`;
/**
 * Which column the grid says it is sorted by, and which way -- read off the
 * header's own `data-sort` rather than off the arrow's glyph, which is an icon
 * with no text to assert on.
 */
const sortState = `(() => {
  const th = [...document.querySelectorAll('.grid thead th')].find(e => e.dataset.sort);
  return th ? th.querySelector('[data-testid="grid-col-name"]').textContent + ':' + th.dataset.sort : null;
})()`;
/** A data cell (past the row-number gutter) at row r, column c of the grid. */
const gridCell = (r: number, c: number) =>
  `document.querySelectorAll('.grid tbody tr')[${r}].querySelectorAll('td:not(.gutter)')[${c}]`;
/** Double-click an element expression -- how a cell opens its editor. */
const dblClick = (expr: string) => `${expr}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true;`;
/** Extend a cell selection to (r, c) -- the same gesture the row gutter takes. */
const shiftClickCell = (r: number, c: number) =>
  `${gridCell(r, c)}.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); true;`;
/**
 * Press on one cell and drag to another.
 *
 * React synthesises `mouseenter` from the delegated `mouseout`/`mouseover`
 * pair, never from the native `mouseenter` -- which does not bubble, and which
 * React therefore never listens for. It has to be the **`mouseout` of the cell
 * being left**: on a `mouseover` whose `relatedTarget` is inside the same React
 * root, React bails out, assuming the pair was already dispatched from that
 * element's out event. `buttons: 1` is what tells the grid the button is down.
 */
const dragCells = ([fromR, fromC]: [number, number], [toR, toC]: [number, number]) => `(() => {
  const from = ${gridCell(fromR, fromC)}, to = ${gridCell(toR, toC)};
  from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1 }));
  from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 1, relatedTarget: to }));
  to.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return true;
})()`;
/**
 * Move the cursor onto a cell with no button held -- a hover, not a drag.
 *
 * `mouseover` works here where it does not for `dragCells`: the element left
 * behind is outside the React root, which is the case React does *not* bail on.
 */
const hoverCell = (r: number, c: number) => `(() => {
  ${gridCell(r, c)}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  return true;
})()`;
/** Right-click the row-number gutter, the other way into the row's context menu. */
const rightClickGutter = (r: number) => `(() => {
  const el = document.querySelectorAll('.grid tbody tr')[${r}].querySelector('.gutter');
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
  return true;
})()`;
/** A save-bar action button by its trimmed text (Save / Discard). */
const saveAction = (label: 'Save' | 'Discard') =>
  `[...document.querySelectorAll('[data-testid="results-save-actions"] button')].find(e => e.textContent.trim() === ${JSON.stringify(label)})`;

/** A saved row by exact name -- `.includes` would match a longer neighbour. */
const savedRow = (name: string) => `
  [...document.querySelectorAll('[data-testid="saved-row"]')]
    .find(e => e.querySelector('[data-testid="saved-name"]').textContent === ${JSON.stringify(name)})`;

/**
 * Fills the connect form and submits. A `name` is required now -- every open
 * connection is a saved, named member of a workspace -- so callers pass one.
 *
 * The launch screen is the list once anything is saved, so this steps through
 * "+ New connection" when it is showing -- a no-op when the form is already up.
 * With one workspace the picker is skipped, so there is never a step for it
 * here; the workspace describe is what drives that screen.
 */
async function fillConnectForm(
  cfg: typeof PG | typeof MYSQL,
  name: string,
  environment?: string
): Promise<void> {
  /*
   * Wait for whichever screen this lands on before reaching into it. `connect`
   * reloads and calls straight through to here, so on a slow frame the click
   * below no-ops against a screen that has not rendered yet -- and the failure
   * lands on the `#type` wait instead, reading as "the connect form never
   * opened" about a form nothing ever asked for.
   *
   * It is *either* screen, and the click stays optional for that reason: an
   * empty workspace has no list worth showing, so the form is already the
   * screen and there is no `saved-new` to press. Waiting for the button alone
   * turns that perfectly good state into a timeout.
   */
  await app.waitFor(
    `document.querySelector('[data-testid="saved-new"]') || document.querySelector('#type') ? true : null`
  );
  await app.evaluate(`document.querySelector('[data-testid="saved-new"]')?.click(); true;`);

  // Wait for the form rather than sleeping at it. Reaching a null `#type` is not
  // a readable failure: `pickOption` calls `click()` on null, which throws from
  // inside the injected script -- a message that names neither the element nor
  // the screen it was expected on.
  await app.waitFor(`document.querySelector('#type') ? true : null`);

  await app.evaluate(`${REACT_SETTERS}
    pickOption(document.querySelector('#type'), ${JSON.stringify(cfg.type)});`);
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
    // Groups the connection under a heading in the list, tags its chip on the
    // rail, and shows in the status bar for the active connection.
    await app.evaluate(`${REACT_SETTERS}
      pickOption(document.querySelector('#environment'), ${JSON.stringify(environment)});`);
    await Bun.sleep(200);
  }

  await app.evaluate(`document.querySelector('[data-testid="connect-submit"]').click(); true;`);
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
  name: string,
  environment?: string
): Promise<void> {
  await app.evaluate(`document.querySelector('[data-testid="rail-add"]').click(); true;`);
  await Bun.sleep(500);
  await fillConnectForm(cfg, name, environment);
}

/**
 * Empties the current workspace's saved connections from the connect screen.
 *
 * Every connection is saved now, so the smoke describes above leave rows behind;
 * a describe that asserts an exact saved list starts by wiping to a clean slate.
 * It reloads to the list, then deletes the first row until none remain -- Delete
 * is the second action, a trash icon armed by a first click and committed by a
 * second on that same button.
 */
async function clearSavedConnections(): Promise<void> {
  await app.reload();
  await Bun.sleep(600);
  for (let guard = 0; guard < 20; guard++) {
    const rows = await app.evaluate<number>(`document.querySelectorAll('[data-testid="saved-row"]').length`);
    if (rows === 0) break;
    await app.evaluate(`document.querySelector('[data-testid="saved-row"]').querySelector('[data-testid="saved-delete"]').click(); true;`);
    await Bun.sleep(300);
    await app.evaluate(`document.querySelector('[data-testid="saved-row"]').querySelector('[data-testid="saved-delete"]').click(); true;`);
    await Bun.sleep(600);
  }
}

/**
 * Disconnect lives in the titlebar's File menu. The two steps cannot be one
 * evaluate: the list is only rendered once React has re-rendered the open menu,
 * so clicking the trigger and the item in the same turn finds nothing.
 */
async function disconnect(): Promise<void> {
  await app.evaluate(`document.querySelector('[data-testid="statusbar-disconnect"]').click(); true;`);
  await Bun.sleep(800);
}

/**
 * Close a tab, answering the unsaved-changes dialog when the close raises one.
 *
 * Whether it appears is a fact about the tab and not about the gesture -- a grid
 * tab, an untouched definition tab and an empty query tab all close with no
 * dialog -- so it is asked rather than assumed. The tests that are *about* the
 * dialog drive it by hand instead of coming through here.
 */
async function closeTabConfirmed(label: string): Promise<void> {
  await app.evaluate(closeTab(label));
  await Bun.sleep(250);
  if (await app.evaluate<boolean>(closeConfirmShowing)) {
    await app.evaluate(answerCloseConfirm);
    await Bun.sleep(250);
  }
}

/**
 * Work *in* a database: point the tree at it, and the tab in front too when it
 * is an editor tab and so has a picker of its own.
 *
 * Two gestures rather than one, because the tree and the tab can be unpinned
 * from each other -- and this suite unpins them, so most of it means the pair
 * and reaches for this. With them paired the second gesture points the tab
 * where it already is, which is why it is safe either way. The tests that are
 * *about* the two being separate drive each picker by hand instead.
 */
async function useDatabase(name: string): Promise<void> {
  await app.evaluate(selectDatabase(name));
  await Bun.sleep(1500);
  if (!(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="editor-db-select"]')`))) return;
  await app.evaluate(selectTabDatabase(name));
  await Bun.sleep(800);
}

/**
 * One of the strip menu's closes, answering the dialog when the set it takes
 * holds unsaved work — which for a bulk close is one dialog for the whole set,
 * not one per tab.
 */
async function menuCloseConfirmed(anchor: string, item: string): Promise<void> {
  await app.evaluate(rightClickTab(anchor));
  await Bun.sleep(250);
  await app.evaluate(clickContextItem(item));
  await Bun.sleep(400);
  if (await app.evaluate<boolean>(closeConfirmShowing)) {
    await app.evaluate(answerCloseConfirm);
    await Bun.sleep(400);
  }
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
    // heartbeat timeout, and until it exits it still holds squeal.db open,
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
      await connect(PG, 'pg-smoke');
    });

    test('connects and renders the shell', async () => {
      const shell = await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`);
      if (!shell) {
        throw new Error(
          await app.evaluate<string>(`document.querySelector('[data-testid="callout"]')?.textContent ?? 'no error shown'`)
        );
      }
      expect(shell).toBe(true);
    });

    test('opens on one editor tab', async () => {
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1']);
    });

    test('offers the databases in the picker', async () => {
      const dbs = await app.evaluate<string[]>(`${REACT_SETTERS} optionsOf('sidebar-db-select', 'label');`);
      expect(dbs).toContain('shop');
    });

    test('picking a database lists its tables', async () => {
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      const tables = await app.evaluate<string[]>(
        `[...document.querySelectorAll('[data-testid="tree-label"]')].map(e => e.textContent)`
      );
      // Its own name, not a schema glued to the front of it: the heading above
      // says where it lives. Only the default schema's group is open, so this is
      // what a freshly picked database shows.
      expect(tables).toContain('users');
      expect(await app.evaluate<string[]>(schemaLabels)).toContain('reporting');
    });

    test('refreshing the tree keeps it on screen; only the icon turns', async () => {
      const before = await app.evaluate<string[]>(treeLabels);
      expect(before).toContain('users');

      /*
       * Read the tree *while* the refresh is in flight, which is the whole
       * point: `tablesRequested` dispatches synchronously from the click, so
       * React has painted the loading state by the next macrotask, and a bridge
       * round trip to Postgres cannot have landed inside one. Sleeping first
       * would assert nothing -- the tree is back either way by then.
       */
      const during = await app.evaluate<{ skeleton: boolean; spinning: boolean; labels: string[] }>(`
        (async () => {
          document.querySelector('[data-testid="sidebar-tables-refresh"]').click();
          await new Promise((r) => setTimeout(r, 0));
          return {
            skeleton: !!document.querySelector('[data-testid="tree-skeleton"]'),
            spinning: !!document.querySelector('[data-testid="sidebar-tables-refresh"] .spin'),
            labels: ${treeLabels},
          };
        })()`);

      expect(during.spinning).toBe(true);
      expect(during.skeleton).toBe(false);
      expect(during.labels).toEqual(before);

      await app.waitFor(`document.querySelector('[data-testid="sidebar-tables-refresh"] .spin') ? null : true`);
      expect(await app.evaluate<string[]>(treeLabels)).toEqual(before);
    });

    test('groups relations under their schema, the one you are in first', async () => {
      // Postgres, so every relation names a schema and the tree draws a heading
      // per schema. `public` leads because it is the engine's default schema --
      // the one group that starts open, so it is not left sitting under headings
      // that open onto nothing.
      expect(await app.evaluate<string[]>(schemaLabels)).toEqual(['public', 'reporting']);
    });

    test('only the default schema starts open', async () => {
      // A dozen schemas all open cost the same scroll grouping exists to remove,
      // so everything outside the one you are in starts shut.
      expect(await app.evaluate<string[]>(treeLabelsIn('public'))).toContain('users');
      expect(await app.evaluate<string[]>(treeLabelsIn('reporting'))).toEqual([]);
    });

    test('a schema heading opens and closes, taking only its own relations with it', async () => {
      await app.evaluate(toggleSchema('reporting'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(treeLabelsIn('reporting'))).toContain('daily_stats');
      // The other group is untouched by its neighbour opening.
      expect(await app.evaluate<string[]>(treeLabelsIn('public'))).toContain('users');

      await app.evaluate(toggleSchema('reporting'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(treeLabelsIn('reporting'))).toEqual([]);
      // The heading stays either way -- it is how you get the group back.
      expect(await app.evaluate<string[]>(schemaLabels)).toEqual(['public', 'reporting']);
    });

    test('a filter reveals the groups it matched in, and closing it restores them', async () => {
      // `daily_stats` lives in the shut group, so a heading that stayed shut over
      // it would read as "no matches" about a search that found one.
      await app.evaluate(setFilter('daily'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(treeLabelsIn('reporting'))).toContain('daily_stats');

      await app.evaluate(setFilter(''));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(treeLabelsIn('reporting'))).toEqual([]);
    });

    test('orders every table above every view, inside each group', async () => {
      // shop holds one view (active_users) among its public tables, so ordering
      // tables first means the view is last *of that schema* -- no heading, the
      // icon tells them apart. Grouped, "last" is per group rather than overall.
      const publicLabels = await app.evaluate<string[]>(treeLabelsIn('public'));
      expect(publicLabels[publicLabels.length - 1]).toBe('active_users');
    });

    test('functions sit behind one node that starts shut, and never among the relations', async () => {
      // The symptom this exists for: `shop` holds a handful of functions, and a
      // schema with an extension or a trigger function per table holds dozens.
      // Drawn inline they read as part of the relation list and push the tables
      // being looked for off the bottom of the tree.
      expect(await app.evaluate<string[]>(functionLabels)).toEqual([]);
      expect(await app.evaluate<string[]>(treeLabelsIn('public'))).not.toContain('square');

      await app.evaluate(toggleFunctions);
      await Bun.sleep(300);

      // Overloads: `square` is defined over int and over text, alike in name,
      // schema and kind. The argument list is what tells the two rows apart --
      // without it they are two identical rows opening the same definition.
      const labels = await app.evaluate<string[]>(functionLabels);
      expect(labels).toContain('square(x integer)');
      expect(labels).toContain('square(x text)');
      expect(new Set(labels).size).toBe(labels.length);

      await app.evaluate(toggleFunctions);
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(functionLabels)).toEqual([]);
    });

    test('a filter opens the functions node over what it matched', async () => {
      // Same rule the schema headings follow: the node is built from the
      // filtered list, so drawn at all means there is a hit inside it, and a
      // shut node over a match reads as "nothing found".
      await app.evaluate(setFilter('square'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(functionLabels)).toContain('square(x integer)');

      // And the filter reaches functions at all: filtering for a table used to
      // leave every function in the database sitting under it.
      await app.evaluate(setFilter('daily'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(functionLabels)).toEqual([]);

      await app.evaluate(setFilter(''));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(functionLabels)).toEqual([]);
    });

    test('a table expands in place to show its columns, marking the primary key', async () => {
      await app.evaluate(toggleTable('users'));
      await Bun.sleep(1000);

      const item = treeItem('users');
      const cols = await app.evaluate<string[]>(
        `[...${item}.querySelectorAll('[data-testid="tree-col-name"]')].map(e => e.textContent)`
      );
      expect(cols).toContain('email');

      // The key mark lands on the primary key and on nothing else -- the whole
      // point of carrying the flag rather than guessing from the name.
      const hasKey = (name: string) => `!![...${item}.querySelectorAll('[data-testid="tree-col"]')]
        .find(c => c.querySelector('[data-testid="tree-col-name"]').textContent === ${JSON.stringify(name)})
        .querySelector('[data-testid="tree-key"]')`;
      expect(await app.evaluate<boolean>(hasKey('id'))).toBe(true);
      expect(await app.evaluate<boolean>(hasKey('email'))).toBe(false);

      // Collapse again, so the tree is the flat list the later tests expect.
      await app.evaluate(toggleTable('users'));
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`${item}.querySelectorAll('[data-testid="tree-col"]').length`)).toBe(0);
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
        `[...document.querySelectorAll('[data-testid="grid-col-name"]')].map(e => e.textContent)`
      );
      expect(headers).toContain('email');
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid tbody tr').length`)).toBe(2);

      // A grid tab spends none of the screen on an editor nobody asked for.
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="main-grid"]')`)).toBe(true);
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

      await closeTabConfirmed('Query 2');
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
      await app.evaluate(`document.querySelector('[data-testid="run-btn"]').click(); true;`);
      await Bun.sleep(1500);

      const headers = `[...document.querySelectorAll('[data-testid="grid-col-name"]')].map(e => e.textContent)`;
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
      await closeTabConfirmed('Query 1');
      await Bun.sleep(400);

      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
      const note = await app.evaluate<string>(`document.querySelector('[data-testid="note-muted"]')?.textContent ?? ''`);
      expect(note).toContain('Nothing open');
    });

    /*
     * The tree used to go dark along with the last tab: the picker read a tab's
     * database and there was none, so it disabled itself and the tree had
     * nothing to fetch for. There is still a connection with nothing open, and
     * this is the fix -- the picker and the tree work *before* `+` is ever
     * clicked, not only after. Ends back at the empty state it started from, so
     * the next test still finds one.
     */
    test('the tree is usable from the empty state, with no tab open at all', async () => {
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
      expect(
        await app.evaluate<string | null>(`document.querySelector('[data-testid="sidebar-db-select"]').getAttribute('aria-disabled')`)
      ).toBeNull();

      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string[]>(treeLabels)).toContain('users');

      // Clicking a table from here mints a tab for it -- the picker having
      // something to say from the empty state was the means, not the end.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['users']);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * The empty state has to have a way out of it, and `+` is the only one.
     *
     * The database is the connection's, so it is already there to open the new
     * tab on even with nothing open yet -- and this asserts the *user-visible*
     * consequences of that (an enabled picker, a listed tree) rather than the
     * state behind them. Driving the picker's state directly would sail
     * straight past a disabled one -- the old native-select setter fired a
     * synthetic `change` no real click could produce, so a test that used it
     * passed while the app stranded you here. `pickOption` clicks, which a
     * disabled trigger ignores.
     */
    test('a new tab from the empty state lands on a database', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(1500);

      // Not stranded: the picker names a real database and can be used.
      // `aria-disabled`, not `.disabled`: the trigger is a focusable div rather
      // than a button, because it holds the search input while the list is open.
      expect(await app.evaluate<string | null>(`document.querySelector('[data-testid="sidebar-db-select"]').getAttribute('aria-disabled')`)).toBeNull();
      const picked = await app.evaluate<string>(`${REACT_SETTERS} selectValue('sidebar-db-select');`);
      expect(picked).not.toBe('');
      const options = await app.evaluate<string[]>(`${REACT_SETTERS} optionsOf('sidebar-db-select', 'value');`);
      expect(options).toContain(picked);

      // The tree answered for that database, rather than sitting blank because
      // nothing was ever fetched. "No tables" is a real answer -- the session
      // opens on the server's first database, which for Postgres is the empty
      // maintenance one -- so this asks for an answer, not for rows.
      expect(
        await app.evaluate<boolean>(
          `document.querySelectorAll('[data-testid="tree-row"]').length > 0 || !!document.querySelector('[data-testid="tree-note"]')`
        )
      ).toBe(true);

      // And the picker actually moves it -- back to somewhere the rest of the
      // block can work from.
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      const tables = await app.evaluate<string[]>(
        `[...document.querySelectorAll('[data-testid="tree-label"]')].map(e => e.textContent)`
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
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="results-pager"]').length`)).toBe(0);
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

    /*
     * One grid node shows whichever tab is in front, so without the offset being
     * written back a tab returns to wherever the *other* tab's rows left the
     * scrollbar. A hundred rows is the only fixture tall enough to tell the
     * difference.
     */
    test('a scrolled grid comes back where it was left, until it is re-browsed', async () => {
      await app.evaluate(clickTable('events'));
      await Bun.sleep(2000);

      await app.evaluate(`${gridScroll}.scrollTop = 400; true;`);
      await Bun.sleep(300);

      // Somewhere else entirely, and back. `tags` is two rows, so the grid it
      // leaves behind cannot itself be scrolled -- the only offset in play is
      // the one `events` is owed.
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      await app.evaluate(clickTab('events'));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(`${gridScroll}.scrollTop`)).toBe(400);

      // A page is a different set of rows, so the height it was left at names
      // nothing -- the new page starts at the top.
      await app.evaluate(`${pagerBtn('Next')}.click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(barText)).toContain('rows 101–150');
      expect(await app.evaluate<number>(`${gridScroll}.scrollTop`)).toBe(0);

      await app.evaluate(closeTab('events'));
      await Bun.sleep(300);
      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    /*
     * A query tab's rows are named by the run that fetched them rather than by a
     * table and an offset, so it is the other half of the same rule and the only
     * one that can be scrolled sideways: no fixture table is wide enough, but a
     * query can ask for columns that are.
     */
    test('a query tab keeps its scroll in both directions, and a re-run starts at the top', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(600);
      const queryTab = await app.evaluate<string>(activeTabLabel);

      await app.evaluate(setEditorText(
        `SELECT g AS n,
                repeat('a', 200) AS wide_a, repeat('b', 200) AS wide_b, repeat('c', 200) AS wide_c,
                repeat('d', 200) AS wide_d, repeat('e', 200) AS wide_e, repeat('f', 200) AS wide_f
         FROM generate_series(1, 200) g`
      ));
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="run-btn"]').click(); true;`);
      await Bun.sleep(2000);

      await app.evaluate(`${gridScroll}.scrollTop = 400; ${gridScroll}.scrollLeft = 300; true;`);
      await Bun.sleep(300);
      // The rows have to actually reach that far, or the assertions below would
      // hold against a grid that simply cannot scroll.
      expect(await app.evaluate<number>(`${gridScroll}.scrollLeft`)).toBe(300);

      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);
      await app.evaluate(clickTab(queryTab));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(`${gridScroll}.scrollTop`)).toBe(400);
      expect(await app.evaluate<number>(`${gridScroll}.scrollLeft`)).toBe(300);

      // The same text run again is still a different set of rows -- the server's
      // order is not promised -- so the offset it was left at is discarded.
      await app.evaluate(`document.querySelector('[data-testid="run-btn"]').click(); true;`);
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(`${gridScroll}.scrollTop`)).toBe(0);
      expect(await app.evaluate<number>(`${gridScroll}.scrollLeft`)).toBe(0);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
      await closeTabConfirmed(queryTab);
      await Bun.sleep(300);
    });

    test('clicking a header cycles the sort, and the last click gives the order back', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      // Nothing is sorted until asked, so no header claims to be.
      expect(await app.evaluate<string | null>(sortState)).toBeNull();
      const names = `[...document.querySelectorAll('.grid tbody tr')].map(r => r.querySelectorAll('td:not(.gutter)')[1].textContent)`;
      const natural = await app.evaluate<string[]>(names);

      // Every sortable header holds a hint arrow, hidden until hovered. `:hover`
      // is not drivable through a dispatched event, so what is pinned here is the
      // half that is: it is rendered, and it is hidden at rest. The CSS that
      // reveals it lives in `residual.css` beside the row-hover rule.
      const hintFor = (col: string) => `(() => {
        const th = [...document.querySelectorAll('.grid thead th')]
          .find(e => e.querySelector('[data-testid="grid-col-name"]')?.textContent === ${JSON.stringify(col)});
        const hint = th.querySelector('[data-testid="grid-sort-hint"]');
        return hint ? getComputedStyle(hint).visibility : null;
      })()`;
      expect(await app.evaluate<string | null>(hintFor('name'))).toBe('hidden');

      await app.evaluate(clickHeader('name'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string | null>(sortState)).toBe('name:asc');
      expect(await app.evaluate<string[]>(names)).toEqual(['Ada', 'Grace']);

      // The sorted column trades the hint for the real arrow, in the same slot.
      expect(await app.evaluate<string | null>(hintFor('name'))).toBeNull();
      expect(await app.evaluate<boolean>(
        `!!document.querySelector('.grid thead th[data-sort] [data-testid="grid-sort-arrow"]')`
      )).toBe(true);

      // Second click on the same header reverses it rather than adding to it.
      await app.evaluate(clickHeader('name'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string | null>(sortState)).toBe('name:desc');
      expect(await app.evaluate<string[]>(names)).toEqual(['Grace', 'Ada']);

      // Third click removes the sort outright -- back to the order the server
      // handed back before any of this, not to ascending again.
      await app.evaluate(clickHeader('name'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string | null>(sortState)).toBeNull();
      expect(await app.evaluate<string[]>(names)).toEqual(natural);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('a sort orders the whole table and the pager keeps it', async () => {
      await app.evaluate(clickTable('events'));
      await Bun.sleep(2000);

      // Deliberately no assertion about the *unsorted* first row: natural order
      // is the server's, and the fixture's own `UPDATE` on `e1` moves that row to
      // the end of the Postgres heap. That it is not 1..150 is exactly why the
      // pager test beside this one asserts counts rather than ids.
      const firstId = `${gridCell(0, 0)}.textContent`;

      await app.evaluate(clickHeader('id'));
      await Bun.sleep(1500);
      await app.evaluate(clickHeader('id'));
      await Bun.sleep(1500);

      // Descending puts the *table's* last row on page one, which is the whole
      // difference between ordering the table and reordering the page: sorting
      // the hundred rows already here could never produce 150.
      expect(await app.evaluate<string | null>(sortState)).toBe('id:desc');
      expect(await app.evaluate<string>(firstId)).toBe('150');
      expect(await app.evaluate<string>(barText)).toContain('rows 1–100');

      // And the step carries it: page two continues the order rather than
      // being cut from the natural one, which would repeat rows across it.
      await app.evaluate(`${pagerBtn('Next')}.click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(firstId)).toBe('50');
      expect(await app.evaluate<string | null>(sortState)).toBe('id:desc');

      await app.evaluate(closeTab('events'));
      await Bun.sleep(300);
    });

    test('a hand-typed query sorts too, wrapped rather than rewritten', async () => {
      // The editor tab is the path with no page SQL of its own: the statement
      // runs whole inside a wrap, so the same rows come back reordered and the
      // text in the editor is untouched by the click. Its own `ORDER BY` is
      // what the wrap has to override -- which is also why it is here rather
      // than being appended to.
      const sql = 'SELECT id, name FROM users ORDER BY id';
      await app.evaluate(setEditorText(sql));
      await Bun.sleep(400);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(2000);

      const names = `[...document.querySelectorAll('.grid tbody tr')].map(r => r.querySelectorAll('td:not(.gutter)')[1].textContent)`;
      expect(await app.evaluate<string[]>(names)).toEqual(['Ada', 'Grace']);

      await app.evaluate(clickHeader('name'));
      await Bun.sleep(1500);
      await app.evaluate(clickHeader('name'));
      await Bun.sleep(1500);

      expect(await app.evaluate<string | null>(sortState)).toBe('name:desc');
      expect(await app.evaluate<string[]>(names)).toEqual(['Grace', 'Ada']);
      // Same rows, only reordered -- the licence for wrapping at all.
      expect(await app.evaluate<number>(rowCount)).toBe(2);
      // The editor still holds exactly what was typed; the wrap never reaches it.
      expect(await app.evaluate<string>(`window.squealEditor.getValue()`)).toBe(sql);
    });

    test('a filter narrows the grid, and clearing it restores the table', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(rowCount)).toBe(2);

      // The bar is there with a blank condition already on it -- there is no
      // button to reveal it and nothing to add before typing a first filter.
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="filter-condition"]').length`)).toBe(1);
      // Search is live over an untouched bar, because pressing it there re-reads
      // the whole table -- which is the refresh this button doubles as.
      expect(await app.evaluate<boolean>(`document.querySelector('[data-testid="filter-apply"]').disabled`)).toBe(false);

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="filter-column"]'), 'name');`);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-value"]'), 'Ada');
        true;`);
      await Bun.sleep(300);

      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);

      // One row, and it is the one the filter names -- the count alone would
      // pass for a filter that matched the wrong row.
      expect(await app.evaluate<number>(rowCount)).toBe(1);
      expect(await app.evaluate<string>(`${gridCell(0, 1)}.textContent`)).toBe('Ada');

      // Still live with the filter applied and the draft unchanged: pressing it
      // again is how the same page is read a second time.
      expect(await app.evaluate<boolean>(`document.querySelector('[data-testid="filter-apply"]').disabled`)).toBe(false);
      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(1);

      await app.evaluate(`document.querySelector('[data-testid="filter-clear"]').click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(2);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('switching to raw carries the built conditions over as SQL', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="filter-column"]'), 'name');`);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-value"]'), "O'Hara");
        true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`);
      await Bun.sleep(400);

      // The value arrives as a quoted literal, with its own quote doubled: the
      // builder bound it as a parameter and raw text does not, so handing it
      // over bare would be an identifier rather than a value. The column is
      // quoted too, per the dialect this session reported (Postgres here) --
      // unconditionally, the same way the extension's own quoteIdent does.
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="filter-raw"]').value`)).toBe(
        `"name" = 'O''Hara'`
      );

      // And it is text that actually runs, not a label.
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('[data-testid="filter-raw"]'), "name = 'Ada'"); true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(1);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('a mixed-case column survives the trip to raw and back to the server', async () => {
      // The reported bug: `eventType` handed to Postgres unquoted is not the
      // column of that name -- Postgres folds an unquoted identifier to
      // lowercase, so the server looked for `eventtype`, found nothing, and
      // refused the filter. `users."eventType"` exists in the fixture only to
      // make this reproducible without a mock.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="filter-column"]'), 'eventType');`);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-value"]'), 'page_view');
        true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="filter-raw"]').value`)).toBe(
        `"eventType" = 'page_view'`
      );

      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);

      // No error, and it is Ada's row specifically -- not an accidental match.
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="note-error"]').length`)).toBe(0);
      expect(await app.evaluate<number>(rowCount)).toBe(1);
      expect(await app.evaluate<string>(`${gridCell(0, 1)}.textContent`)).toBe('Ada');

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('switching back to the builder keeps the conditions it had', async () => {
      // The bug this pins: raw -> builder used to reset to a blank row even
      // though the builder side of the draft was never touched. Neither
      // direction may discard the other form's work -- see `FilterDraft`.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="filter-column"]'), 'name');`);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-value"]'), 'Ada');
        true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-add"]').click(); true;`);
      await Bun.sleep(300);

      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`); // to raw
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`); // back to builder
      await Bun.sleep(300);

      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="filter-condition"]').length`)).toBe(2);
      expect(await app.evaluate<string>(`document.querySelectorAll('[data-testid="filter-column"]')[0].getAttribute('data-value')`)).toBe('name');
      expect(await app.evaluate<string>(`document.querySelectorAll('[data-testid="filter-value"]')[0].value`)).toBe('Ada');

      // And it still runs after the round trip -- not just displayed. Row 1,
      // not the first match: `filter-remove` is one button per row, and the
      // row to drop is the blank second one, not the filled first one.
      await app.evaluate(`document.querySelectorAll('[data-testid="filter-remove"]')[1].click(); true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(1);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('a filter the server rejects leaves the bar there to be corrected', async () => {
      // The failure case that decided where the bar is drawn: a rejected page
      // clears `browse`, so a bar keyed off it would vanish with the error and
      // take the only way to fix it along.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`);
      await Bun.sleep(300);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-raw"]'), 'not valid sql (');
        true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);

      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="note-error"]').length`)).toBe(1);
      // Still there, and still holding what was typed.
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="filter-raw"]').length`)).toBe(1);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="filter-raw"]').value`)).toBe(
        'not valid sql ('
      );

      // The column dropdown must not have emptied out along with `browse` --
      // it is exactly what someone needs to build the correction. Checked via
      // the builder, since the failure was in raw mode.
      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`);
      await Bun.sleep(300);
      const columnOptions = await app.evaluate<string[]>(`${REACT_SETTERS} optionsOf('filter-column', 'value');`);
      expect(columnOptions.length).toBeGreaterThan(1);

      // And correcting it recovers, without re-opening the table.
      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="filter-column"]'), 'name');`);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-value"]'), 'Ada');
        true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-apply"]').click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(1);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    test('NULL is rendered distinctly, not as empty or "null"', async () => {
      // Browse `users` in a tab of its own rather than inheriting whatever the
      // last test left in the grid: Grace's NULL email is the subject, and a
      // neighbour paging away to another table should fail that test, not this.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="null-value"]')`)).toBe(true);
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
        `[...document.querySelectorAll('[data-testid="grid-col-name"]')].map(e => e.textContent)`
      );
      expect(headers).toEqual(['name', 'email']);

      // The grid now holds SQL the user wrote, and the extension will not
      // rewrite that to reach page 2 -- so there is no page 2 to offer.
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="results-pager"]').length`)).toBe(0);
    });

    /*
     * Running a selection, and the three tests below are one arrangement.
     *
     * The tab holds two statements on purpose, and **the strip is what tells the
     * two runs apart**: running the whole tab runs both and draws a tab each, so
     * a selection that quietly ran everything would still answer under `name` on
     * *Result 1* and pass on the headers alone. Asserting there is no strip is
     * asserting exactly one statement went to the server.
     */
    const twoStatements = 'SELECT name FROM users ORDER BY id;\nSELECT email FROM users ORDER BY id;';
    const gridHeaders = `[...document.querySelectorAll('[data-testid="grid-col-name"]')].map(e => e.textContent)`;
    const statementTabs = `[...document.querySelectorAll('[data-testid="statement-tab"]')].map(e => e.textContent)`;
    // Collapse whatever the previous test selected. Running is *the selection or
    // the whole tab*, so a test about running the tab has to say there is no
    // selection rather than assume `setValue` dropped one.
    const clearSelection = `window.squealEditor.setPosition({ lineNumber: 1, column: 1 }); true;`;

    test('a selection is what runs, and the button says which', async () => {
      await app.evaluate(setEditorText(twoStatements));
      await Bun.sleep(200);
      await app.evaluate(selectLines(1, 1));
      await Bun.sleep(200);

      expect(await app.evaluate<string>(`document.querySelector('[data-testid="run-btn"]').textContent`)).toBe('Run selection');

      // Dispatched at the document, so this is the window listener rather than
      // Monaco's own binding: a selection outlives the focus leaving the editor,
      // and running from out here has to mean what running from inside it means.
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(1500);

      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);
      // One statement means no strip at all, not a strip of one.
      expect(await app.evaluate<string[]>(statementTabs)).toEqual([]);
    });

    /*
     * The result remembers the statement it came from, which is the half of this
     * feature that is not the running. Sorting re-runs that statement -- if it
     * re-ran the tab's text instead, the wrap would go around two statements and
     * come back a syntax error rather than a subtly different grid.
     */
    test('sorting a selection\'s result re-runs the selection, not the tab', async () => {
      await app.evaluate(clickHeader('name'));
      await Bun.sleep(1500);

      expect(await app.evaluate<string | null>(sortState)).toBe('name:asc');
      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="note-error"]')?.textContent ?? ''`)).toBe('');
    });

    test('a selection of nothing but whitespace runs nothing, rather than everything', async () => {
      await app.evaluate(setEditorText('SELECT name FROM users;\n   \nSELECT email FROM users;'));
      await Bun.sleep(200);
      await app.evaluate(selectLines(2, 2));
      await Bun.sleep(200);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(1500);

      // Still the grid the test above left: falling back to the whole tab would
      // have run both statements, drawn a strip, and answered under `email` on
      // Result 2.
      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);
      expect(await app.evaluate<string[]>(statementTabs)).toEqual([]);
    });

    /*
     * Several statements in one run. Each goes to the server on its own -- which
     * is what this is really pinning, since Postgres answers a *stacked* run with
     * only the last statement's result and drops the rest. Two tabs holding two
     * different column sets is that not having happened.
     */
    test('a run of several statements gets a numbered tab each', async () => {
      await app.evaluate(setEditorText(twoStatements));
      await Bun.sleep(200);
      await app.evaluate(clearSelection);
      await Bun.sleep(100);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(2500);

      expect(await app.evaluate<string[]>(statementTabs)).toEqual(['Result 1', 'Result 2']);
      // The first is what shows, so a batch reads in the order it was written.
      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);

      await app.evaluate(`document.querySelectorAll('[data-testid="statement-tab"]')[1].click(); true;`);
      await Bun.sleep(300);

      // Held, not re-run: the answer was already there.
      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['email']);
    });

    /*
     * Running the statement under the cursor, and the three tests below are one
     * arrangement over the same two-statement tab. The strip is again what tells
     * the runs apart -- sending the whole tab would draw a tab per statement --
     * and each test asserts a grid the one before it did not leave, so a
     * shortcut that quietly did nothing could not pass.
     *
     * Dispatched at the document, which is the window listener rather than
     * Monaco's own binding: `e.key` is `Enter` with or without Shift, so this is
     * where the two runs would have collided.
     */
    const putCursor = (lineNumber: number, column: number) =>
      `window.squealEditor.setPosition({ lineNumber: ${lineNumber}, column: ${column} }); true;`;
    const putCursorAtEndOfLine = (line: number) => `(() => {
      const model = window.squealEditor.getModel();
      window.squealEditor.setPosition({ lineNumber: ${line}, column: model.getLineMaxColumn(${line}) });
      return true;
    })()`;
    const runStatement =
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true })); true;`;

    test('Ctrl+Shift+Enter runs only the statement the cursor is in', async () => {
      await app.evaluate(setEditorText(twoStatements));
      await Bun.sleep(200);
      await app.evaluate(putCursor(1, 8));
      await Bun.sleep(100);
      await app.evaluate(runStatement);
      await Bun.sleep(1500);

      // The test above left Result 2's grid and a strip of two, so both of
      // these changing is one statement having gone to the server.
      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);
      expect(await app.evaluate<string[]>(statementTabs)).toEqual([]);
    });

    test('the cursor just past a terminator runs the statement it ended', async () => {
      // Where the cursor actually is after typing a query and ending it.
      await app.evaluate(putCursorAtEndOfLine(2));
      await Bun.sleep(100);
      await app.evaluate(runStatement);
      await Bun.sleep(1500);

      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['email']);
      expect(await app.evaluate<string[]>(statementTabs)).toEqual([]);
    });

    test('a selection does not change what the cursor is standing in', async () => {
      /*
       * Everything selected, from the bottom up the way Shift+Up leaves it, so
       * the cursor sits in the *first* statement while the selection covers
       * both. Ctrl+Enter here would run the pair and draw a strip; this key
       * answers with the cursor's statement and ignores the selection outright.
       */
      await app.evaluate(`(() => {
        const model = window.squealEditor.getModel();
        window.squealEditor.setSelection({
          selectionStartLineNumber: 2, selectionStartColumn: model.getLineMaxColumn(2),
          positionLineNumber: 1, positionColumn: 1,
        });
        return true;
      })()`);
      await Bun.sleep(200);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="run-btn"]').textContent`)).toBe('Run selection');

      await app.evaluate(runStatement);
      await Bun.sleep(1500);

      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);
      expect(await app.evaluate<string[]>(statementTabs)).toEqual([]);
    });

    /*
     * The batch stops at the first failure, and the strip is where that is
     * legible: the statements that ran have a tab, the failure is selected, and
     * what never ran is counted rather than silently missing.
     */
    test('a failing statement stops the batch and the strip says what did not run', async () => {
      await app.evaluate(setEditorText('SELECT name FROM users;\nSELECT * FROM no_such_table;\nSELECT email FROM users;'));
      await Bun.sleep(200);
      await app.evaluate(clearSelection);
      await Bun.sleep(100);
      await app.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(2500);

      expect(await app.evaluate<string[]>(statementTabs)).toEqual(['Result 1', 'Result 2']);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="statements-not-run"]')?.textContent ?? ''`)).toBe('1 not run');

      // The failure is what is on screen -- landing on Result 1's grid would
      // leave the user looking at a success and wondering why the run stopped.
      expect(await app.evaluate<string>(
        `document.querySelectorAll('[data-testid="statement-tab"]')[1].getAttribute('aria-selected')`
      )).toBe('true');
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="note-error"]')?.textContent ?? ''`))
        .toMatch(/no_such_table/i);

      // Result 1 still holds its own answer: a failure later in the batch takes
      // nothing away from what already ran.
      await app.evaluate(`document.querySelectorAll('[data-testid="statement-tab"]')[0].click(); true;`);
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(gridHeaders)).toEqual(['name']);
    });

    /*
     * The editable grid. `tags` has a unique NOT NULL key, so it can be edited;
     * `logs` has no key, so it must stay read-only and say why. The write path
     * itself is proven on both engines in the extension suite -- here the job is
     * the UI wiring: the editor, the staging, the save bar, and the clipboard.
     */
    test('a keyless table is read-only and says why', async () => {
      await app.evaluate(clickTable('logs'));
      await Bun.sleep(1500);

      expect(await app.evaluate<string>(`document.querySelector('[data-testid="results-ro"]')?.textContent ?? ''`)).toMatch(
        /no primary or unique key/i
      );

      // Double-clicking a cell must not open an editor on a read-only grid.
      await app.evaluate(dblClick(gridCell(0, 0)));
      await Bun.sleep(300);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="cell-edit-input"]').length`)).toBe(0);

      await app.evaluate(closeTab('logs'));
      await Bun.sleep(300);
    });

    test('an editable table stages an edit and saves it', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      // A table with a key shows no read-only reason.
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="results-ro"]').length`)).toBe(0);

      // Edit the first row's weight to a value guaranteed different from what is
      // there, so a real change is always staged and the test re-runs cleanly
      // whichever way it left the row last time.
      const cur = await app.evaluate<string>(`${gridCell(0, 1)}.textContent`);
      const next = cur === '111' ? '222' : '111';

      await app.evaluate(dblClick(gridCell(0, 1)));
      await Bun.sleep(300);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="cell-edit-input"]'), ${JSON.stringify(next)});
        true;`);
      await Bun.sleep(200);
      await app.evaluate(
        `document.querySelector('[data-testid="cell-edit-input"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true;`
      );
      await Bun.sleep(300);

      // Staged: the save bar counts one change and the cell is marked dirty.
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="results-savebar"] span').textContent`)).toMatch(
        /1 unsaved change/
      );
      expect(await app.evaluate<boolean>(`!!document.querySelector('.grid__cell--dirty')`)).toBe(true);

      await app.evaluate(`${saveAction('Save')}.click(); true;`);
      await Bun.sleep(1500);

      // Saved: the bar is gone and the re-browsed grid carries the new value.
      // Asserted across the column rather than at row 0, since a re-browsed row
      // can change place (Postgres moves an updated tuple).
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="results-savebar"]').length`)).toBe(0);
      const weights = await app.evaluate<string[]>(
        `[...document.querySelectorAll('.grid tbody tr')].map(tr => tr.querySelectorAll('td:not(.gutter)')[1].textContent)`
      );
      expect(weights).toContain(next);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('Set NULL and Delete stage on the grid, and Discard clears them', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      // Set a cell to NULL through the editor's ∅ button -- distinct from empty.
      await app.evaluate(dblClick(gridCell(0, 1)));
      await Bun.sleep(300);
      await app.evaluate(
        `document.querySelector('[data-testid="cell-edit-null"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true;`
      );
      await Bun.sleep(300);
      expect(await app.evaluate<boolean>(`!!${gridCell(0, 1)}.querySelector('[data-testid="null-value"]')`)).toBe(true);

      // Stage a delete on the second row: select its gutter, press Delete.
      await app.evaluate(`document.querySelectorAll('.grid tbody tr')[1].querySelector('.gutter').click(); true;`);
      await Bun.sleep(150);
      await app.evaluate(
        `document.querySelector('[data-testid="grid-scroll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); true;`
      );
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__row--deleted').length`)).toBe(1);

      // Discard drops every staged change without touching the database.
      await app.evaluate(`${saveAction('Discard')}.click(); true;`);
      await Bun.sleep(300);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="results-savebar"]').length`)).toBe(0);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__row--deleted').length`)).toBe(0);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="null-value"]').length`)).toBe(0);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('copies selected rows as tab-separated text', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      // Select both rows through the gutter (click, then shift-click) and copy.
      await app.evaluate(`document.querySelectorAll('.grid tbody tr')[0].querySelector('.gutter').click(); true;`);
      await Bun.sleep(150);
      await app.evaluate(`
        document.querySelectorAll('.grid tbody tr')[1].querySelector('.gutter')
          .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); true;`);
      await Bun.sleep(150);
      await app.evaluate(
        `document.querySelector('[data-testid="grid-scroll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(300);

      const clip = await app.evaluate<string>(`Neutralino.clipboard.readText()`);
      // Two rows, columns tab-separated -- label then weight.
      expect(clip.split('\n')).toHaveLength(2);
      expect(clip).toContain('\t');

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('copies a row as an INSERT statement, reachable from a cell or the row gutter', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      // The weight column is mutated (and left mutated) by the save test above,
      // so the row is read back rather than assuming a literal survives a run.
      const label = await app.evaluate<string>(`${gridCell(0, 0)}.textContent`);
      const weight = await app.evaluate<string>(`${gridCell(0, 1)}.textContent`);

      // The row gutter opens the same menu a data cell does, but with no cell
      // in context -- "Set NULL" targets a column and leaves itself out.
      await app.evaluate(rightClickGutter(0));
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(menuItemLabels)).toEqual(['Copy row', 'Copy as SQL', 'Delete row']);

      await app.evaluate(clickContextItem('Copy as SQL'));
      await Bun.sleep(300);
      // Table and column names quoted per dialect, values as literals.
      expect(await app.evaluate<string>(`Neutralino.clipboard.readText()`)).toBe(
        `INSERT INTO "public"."tags" ("label", "weight") VALUES\n('${label}', '${weight}');`
      );

      // A data cell's menu carries the same item, alongside the column-specific one.
      await app.evaluate(`${gridCell(0, 0)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); true;`);
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(menuItemLabels)).toEqual(['Copy row', 'Copy as SQL', 'Set NULL', 'Delete row']);
      await app.evaluate(pressEscape);
      await Bun.sleep(150);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('clicking a cell selects it alone, arrow keys move it, and Ctrl+C copies its value', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      await app.evaluate(`${gridCell(0, 0)}.click(); true;`);
      await Bun.sleep(150);
      expect(await app.evaluate<boolean>(`${gridCell(0, 0)}.classList.contains('grid__cell--selected')`)).toBe(true);
      // Cell and row selection are mutually exclusive.
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__row--selected').length`)).toBe(0);

      const label = await app.evaluate<string>(`${gridCell(0, 0)}.textContent`);
      await app.evaluate(
        `document.querySelector('[data-testid="grid-scroll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(300);
      expect(await app.evaluate<string>(`Neutralino.clipboard.readText()`)).toBe(label);

      // Arrow-right moves the highlight to the next column, not a copy of it.
      await app.evaluate(
        `document.querySelector('[data-testid="grid-scroll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true;`
      );
      await Bun.sleep(150);
      expect(await app.evaluate<boolean>(`${gridCell(0, 1)}.classList.contains('grid__cell--selected')`)).toBe(true);
      expect(await app.evaluate<boolean>(`${gridCell(0, 0)}.classList.contains('grid__cell--selected')`)).toBe(false);

      // Selecting a row in turn clears the cell selection -- each clears the other.
      await app.evaluate(`document.querySelectorAll('.grid tbody tr')[0].querySelector('.gutter').click(); true;`);
      await Bun.sleep(150);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__cell--selected').length`)).toBe(0);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('shift-clicking a second cell selects the rectangle between them, copied as TSV', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      await app.evaluate(`${gridCell(0, 0)}.click(); true;`);
      await Bun.sleep(150);
      await app.evaluate(shiftClickCell(1, 1));
      await Bun.sleep(150);

      // `tags` is two rows of two columns, so the corners span the whole grid.
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__cell--selected').length`)).toBe(4);
      // The range is outlined once around its boundary, not boxed cell by cell:
      // the top-left corner draws its top and left edges and nothing else, where
      // a per-cell box would be all four. Counting `inset` survives the browser
      // rewriting the colour and the lengths, which parsing the value would not.
      const insets = (expr: string) =>
        `(getComputedStyle(${expr}).boxShadow.match(/inset/g) || []).length`;
      expect(await app.evaluate<number>(insets(gridCell(0, 0)))).toBe(2);
      expect(await app.evaluate<number>(insets(gridCell(1, 1)))).toBe(2);

      const shown = await app.evaluate<string[][]>(
        `[...document.querySelectorAll('.grid tbody tr')].map(tr => [...tr.querySelectorAll('td:not(.gutter)')].map(td => td.textContent))`
      );
      await app.evaluate(
        `document.querySelector('[data-testid="grid-scroll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(300);
      // Cells on tabs, rows on newlines -- the shape "Copy row" already produces.
      expect(await app.evaluate<string>(`Neutralino.clipboard.readText()`)).toBe(
        shown.map((row) => row.join('\t')).join('\n')
      );

      // Shift+Arrow shrinks the same range from the same anchor, rather than
      // moving a single cell the way a bare arrow does.
      await app.evaluate(
        `document.querySelector('[data-testid="grid-scroll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })); true;`
      );
      await Bun.sleep(150);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__cell--selected').length`)).toBe(2);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('dragging across cells selects the rectangle they span', async () => {
      await app.evaluate(clickTable('tags'));
      await Bun.sleep(1500);

      await app.evaluate(dragCells([0, 0], [1, 1]));
      await Bun.sleep(150);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__cell--selected').length`)).toBe(4);

      // The release ends the drag: hovering afterwards must not keep extending.
      await app.evaluate(hoverCell(0, 1));
      await Bun.sleep(150);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__cell--selected').length`)).toBe(4);

      await app.evaluate(closeTab('tags'));
      await Bun.sleep(300);
    });

    test('a range is outlined once around its edge, so cells inside it draw no border', async () => {
      // `users` is wide enough to have a column with a selected column on either
      // side of it, which `tags` at two columns can never have.
      await app.evaluate(clickTable('users'));
      await Bun.sleep(1500);

      await app.evaluate(dragCells([0, 0], [1, 2]));
      await Bun.sleep(150);
      expect(await app.evaluate<number>(`document.querySelectorAll('.grid__cell--selected').length`)).toBe(6);

      // Counting `inset` rather than parsing the value, which the browser
      // rewrites into its own colour and length spelling.
      const insets = (expr: string) =>
        `(getComputedStyle(${expr}).boxShadow.match(/inset/g) || []).length`;
      // The middle column is inside the span left-to-right, so its cells carry
      // only the horizontal edge they sit on -- one line each, not a box. This
      // is the whole difference between one outline and a lattice of them.
      expect(await app.evaluate<number>(insets(gridCell(0, 1)))).toBe(1);
      expect(await app.evaluate<number>(insets(gridCell(1, 1)))).toBe(1);
      // The corners still close the rectangle: two edges apiece.
      expect(await app.evaluate<number>(insets(gridCell(0, 0)))).toBe(2);
      expect(await app.evaluate<number>(insets(gridCell(1, 2)))).toBe(2);
      // And a cell outside it draws nothing at all -- no fill, no border.
      expect(await app.evaluate<number>(insets(gridCell(0, 4)))).toBe(0);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
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
      // Monaco classifies each token into a category (keyword, string, comment,
      // etc.) and assigns a distinct class per category. One class across every
      // span means no grammar ran — every token reads as plain text.
      //
      // Waited for rather than slept on: tokenizing is asynchronous and its
      // latency depends on what the editor was doing beforehand, so a fixed
      // sleep here passes or fails according to how many tests ran before it.
      const classes = await app.waitFor<string[]>(`(() => {
        const seen = [...document.querySelectorAll('.view-lines .view-line span span')]
          .map(e => e.className).filter(Boolean);
        return new Set(seen).size > 1 ? seen : null;
      })()`);
      expect(new Set(classes).size).toBeGreaterThan(1);
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

    test('a default-schema table is suggested both qualified and bare', async () => {
      // A `public` relation resolves either way, so both are offered -- type
      // `users` or `public.users`. Each assertion prefixes with the form it wants
      // so the virtualised list is narrowed to it: `public|` to the qualified,
      // `user|` to the bare.
      expect(await suggest('SELECT * FROM public|')).toContain('public.users');
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

    test('a schema followed by a dot offers that schema\'s relations', async () => {
      // `public.` is the whole gesture: a name in the FROM ending in a dot is
      // scanned as a bogus table, so this only works because an empty column
      // answer for it falls through to the schema. The relations come out bare,
      // the schema being already typed to the left of the dot.
      const inPublic = await suggest('SELECT * FROM public.|');
      expect(inPublic).toContain('users');
      expect(inPublic).toContain('active_users');
      // The other schema answers for its own relations, not public's -- proof it
      // is the typed schema being read, not one list of every table.
      const inReporting = await suggest('SELECT * FROM reporting.|');
      expect(inReporting).toContain('daily_stats');
      expect(inReporting).not.toContain('users');
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

    /*
     * The bug this replaced had every ingredient come from the database:
     * `users."eventType"` is stored mixed-case, so a suggestion inserted as it
     * is labelled leaves Postgres folding it to `eventtype` and refusing a query
     * whose column name came straight out of the catalog.
     *
     * It is asserted by *running* the query, not only by reading the text back.
     * The text is a proxy for the claim, and the failure being fixed was a
     * statement that looked perfectly reasonable on screen.
     */
    test('a mixed-case column is inserted quoted, and the query it makes runs', async () => {
      expect(await acceptSuggestion('SELECT eventT| FROM users')).toBe('SELECT "eventType" FROM users');

      await app.evaluate(`document.querySelector('[data-testid="run-btn"]').click(); true;`);
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="note-error"]').length`)).toBe(0);
    });

    test('a column that needs no quoting is inserted bare', async () => {
      // The other half, and the reason the rule is conditional: quoting every
      // name would pass the test above while putting quotes through every query
      // anyone writes.
      expect(await acceptSuggestion('SELECT ema| FROM users')).toBe('SELECT email FROM users');
    });

    test('a SQL error is surfaced in the results pane', async () => {
      await app.evaluate(setEditorText('SELECT * FROM does_not_exist'));
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('[data-testid="run-btn"]').click(); true;`);
      await Bun.sleep(1500);

      const err = await app.evaluate<string>(`document.querySelector('[data-testid="note-error"]')?.textContent ?? ''`);
      expect(err).toMatch(/does_not_exist/);
    });

    /*
     * The tree and the tab in front are paired by default, and the pairing runs
     * both ways -- which is the whole of what the two arrows on the toggle say.
     * Every test below this one is about them being *un*paired, so this is also
     * where the suite unpins them.
     */
    test('the tree follows the tab, and the sidebar picker brings the tab along', async () => {
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(true);

      await app.evaluate(selectTabDatabase('postgres'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(editorDatabase)).toBe('postgres');
      expect(await app.evaluate<string>(treeDatabase)).toBe('postgres');

      // The other direction: a pick in the sidebar that moved only the tree
      // would be undone by the next render, since a following tree *is* the
      // tab's database. The tab moving with it is what makes the pick land.
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');
      expect(await app.evaluate<string>(editorDatabase)).toBe('shop');
      expect(await app.evaluate<string[]>(treeLabels)).toContain('users');
    });

    test('unpinning freezes the tree where it stands rather than moving it', async () => {
      await app.evaluate(clickSyncToggle);
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(false);
      // The pin was kept level with the tab while it followed, so the toggle's
      // own first effect is nothing at all -- a control that moved the thing it
      // was pressed over would say nothing about what it does.
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');
      expect(await app.evaluate<string>(editorDatabase)).toBe('shop');
    });

    /*
     * The database belongs to the tab, not to the connection: this is the
     * assertion the whole `tabsSlice` shape exists for now. Pointing one tab
     * somewhere else leaves every other tab where it was.
     *
     * The tab that was never moved is the real subject here. A picker that
     * "remembered" `postgres` for it would be the connection-scoped shape
     * wearing a per-tab field.
     *
     * And with the tree unpinned it does not come along, in either direction:
     * not when a tab is pointed elsewhere, and not when the tab in front is
     * swapped for one that runs elsewhere. A tree that re-rooted on a tab
     * switch moved out from under whatever was being read, for a gesture that
     * was about the tabs.
     */
    test('a tab moves database on its own, and the tree stays where it was put', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      const second = await app.evaluate<string>(activeTabLabel);

      await app.evaluate(selectTabDatabase('postgres'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string>(editorDatabase)).toBe('postgres');
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');

      // Back to the first tab, which was never pointed anywhere: it is still on
      // `shop`, and the tree -- already on `shop` -- was never asked to move.
      await app.evaluate(clickTab('Query 3'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string>(editorDatabase)).toBe('shop');
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');

      await closeTabConfirmed(second);
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(treeLabels)).toContain('users');
    });

    /*
     * The other half of the same split, and the one that says which control
     * owns which fact once they are unpinned: the sidebar's picker browses, and
     * browsing moves nothing that is already running. It is put back on `shop`
     * at the end because the rest of this block reads `shop`'s tree.
     */
    test('the sidebar picker moves the tree, not the tab in front', async () => {
      await app.evaluate(selectDatabase('postgres'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(treeDatabase)).toBe('postgres');
      expect(await app.evaluate<string>(editorDatabase)).toBe('shop');

      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string[]>(treeLabels)).toContain('users');
    });

    /*
     * A table clicked in the tree opens on **the tree's** database, never on
     * the one the tab in front happens to run against. This is the assertion
     * the two facts being separate is paid for by: with the tab pointed at
     * `postgres` and the tree still on `shop`, inheriting would open a grid
     * that fails to browse the instant it appears -- so rows, not an error, is
     * what says the right database was used.
     */
    test('a table opens on the database the tree is browsing', async () => {
      await app.evaluate(selectTabDatabase('postgres'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string>(editorDatabase)).toBe('postgres');

      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(rowCount)).toBe(2);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="note-error"]')?.textContent ?? ''`)).toBe('');

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
      // The tab goes back where the rest of this block expects to run. The tree
      // never left `shop`, so there is nothing to put back there.
      await app.evaluate(selectTabDatabase('shop'));
      await Bun.sleep(1200);
    });

    /*
     * A grid tab's own picker: the caret on *Search*, which is the editor
     * toolbar's caret on Run one kind of tab over. The database is named in the
     * results bar rather than beside the caret, the same split the editor draws
     * between the label at its far left and the arrow on its loudest control.
     *
     * `postgres` holds no `users`, so a failed browse is what proves the tab
     * really moved -- and picking `shop` back proves the move is not one-way.
     */
    test('a grid tab moves database from the caret on Search', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(rowCount)).toBe(2);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="results-db"]').textContent`)).toBe('shop');

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="grid-db-select"]'), 'postgres');`);
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="note-error"]').length`)).toBe(1);
      // It moved the tab and nothing else: the tree is where it was left.
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="grid-db-select"]'), 'shop');`);
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(rowCount)).toBe(2);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="results-db"]').textContent`)).toBe('shop');

      await app.evaluate(closeTab('users'));
      await Bun.sleep(300);
    });

    /*
     * Ctrl+R re-reads the page on screen. Proven against a row written from
     * another tab, because a grid that never re-read would show the same two
     * rows and pass anything weaker -- and the row is deleted and the grid
     * refreshed a second time, which both cleans up after this test and says
     * the refresh is a real read rather than a one-off.
     *
     * **Pressed for real, not dispatched**, for `Ctrl+W`'s reason exactly: this
     * chord is the webview's *reload*, so a synthetic event would prove the
     * handler works while a physical key reloaded the app out from under it.
     * The connection surviving -- launch lands on the connections list and
     * nothing auto-connects, so a reload would leave no grid at all -- is as
     * much of the assertion as the row count.
     *
     * `logs` is the subject for the reason the read-only test uses it: nothing
     * else in this block depends on what is in it.
     */
    test('a real Ctrl+R re-reads the rows, and does not reload the app', async () => {
      await app.evaluate(clickTable('logs'));
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(rowCount)).toBe(2);

      await app.evaluate(newTab);
      await Bun.sleep(400);
      const scratch = await app.evaluate<string>(activeTabLabel);

      const runInScratch = async (sql: string) => {
        await app.evaluate(clickTab(scratch));
        await Bun.sleep(400);
        await app.evaluate(setEditorText(sql));
        await Bun.sleep(200);
        await app.evaluate(pressChord(`key: 'Enter', ctrlKey: true`));
        await Bun.sleep(1500);
      };

      await runInScratch(`INSERT INTO logs (msg) VALUES ('refreshed')`);

      await app.evaluate(clickTab('logs'));
      await Bun.sleep(600);
      // Nothing polls: the grid still shows the page it fetched.
      expect(await app.evaluate<number>(rowCount)).toBe(2);

      await app.press('r', { ctrl: true });
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(3);
      // The app is still the one that was running: a reload lands on the
      // connections list with no tabs at all.
      expect(await app.evaluate<string[]>(tabLabels)).toContain('logs');

      await runInScratch(`DELETE FROM logs WHERE msg = 'refreshed'`);
      await app.evaluate(clickTab('logs'));
      await Bun.sleep(600);
      await app.press('r', { ctrl: true });
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBe(2);

      await app.evaluate(closeTab('logs'));
      await Bun.sleep(300);
      await closeTabConfirmed(scratch);
      await Bun.sleep(300);
    });

    /*
     * The caret picker fused to the Run button sits at the right edge of its
     * pane, which unmaximised is the right edge of the window -- so it is the
     * one control where a popup placed a few pixels too far right is clipped
     * rather than merely off-centre. It was: placement measures the popup
     * before its own `minWidth` has ever reached it, and a list narrower than
     * that floor was hung off the trigger's right edge by the content's width
     * and then widened past it.
     *
     * Driven on a *fresh mount*, which is the state that shipped it and is one
     * click away in ordinary use: the toolbar is unmounted while a grid tab is
     * in front, so coming back from one hands the picker its initial, unplaced
     * position again. Asserted on the geometry rather than on a screenshot,
     * because the claim is "inside the window" and that is a number.
     */
    test('the tab\'s database list opens inside the window', async () => {
      await app.evaluate(clickTable('users'));
      await Bun.sleep(1500);
      await app.evaluate(closeTab('users'));
      await Bun.sleep(600);

      const box = await app.evaluate<{ left: number; right: number; innerWidth: number }>(`${REACT_SETTERS}
        (async () => {
          const trigger = document.querySelector('[data-testid="editor-db-select"]');
          trigger.click();
          await waitForNode('[data-testid="editor-db-select-popup"]');
          await new Promise((r) => setTimeout(r, 150));
          const r = document.querySelector('[data-testid="editor-db-select-popup"]').getBoundingClientRect();
          // The trigger toggles, so a second click shuts it -- no keypress
          // needed, and none would land while focus is where a script left it.
          trigger.click();
          return { left: r.left, right: r.right, innerWidth: window.innerWidth };
        })()`);

      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.innerWidth);
    });

    /*
     * Right-clicking a table used to do nothing; now it is the surface the
     * per-table actions hang off. The four are asserted as one list because the
     * menu being the whole surface is the point -- a stray fifth entry, or a
     * missing one, is the regression. We are on `shop` with `users` in the tree
     * from the test above.
     */
    test('right-clicking a table opens its action menu', async () => {
      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(menuItemLabels)).toEqual(['Copy name', 'Open definition', 'Star', 'Drop table']);
      // Dismisses on Escape, like every floating thing here.
      await app.evaluate(pressEscape);
      await Bun.sleep(150);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="context-menu"]').length`)).toBe(0);
    });

    /*
     * Starring lifts a table into its own "Starred" group at the top and out of
     * the list below -- not repeated in it. Unstarring puts it back exactly
     * where the plain sort already had it.
     */
    test('starring a table pins it above the rest, and unstarring returns it', async () => {
      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(200);
      await app.evaluate(clickContextItem('Star'));
      await Bun.sleep(400);

      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="tree-pinned"]')`)).toBe(true);
      const pinnedLabels = `[...document.querySelector('[data-testid="tree-pinned"]').querySelectorAll('[data-testid="tree-label"]')].map(e => e.textContent)`;
      expect(await app.evaluate<string[]>(pinnedLabels)).toEqual(['users']);

      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(200);
      // The menu now offers to reverse it, worded for the state it found.
      expect(await app.evaluate<string[]>(menuItemLabels)).toContain('Unstar');
      await app.evaluate(clickContextItem('Unstar'));
      await Bun.sleep(400);

      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="tree-pinned"]')`)).toBe(false);
    });

    test('the menu names a view a view', async () => {
      // A view is a relation too, so it gets the menu -- with the drop reading
      // "Drop view", because that is the statement it will run.
      await app.evaluate(rightClickTable('active_users'));
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(menuItemLabels)).toContain('Drop view');
      await app.evaluate(pressEscape);
      await Bun.sleep(150);
    });

    /*
     * The interesting seam: the DDL is fetched, a new editor tab is minted for
     * it, and its Monaco model is born holding the text -- seeded before the
     * model exists, never written into a live one. The tab is named for the
     * table, and the text is the engine's own CREATE.
     */
    test('"Open definition" opens the CREATE in a new named editor tab', async () => {
      const before = await app.evaluate<number>(`document.querySelectorAll('[data-testid="tab"]').length`);

      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(200);
      await app.evaluate(clickContextItem('Open definition'));
      await Bun.sleep(1500);

      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="tab"]').length`)).toBe(before + 1);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('users');
      expect(await app.evaluate<string | null>(editorText)).toContain('CREATE TABLE');

      // Close the definition tab (it is the active one) to hand the next test a
      // clean strip.
      await app.evaluate(`document.querySelector('[data-testid="tab-pick"][aria-selected="true"]').parentElement.querySelector('[data-testid="tab-close"]').click(); true;`);
      await Bun.sleep(300);
    });

    /*
     * Drop is guarded by the typed-name modal, the same friction as leaving
     * read-only. This drives it up to the point of confirmation and cancels: the
     * actual DROP is covered against the real server in the extension suite, and
     * dropping a fixture object here would break the suite's re-runnability.
     */
    test('dropping asks for the name typed back, and cancels cleanly', async () => {
      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(200);
      await app.evaluate(clickContextItem('Drop table'));
      await Bun.sleep(300);

      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="modal"]')`)).toBe(true);
      const confirmDisabled = `document.querySelector('[data-testid="modal-submit"]').disabled`;
      expect(await app.evaluate<boolean>(confirmDisabled)).toBe(true);

      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('[data-testid="modal-input"]'), 'not-the-name'); true;`);
      await Bun.sleep(150);
      expect(await app.evaluate<boolean>(confirmDisabled)).toBe(true);

      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('[data-testid="modal-input"]'), 'users'); true;`);
      await Bun.sleep(150);
      expect(await app.evaluate<boolean>(confirmDisabled)).toBe(false);

      // Cancel: the table is untouched, and the modal is gone.
      await app.evaluate(`[...document.querySelectorAll('[data-testid="modal"] button')].find(e => e.textContent === 'Cancel').click(); true;`);
      await Bun.sleep(300);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="modal"]')`)).toBe(false);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="tree-label"]')].map(e => e.textContent)`))
        .toContain('users');
    });

    /*
     * A read-only connection refuses a drop from the UI: read-only is the server
     * refusing writes, but it does not reliably cover DDL, so the menu is where
     * that intent is honoured for a DROP. Locking is immediate; unlocking wants
     * the environment typed back, which the status bar spells out.
     */
    test('a read-only connection disables Drop', async () => {
      const env = await app.evaluate<string>(`document.querySelector('[data-testid="statusbar-env"]').textContent`);

      // Lock it -- turning read-only on is the safe direction, so it is immediate.
      await app.evaluate(`document.querySelector('[data-testid="statusbar-lock"]').click(); true;`);
      await Bun.sleep(500);

      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(200);
      expect(await app.evaluate<boolean>(`${contextItem('Drop table')}.disabled`)).toBe(true);
      await app.evaluate(pressEscape);
      await Bun.sleep(150);

      // Unlock again, so the connection is left as it was found.
      await app.evaluate(`document.querySelector('[data-testid="statusbar-lock"]').click(); true;`);
      await Bun.sleep(300);
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('[data-testid="modal-input"]'), ${JSON.stringify(env)}); true;`);
      await Bun.sleep(150);
      await app.evaluate(`document.querySelector('[data-testid="modal-submit"]').click(); true;`);
      await Bun.sleep(400);
    });

    /*
     * The tab strip's own menu and its drag. This block runs last in the Postgres
     * suite because it ends by closing every tab, and it names nothing it did not
     * make -- the `Query N` counter has been moved by earlier tests, so each tab
     * created here is read back rather than assumed.
     */
    test('right-clicking a tab offers close, duplicate and the three bulk closes', async () => {
      await app.evaluate(rightClickTab('Query 3'));
      await Bun.sleep(200);

      // Asserted as one list for the same reason the tree's menu is: the menu
      // being the whole surface is the point. `Close` leads it — it is the item
      // the menu was reached for, and its absence read as the tab having no way
      // to be closed at all.
      expect(await app.evaluate<string[]>(menuItemLabels)).toEqual([
        'Close', 'Duplicate', 'Close others', 'Close Tabs to the Right', 'Close All',
      ]);

      // One tab open: there is nothing to close except it, and nothing to its
      // right. Both say so rather than being offered and doing nothing --
      // unlike `Close`, which is exactly what one tab open still offers.
      expect(await app.evaluate<boolean>(`${contextItem('Close')}.disabled`)).toBe(false);
      expect(await app.evaluate<boolean>(`${contextItem('Close others')}.disabled`)).toBe(true);
      expect(await app.evaluate<boolean>(`${contextItem('Close Tabs to the Right')}.disabled`)).toBe(true);

      await app.evaluate(pressEscape);
      await Bun.sleep(150);
    });

    /*
     * Duplicate copies the text, and the copy is its own tab from then on. The
     * second half is the half that matters: a copy sharing the original's text
     * would be one model behind two labels, which is what the per-tab model
     * exists to prevent.
     */
    test('duplicating a tab copies its text, and the two are independent', async () => {
      await app.evaluate(setEditorText('SELECT 1 -- the original'));
      await Bun.sleep(300);

      await app.evaluate(rightClickTab('Query 3'));
      await Bun.sleep(200);
      await app.evaluate(clickContextItem('Duplicate'));
      await Bun.sleep(600);

      const copy = await app.evaluate<string>(activeTabLabel);
      expect(copy).not.toBe('Query 3');
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 3', copy]);
      expect(await app.evaluate<string | null>(editorText)).toContain('the original');

      await app.evaluate(setEditorText('SELECT 2 -- the copy'));
      await Bun.sleep(300);
      await app.evaluate(clickTab('Query 3'));
      await Bun.sleep(400);
      expect(await app.evaluate<string | null>(editorText)).toContain('the original');
    });

    /*
     * Renaming, and the three ways out of the inline editor: Enter commits,
     * Escape discards the draft, and a blank commit is discarded too -- a tab
     * always has a name. Ends by renaming back to `Query 3`, the name every
     * later test in this block reads by, so nothing downstream has to change.
     */
    test('double-clicking a tab label renames it inline', async () => {
      const dblClickLabel = (label: string) => `
        ${tab(label)}.querySelector('[data-testid="tab-label"]')
          .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true;`;
      const renameInput = `document.querySelector('[data-testid="tab-rename-input"]')`;
      const pressKey = (key: string) => `${renameInput}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); true;`;
      const setDraft = (text: string) => `${REACT_SETTERS} setNative(${renameInput}, ${JSON.stringify(text)}); true;`;
      // `execCommand('insertText', ...)` inserts respecting whatever is
      // selected, the way a real keystroke does -- unlike `setNative`, which
      // force-writes the whole value and would sail straight past the bug this
      // guards: an inline ref callback that re-selected the input's contents
      // after every keystroke, so each new character replaced the fully
      // selected one before it and only the last one ever stuck.
      const typeChar = (ch: string) => `document.execCommand('insertText', false, ${JSON.stringify(ch)}); true;`;

      await app.evaluate(dblClickLabel('Query 3'));
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="tab-rename-input"]').length`)).toBe(1);

      for (const ch of 'Renamed') {
        await app.evaluate(typeChar(ch));
        await Bun.sleep(50);
      }
      expect(await app.evaluate<string>(`${renameInput}.value`)).toBe('Renamed');

      await app.evaluate(pressKey('Enter'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(tabLabels)).toContain('Renamed');
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="tab-rename-input"]').length`)).toBe(0);

      // A blank commit is discarded rather than saved empty.
      await app.evaluate(dblClickLabel('Renamed'));
      await Bun.sleep(200);
      await app.evaluate(setDraft(''));
      await Bun.sleep(150);
      await app.evaluate(pressKey('Enter'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(tabLabels)).toContain('Renamed');

      // Escape discards the draft without committing it.
      await app.evaluate(dblClickLabel('Renamed'));
      await Bun.sleep(200);
      await app.evaluate(setDraft('Should not stick'));
      await Bun.sleep(150);
      await app.evaluate(pressKey('Escape'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(tabLabels)).toContain('Renamed');
      expect(await app.evaluate<string[]>(tabLabels)).not.toContain('Should not stick');

      // Restored, so the rest of this block still finds `Query 3`.
      await app.evaluate(dblClickLabel('Renamed'));
      await Bun.sleep(200);
      await app.evaluate(setDraft('Query 3'));
      await Bun.sleep(150);
      await app.evaluate(pressKey('Enter'));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(tabLabels)).toContain('Query 3');
    });

    /*
     * Reordering moves the tab and nothing else -- picking a tab up is not
     * selecting it, so the tab you were working in is still the tab you are in
     * when you put it down.
     */
    test('dragging a tab drops it in front of another', async () => {
      const [, copy] = await app.evaluate<string[]>(tabLabels);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('Query 3');

      await app.evaluate(dragTabStart(copy!));
      await Bun.sleep(200);
      await app.evaluate(dragTabOver('Query 3'));
      await Bun.sleep(200);
      await app.evaluate(dropTab('Query 3'));
      await Bun.sleep(400);

      expect(await app.evaluate<string[]>(tabLabels)).toEqual([copy, 'Query 3']);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('Query 3');
    });

    test('"Close Tabs to the Right" closes those and lands you on the one you asked from', async () => {
      const [first] = await app.evaluate<string[]>(tabLabels);
      await app.evaluate(newTab);
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(tabLabels)).toHaveLength(3);

      // One of the two it takes was typed into by the tests above, so this is
      // also the bulk confirm: one dialog for the gesture, not one per tab.
      await menuCloseConfirmed(first!, 'Close Tabs to the Right');

      // The active tab was one of the two just closed, so it has to land
      // somewhere -- and the tab the menu was summoned from is the only answer
      // that is not arbitrary.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([first]);
      expect(await app.evaluate<string>(activeTabLabel)).toBe(first);
    });

    test('"Close others" leaves the one it was asked from', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(500);
      const keep = await app.evaluate<string>(activeTabLabel);
      await app.evaluate(newTab);
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(tabLabels)).toHaveLength(3);

      await menuCloseConfirmed(keep, 'Close others');

      expect(await app.evaluate<string[]>(tabLabels)).toEqual([keep]);
      expect(await app.evaluate<string>(activeTabLabel)).toBe(keep);
    });

    test('"Close All" leaves the empty state, with no tabs', async () => {
      const [only] = await app.evaluate<string[]>(tabLabels);

      await menuCloseConfirmed(only!, 'Close All');

      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
      const note = await app.evaluate<string>(`document.querySelector('[data-testid="note-muted"]')?.textContent ?? ''`);
      expect(note).toContain('Nothing open');
    });

    /*
     * The tab shortcuts, from the empty state the test above leaves.
     *
     * Every chord is dispatched at an element and left to bubble, the way a
     * real keypress travels: `Shell`'s listener is on the window, and firing at
     * the window directly would skip the propagation that decides whether
     * Monaco gets there first.
     *
     * **Two panes are counted as two `.editor` divs**, which is what a split
     * *is* here — there is no split flag to read, and `tabLabels` spans both
     * strips, so the tab count cannot tell a docked tab from a second tab.
     */
    test('the tab shortcuts open, step through and dock tabs', async () => {
      const panes = `document.querySelectorAll('.editor').length`;

      await app.evaluate(pressChord(`key: 't', ctrlKey: true`));
      await Bun.sleep(400);
      await app.evaluate(pressChord(`key: 't', ctrlKey: true`));
      await Bun.sleep(400);

      const [first, second] = await app.evaluate<string[]>(tabLabels);
      expect(second).toBeDefined();
      // A new tab arrives in front, which is what makes the step below a step.
      expect(await app.evaluate<string>(activeTabLabel)).toBe(second);

      // Next off the end wraps to the first, and previous comes back.
      await app.evaluate(pressChord(`key: 'PageDown', ctrlKey: true`));
      await Bun.sleep(300);
      expect(await app.evaluate<string>(activeTabLabel)).toBe(first);
      await app.evaluate(pressChord(`key: 'PageUp', ctrlKey: true`));
      await Bun.sleep(300);
      expect(await app.evaluate<string>(activeTabLabel)).toBe(second);

      // The dock gesture on the keyboard: the tab in front moves to the pane
      // that had none, which is the whole of what a split is.
      expect(await app.evaluate<number>(panes)).toBe(1);
      await app.evaluate(pressChord(`key: '\\\\', ctrlKey: true`));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(panes)).toBe(2);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([first, second]);

      // And again ends it: the primary pane's last tab leaves, so the survivors
      // take the whole view back rather than sitting beside an empty pane.
      await app.evaluate(pressChord(`key: '\\\\', ctrlKey: true`));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(panes)).toBe(1);
      expect(await app.evaluate<string[]>(tabLabels)).toHaveLength(2);

      // Back to the empty state the test below starts from — and Ctrl+W is what
      // gets there, so the cleanup is the assertion. Neither tab was typed into,
      // so neither raises the unsaved dialog.
      //
      // Asserted against whichever tab is *in front* rather than a named one:
      // the collapse above hands the surviving pane its own active tab, so which
      // of the two that is belongs to `promoteIfPrimaryEmpty` and not to this
      // test. What Ctrl+W claims is only ever "the one in front".
      const survivors = await app.evaluate<string[]>(tabLabels);
      const front = await app.evaluate<string>(activeTabLabel);
      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(survivors.filter((label) => label !== front));

      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);

      // Nothing open is not an error: the shortcut has no tab to act on.
      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * Ctrl+Shift+T, the Shift-pair of Ctrl+T: a tab minted in the *other* pane,
     * which with no split yet is what opens one. It is the only command that
     * produces a split by creating rather than by moving — `Ctrl+\` above still
     * only ever moves the tab in front.
     *
     * **The close at the end is the assertion that the tab really landed over
     * there.** Nothing focused the new pane, so `workingPane` is still primary
     * and Ctrl+W takes the *first* tab; the survivor being the second one is
     * only possible if the second was never in the primary strip.
     */
    test('the split-tab shortcut opens a tab in the other pane', async () => {
      const panes = `document.querySelectorAll('.editor').length`;

      await app.evaluate(pressChord(`key: 't', ctrlKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<number>(panes)).toBe(1);
      const [first] = await app.evaluate<string[]>(tabLabels);

      await app.evaluate(pressChord(`key: 'T', ctrlKey: true, shiftKey: true`));
      await Bun.sleep(500);

      expect(await app.evaluate<number>(panes)).toBe(2);
      expect(await app.evaluate<string[]>(tabLabels)).toHaveLength(2);

      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(500);
      const survivors = await app.evaluate<string[]>(tabLabels);
      expect(survivors).toHaveLength(1);
      expect(survivors[0]).not.toBe(first);
      // The pane it was alone in went with it: one tab left is one pane.
      expect(await app.evaluate<number>(panes)).toBe(1);

      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * Ctrl+Shift+F puts focus in the tree's filter, and unfolds the sidebar
     * first when it is folded away — focus cannot enter `display: none`, so a
     * shortcut that only focused would silently do nothing exactly when the
     * field is hardest to reach with the mouse.
     */
    test('the filter shortcut reveals the sidebar and puts the caret in it', async () => {
      const filterFocused = `document.activeElement === document.querySelector('[data-testid="sidebar-filter"]')`;
      const filterBarShown = `getComputedStyle(document.querySelector('[data-testid="sidebar-filter-bar"]')).display !== 'none'`;

      await app.evaluate(pressChord(`key: 'F', ctrlKey: true, shiftKey: true`));
      await Bun.sleep(300);
      expect(await app.evaluate<boolean>(filterFocused)).toBe(true);

      await app.evaluate(setFilter(''));
      await app.evaluate(pressChord(`key: 'b', ctrlKey: true`));
      await Bun.sleep(300);
      expect(await app.evaluate<boolean>(filterBarShown)).toBe(false);

      await app.evaluate(pressChord(`key: 'F', ctrlKey: true, shiftKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(filterBarShown)).toBe(true);
      expect(await app.evaluate<boolean>(filterFocused)).toBe(true);
    });

    /*
     * Ctrl+Shift+B is the same gesture as the toggle in the filter bar, so the
     * assertion is that the button reports what the key did: one command, two
     * ways in, and no second piece of state for them to disagree through. It is
     * put back afterwards because the rest of this block is written unpinned.
     */
    test('the sync shortcut is the sidebar toggle', async () => {
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(false);

      await app.evaluate(pressChord(`key: 'B', ctrlKey: true, shiftKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(true);

      await app.evaluate(pressChord(`key: 'B', ctrlKey: true, shiftKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(false);
    });

    /*
     * Ctrl+W as the *host* sees it, not as a `KeyboardEvent` the DOM was handed.
     *
     * Ctrl+W is a browser accelerator, and WebView2 ships with browser
     * accelerator keys enabled — so the question this shortcut had to answer
     * before it could ship is whether pressing it closes the window out from
     * under the app. A dispatched event cannot answer that: it enters below the
     * embedder and would pass whether or not a real key does. `app.press` goes
     * in where a physical key does, and the app still being there afterwards is
     * half of what is asserted.
     */
    test('a real Ctrl+W closes the tab and not the window', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      await app.evaluate(newTab);
      await Bun.sleep(400);
      const before = await app.evaluate<string[]>(tabLabels);
      expect(before).toHaveLength(2);

      await app.press('w', { ctrl: true });
      await Bun.sleep(500);

      // The window is still here to be asked, which is the accelerator question.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([before[0]]);

      await app.press('w', { ctrl: true });
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * The right-click menu is where people look for *Close*, and for most of
     * this app's life it offered only "close others" — which reads as there
     * being no way to close the tab you actually right-clicked.
     */
    test('the tab menu closes the tab it was summoned on', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      await app.evaluate(newTab);
      await Bun.sleep(400);
      const [first, second] = await app.evaluate<string[]>(tabLabels);

      await app.evaluate(rightClickTab(first!));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(menuItemLabels)).toEqual([
        'Close', 'Duplicate', 'Close others', 'Close Tabs to the Right', 'Close All',
      ]);

      await app.evaluate(clickContextItem('Close'));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([second]);

      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * Closing deletes the tab's text — `tabsClosed` drops its `sqlByTab` entry
     * and the session listener then writes a snapshot without it — so a tab
     * holding a query that exists nowhere else asks before it goes. Cancel has
     * to leave the tab *and* its text exactly where they were, which is the half
     * a dialog gets wrong by re-rendering the editor from a stale store.
     */
    test('closing a tab holding unsaved text asks first', async () => {
      await app.evaluate(newTab);
      await Bun.sleep(400);
      const [only] = await app.evaluate<string[]>(tabLabels);

      await app.evaluate(setEditorText('SELECT 1 -- never saved anywhere'));
      await Bun.sleep(400);

      await app.evaluate(closeTab(only!));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(closeConfirmShowing)).toBe(true);

      // Cancel closes nothing, and the text is still there to close.
      await app.evaluate(cancelCloseConfirm);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([only]);
      expect(await app.evaluate<string | null>(editorText)).toBe('SELECT 1 -- never saved anywhere');

      // The shortcut goes through the same gate as the ×.
      await app.evaluate(pressChord(`key: 'w', ctrlKey: true`));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(closeConfirmShowing)).toBe(true);

      await app.evaluate(answerCloseConfirm);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * A definition tab is generated text nobody typed, seeded at birth through
     * `tabOpened` rather than by a `setSql` — which is the whole reason it does
     * not count as unsaved work. Seed it the other way and every DDL you glance
     * at asks to be saved on the way out.
     */
    test('a table definition closes without being asked about', async () => {
      await app.evaluate(rightClickTable('users'));
      await Bun.sleep(300);
      await app.evaluate(clickContextItem('Open definition'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['users']);

      await app.evaluate(closeTab('users'));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(closeConfirmShowing)).toBe(false);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual([]);
    });

    /*
     * Last in this block on purpose: it reconnects, which resets the tabs and
     * the numbering everything above depends on. The block that follows opens
     * its own connection anyway, so ending on one costs nothing.
     */
    test('the tree-sync choice survives a relaunch, and is not tied to the connection', async () => {
      // Unpinned near the top of this block and never put back, which is what
      // makes this a real persistence check: the *default* surviving a relaunch
      // would prove only that nothing was read at all.
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(false);

      // `connect` reloads the webview, so this is the launch path: the settings
      // are read fresh from the store and no React state survives it.
      await connect(PG, 'pg-resync');
      await Bun.sleep(500);

      // Still unpinned -- a preference about trees, remembered globally rather
      // than against the connection it happened to be changed on.
      expect(await app.evaluate<boolean>(syncToggleOn)).toBe(false);

      // And it still behaves that way on a connection that has never seen the
      // toggle: the tree stays where it is put while the tab runs elsewhere.
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      await app.evaluate(selectTabDatabase('postgres'));
      await Bun.sleep(1200);
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');
      expect(await app.evaluate<string>(editorDatabase)).toBe('postgres');

      // The tab goes back where the block that follows expects to run.
      await app.evaluate(selectTabDatabase('shop'));
      await Bun.sleep(1200);
    });
  });

  /*
   * The diagram is drawn entirely from arithmetic over the catalog, so what only
   * the running app can prove is the wiring: that the menu reaches it, that it
   * draws the database the *tree* is on, that a node opens the table the way the
   * tree does, and that dragging one moves it without opening anything. The
   * shape of the catalog behind it is `extension.test.ts`' business.
   */
  describe('relationship diagram', () => {
    const nodeNames = `[...document.querySelectorAll('[data-testid="diagram-node-name"]')].map(e => e.textContent)`;
    const diagramShowing = `!!document.querySelector('[data-testid="diagram"]')`;
    /** Answers `null` for "not yet", or `waitFor` takes a `false` as an answer.
     *  Waits for a *node*, not the frame: the frame is up while the schema is
     *  still being read, and there is nothing to measure until the nodes land. */
    const diagramDrawn = `document.querySelector('[data-testid="diagram-node"]') ? true : null`;
    const node = (label: string) => `
      [...document.querySelectorAll('[data-testid="diagram-node"]')]
        .find(e => e.querySelector('[data-testid="diagram-node-name"]').textContent === ${JSON.stringify(label)})`;
    const nodeLeft = (label: string) => `${node(label)}.getBoundingClientRect().left`;
    /**
     * A node is dragged with plain pointer events at its own centre. It is both
     * the drag handle and the way into the table, so a press-move-release is
     * the only gesture that can tell the suite which of the two happened.
     */
    const dragNode = (label: string, dx: number, dy: number) => `(() => {
      const el = ${node(label)};
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const at = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, button: 0 }));
      el.setPointerCapture = () => {};
      at('pointerdown', x, y);
      at('pointermove', x + ${dx}, y + ${dy});
      at('pointerup', x + ${dx}, y + ${dy});
      return true;
    })()`;
    const clickNode = (label: string) => `(() => {
      const el = ${node(label)};
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const at = (type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
      el.setPointerCapture = () => {};
      at('pointerdown');
      at('pointerup');
      return true;
    })()`;
    const openDiagram = `document.querySelector('[data-menu="Database"]').click(); true;`;
    const clickDiagramItem = `[...document.querySelectorAll('[data-testid="menu-item"]')].find(e => e.textContent === 'Relationship diagram').click(); true;`;

    beforeAll(async () => {
      await connect(PG, 'pg-diagram');
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
    });

    test('the Database menu opens it on the database the tree is showing', async () => {
      await app.evaluate(openDiagram);
      await Bun.sleep(200);
      await app.evaluate(clickDiagramItem);
      await app.waitFor(diagramDrawn);

      const names = await app.evaluate<string[]>(nodeNames);
      expect(names).toContain('users');
      expect(names).toContain('events');
      expect(names).toContain('cities');
      // The default schema is left off a label and every other schema is spelled
      // out -- the tree's rule, applied to a node.
      expect(names).toContain('reporting.daily_stats');
      // A view is never a node: nothing can reference one.
      expect(names).not.toContain('active_users');

      // A tab of its own, in front, beside the `Query 1` the connection was
      // born with -- not an overlay, and not something that replaced anything.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Relationships']);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('Relationships');
    });

    test('dragging a node moves it and opens nothing', async () => {
      const before = await app.evaluate<number>(nodeLeft('users'));
      await app.evaluate(dragNode('users', 120, 40));
      await Bun.sleep(300);

      expect(await app.evaluate<number>(nodeLeft('users'))).toBeCloseTo(before + 120, 0);
      // A drag read as a click would have opened a grid tab, which is exactly
      // the confusion CLICK_SLOP exists to prevent. The strip is unchanged, and
      // the diagram is still the tab in front.
      expect(await app.evaluate<boolean>(diagramShowing)).toBe(true);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Relationships']);
    });

    test('the pane is not the canvas: dragging a node does not also scroll it', async () => {
      // Both gestures start with a pointerdown on the node, and the node's has
      // to stop there -- otherwise the canvas pans by the same delta the node
      // moves by, in the opposite direction, and the node crawls at half speed
      // under a view sliding out from under it. That is what "hard to pick up"
      // was, and a scroll offset is the only thing that shows it.
      const scrolled = `document.querySelector('[data-testid="diagram-canvas"]').scrollLeft`;
      const before = await app.evaluate<number>(scrolled);
      await app.evaluate(dragNode('users', 60, 0));
      await Bun.sleep(300);
      expect(await app.evaluate<number>(scrolled)).toBe(before);
    });

    /*
     * A node dragged out of the drawing's own bounds, in both directions — and
     * the two directions fail differently, which is why both are here.
     *
     * Dragging *out* is the canvas' business: an absolutely-positioned node
     * extends `scrollWidth` on its own, so it stays reachable either way, but
     * the sized element carrying the dot grid does not follow it and the node
     * ends up sitting on bare background outside the canvas it belongs to.
     *
     * Dragging *back past zero* is the one that used to lose it outright:
     * there is no negative scroll region, so a node at a negative coordinate
     * is somewhere nothing can scroll to. The drawing's origin moves out to
     * meet it instead, which is why the claim here is reachability rather
     * than the node having been stopped at the edge.
     */
    test('a node dragged past the edge stays on the canvas, in both directions', async () => {
      const canvas = `document.querySelector('[data-testid="diagram-canvas"]')`;
      // The scroll container's child is the sized element: what the dot grid is
      // painted on, and what has to grow with the nodes.
      const surfaceWidth = `${canvas}.firstElementChild.getBoundingClientRect().width`;
      const nodeRight = (label: string) => `${node(label)}.getBoundingClientRect().right`;

      const before = await app.evaluate<number>(surfaceWidth);
      await app.evaluate(dragNode('logs', 900, 0));
      await Bun.sleep(300);
      expect(await app.evaluate<number>(surfaceWidth)).toBeGreaterThan(before);

      // Reachable is the actual claim, so scroll to the end and require it to
      // be on screen — a surface that grew but stopped short would pass the
      // assertion about the number and still leave the node past the edge.
      await app.evaluate(`${canvas}.scrollLeft = ${canvas}.scrollWidth; true;`);
      await Bun.sleep(300);
      const paneRight = await app.evaluate<number>(`${canvas}.getBoundingClientRect().right`);
      expect(await app.evaluate<number>(nodeRight('logs'))).toBeLessThanOrEqual(paneRight);

      await app.evaluate(`${canvas}.scrollLeft = 0; ${canvas}.scrollTop = 0; true;`);
      await Bun.sleep(200);
      // Far enough to be well past the origin, which is where the clamp used
      // to stop it -- the node really does end up at a negative coordinate.
      await app.evaluate(dragNode('logs', -900, -400));
      await Bun.sleep(300);

      // Scrolling back to the origin is what reaches it now: the drawing's own
      // origin moved out with the node, so the container's zero is the node's
      // new corner rather than the layout's.
      await app.evaluate(`${canvas}.scrollLeft = 0; ${canvas}.scrollTop = 0; true;`);
      await Bun.sleep(200);
      const paneBox = await app.evaluate<{ left: number; top: number; right: number; bottom: number }>(
        `(() => { const r = ${canvas}.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`
      );
      const nodeBox = await app.evaluate<{ left: number; top: number }>(
        `(() => { const r = ${node('logs')}.getBoundingClientRect(); return { left: r.left, top: r.top }; })()`
      );
      expect(nodeBox.left).toBeGreaterThanOrEqual(paneBox.left);
      expect(nodeBox.top).toBeGreaterThanOrEqual(paneBox.top);
      expect(nodeBox.left).toBeLessThan(paneBox.right);
      expect(nodeBox.top).toBeLessThan(paneBox.bottom);
    });

    /*
     * The neighbours must not move while one node is dragged past the origin.
     * The drawing's origin moving out grows the canvas at its *leading* edge,
     * so everything already on screen slides right by that amount unless the
     * scroll offset is moved by the same delta — which reads as the whole
     * diagram jumping sideways while one node is being placed.
     */
    test('dragging a node past the origin leaves the rest of the diagram where it was', async () => {
      const before = await app.evaluate<number>(nodeLeft('users'));
      await app.evaluate(dragNode('logs', -600, 0));
      await Bun.sleep(300);
      expect(await app.evaluate<number>(nodeLeft('users'))).toBeCloseTo(before, 0);
    });

    test('the arrangement is not remembered across a tab switch', async () => {
      const moved = await app.evaluate<number>(nodeLeft('users'));

      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(diagramShowing)).toBe(false);

      await app.evaluate(clickTab('Relationships'));
      await app.waitFor(diagramDrawn);

      // Laid out fresh: `users` is back where the layout puts it, not where the
      // drags left it. Coming back is also what re-reads the schema, which is
      // why nothing caches the fetch behind it.
      expect(await app.evaluate<number>(nodeLeft('users'))).toBeLessThan(moved);
    });

    /*
     * A node opens on **the diagram's own** database, not on the tree's.
     *
     * The two are separate facts everywhere else in this app, and a diagram is
     * the one view that is wholly about one of them: with the tree moved to
     * `postgres` -- which holds no `cities` -- inheriting the tree's answer
     * would open a grid that fails to browse the instant it appears, so rows
     * are what say the diagram's own database was used.
     */
    test('a node opens on the diagram\'s database, wherever the tree has gone', async () => {
      await app.evaluate(selectDatabase('postgres'));
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(treeDatabase)).toBe('postgres');

      await app.evaluate(clickNode('cities'));
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="note-error"]').length`)).toBe(0);
      expect(await app.evaluate<number>(rowCount)).toBe(1);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="results-db"]').textContent`)).toBe('shop');

      await app.evaluate(closeTab('cities'));
      await Bun.sleep(400);
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
      // The diagram is in front again and re-reading the schema, which the next
      // test clicks a node of: wait for the nodes rather than for the frame.
      await app.waitFor(diagramDrawn);
    });

    test('clicking a node opens that table, leaving the diagram open behind it', async () => {
      await app.evaluate(clickNode('events'));
      await Bun.sleep(1500);

      // The same gesture clicking `events` in the tree is: a grid tab on it, in
      // front. The diagram is a tab like any other now, so it stays where it
      // was rather than being dismissed by the thing it opened.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Relationships', 'events']);
      expect(await app.evaluate<string>(activeTabLabel)).toBe('events');
      expect(await app.evaluate<number>(rowCount)).toBeGreaterThan(0);

      await app.evaluate(closeTab('events'));
      await Bun.sleep(400);
    });

    /*
     * The diagram's own database picker, which is the sidebar header's rather
     * than a caret: this bar has no loud primary control to attach one to, and
     * the select *names what you are looking at*, which is what `bare` is for.
     *
     * `postgres` holds no tables, so its empty state is what says the drawing
     * really moved -- and the tree staying on `shop` is what says the picker
     * moved the tab and nothing else.
     */
    test('the diagram switches database from its own picker', async () => {
      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="diagram-db"]'), 'postgres');`);
      await app.waitFor(`document.querySelector('[data-testid="diagram-node"]') ? null : true`);
      await Bun.sleep(1500);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="diagram-db"]').getAttribute('data-value')`)).toBe('postgres');
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="diagram"]').textContent`)).toContain('holds no tables');
      expect(await app.evaluate<string>(treeDatabase)).toBe('shop');

      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="diagram-db"]'), 'shop');`);
      await app.waitFor(diagramDrawn);
      expect(await app.evaluate<string[]>(nodeNames)).toContain('users');
    });

    /*
     * Refreshing re-reads the schema, and the table it has to notice is created
     * **behind the app's back** -- straight into the container, not through a
     * query tab. That is both the case a refresh exists for (someone else
     * changed the schema) and the only way to change it without switching
     * tabs, which remounts the diagram and re-reads it for reasons that have
     * nothing to do with this control.
     *
     * Both ways in, one per direction: the button puts the new table on the
     * canvas, and a real Ctrl+R takes it off again once it is dropped -- which
     * is also the cleanup, so the later tests still see the fixture's own
     * tables and nothing else.
     */
    test('the diagram re-reads the schema, from its button and from Ctrl+R', async () => {
      const psql = (sql: string) => $`docker exec ${PG_CONTAINER} psql -U postgres -d shop -c ${sql}`.quiet();

      await psql('CREATE TABLE zzz_fresh (id int primary key)');
      // Nothing polls, so the drawing is still the one that was read on open.
      expect(await app.evaluate<string[]>(nodeNames)).not.toContain('zzz_fresh');

      await app.evaluate(`document.querySelector('[data-testid="diagram-refresh"]').click(); true;`);
      await app.waitFor(`${nodeNames}.includes('zzz_fresh') ? true : null`);

      await psql('DROP TABLE zzz_fresh');
      // Pressed for real: Ctrl+R is the webview's reload, so a dispatched event
      // would prove the handler and not the chord. The tab strip still standing
      // is the other half -- a reload lands on the connections list with none.
      await app.press('r', { ctrl: true });
      await app.waitFor(`${nodeNames}.includes('zzz_fresh') ? null : true`);
      expect(await app.evaluate<string[]>(tabLabels)).toContain('Relationships');
      expect(await app.evaluate<string[]>(nodeNames)).toContain('users');
    });

    test('closing it is the tab closing, and it is never asked about', async () => {
      // Nothing in a diagram is unsaved work -- it holds no text of its own --
      // so it closes the way a grid tab does, with no dialog.
      await app.evaluate(closeTab('Relationships'));
      await Bun.sleep(400);
      expect(await app.evaluate<boolean>(closeConfirmShowing)).toBe(false);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1']);
    });

    test('the menu is not offered while the connect screen is up', async () => {
      // It is a menu about the database you are looking at, and the connect
      // screen is not looking at one -- so it is absent rather than inert. The
      // connection behind it is still open, which is what makes this the case
      // `connected` alone would get wrong.
      await app.evaluate(`document.querySelector('[data-testid="rail-add"]').click(); true;`);
      await Bun.sleep(600);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-menu="Database"]')`)).toBe(false);
    });
  });

  describe('mysql', () => {
    beforeAll(async () => {
      await connect(MYSQL, 'mysql-smoke');
    });

    test('connects and shows the MySQL badge', async () => {
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`)).toBe(true);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="engine-badge"]').textContent`)).toBe('MySQL');
    });

    /*
     * The page SQL and its quoting are the extension's now, so there is no text
     * up here to assert on -- `tests/extension.test.ts` checks the backticks
     * against the real server. What the UI can still prove is the part that
     * matters here: clicking a table fills the grid on this engine too.
     */
    test('clicking a table browses it', async () => {
      // Both pickers: this connection names no database, so the tab in front
      // opened on whatever the server listed first, and the completion tests
      // further down this block run against `shop`'s catalog through it.
      await useDatabase('shop');
      await app.evaluate(clickTable('users'));
      await Bun.sleep(2000);

      const headers = await app.evaluate<string[]>(
        `[...document.querySelectorAll('[data-testid="grid-col-name"]')].map(e => e.textContent)`
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
      await closeTabConfirmed('Query 2');
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
        `[...document.querySelectorAll('[data-testid="grid-col-name"]')].map(e => e.textContent)`
      );
      expect(cells[0]![headers.indexOf('big')]).toBe('9007199254740993');
    });

    /*
     * The other half of the Postgres filter-bar test's identifier quoting, and
     * the pair is the test: Postgres alone would only prove double-quoting
     * happens, never that it is the *dialect's* mark and not a hardcoded one.
     * MySQL quoting with a backtick instead is what proves `conditionsToWhere`
     * actually branches on `SqlDialect` rather than always emitting one engine's
     * syntax -- which would look identical to correct on whichever engine was
     * tested first.
     */
    test('switching to raw quotes the identifier with this engine\'s own mark', async () => {
      await app.evaluate(`${REACT_SETTERS}
        pickOption(document.querySelector('[data-testid="filter-column"]'), 'name');`);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('[data-testid="filter-value"]'), 'Ada');
        true;`);
      await Bun.sleep(300);
      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="filter-raw"]').value`)).toBe(
        "`name` = 'Ada'"
      );
      // Leave the bar as found: builder mode, no filter applied.
      await app.evaluate(`document.querySelector('[data-testid="filter-toggle-form"]').click(); true;`);
      await Bun.sleep(300);
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

    /*
     * The pair to the Postgres block's quoted insertion, and the same argument
     * the ILIKE pair makes: the quoting is the *dialect's* rule, not one spelling
     * applied everywhere. MySQL does not fold case, so the identical column
     * needs no backticks -- and a rule written per dialect is the only thing
     * both assertions can pass at once.
     */
    test('a mixed-case column is inserted bare, this engine not folding case', async () => {
      expect(await acceptSuggestion('SELECT eventT| FROM users')).toBe('SELECT eventType FROM users');
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

    /*
     * The assistant, as far as it goes without an API key: the toggle opens a
     * real column and `ai.status` answers rather than throwing, so the panel
     * lands on its connect screen instead of an error.
     *
     * That is the boundary of what can be tested here and it is worth naming:
     * nothing in CI or on this machine holds a key any provider would accept, so
     * the loop, the tools and the approval gate have no end-to-end coverage at
     * all. See `docs/testing.md`.
     */
    test('the titlebar button opens an assistant tab, and it asks for a key', async () => {
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="assistant-panel"]')`)).toBe(false);
      const before = (await app.evaluate<string[]>(tabLabels)).length;

      await app.evaluate(`document.querySelector('[data-testid="titlebar-assistant"]').click(); true;`);
      await app.waitFor(`document.querySelector('[data-testid="assistant-panel"]') ? true : null`);

      // The connect form, which means the status resolved to `no-key` rather
      // than to `unavailable` — the whole of what this side can prove about
      // reaching the extension. The provider picker and the field are there
      // because a form missing either is not one.
      await app.waitFor(`document.querySelector('[data-testid="ai-connect"]') ? true : null`);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="ai-provider-select"]')`)).toBe(true);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="ai-key"]')`)).toBe(true);
      expect(await app.evaluate<string[]>(tabLabels)).toContain('Assistant');

      /*
       * Asking again mints a **second** tab, because an assistant tab is a
       * conversation and two conversations are a real thing to want. It focused
       * the existing one while there was a single global thread, back when two
       * tabs could only ever have been two views of it. See `docs/decisions.md`.
       */
      await app.evaluate(`document.querySelector('[data-testid="titlebar-assistant"]').click(); true;`);
      await app.waitFor(`[...document.querySelectorAll('[data-testid="tab-label"]')].filter(e => e.textContent === 'Assistant').length === 2 ? true : null`);
      expect(await app.evaluate<string[]>(tabLabels)).toHaveLength(before + 2);

      // They close like any other tab, because they are ones.
      await app.evaluate(`${tab('Assistant')}.querySelector('[data-testid="tab-close"]').click(); true;`);
      await app.evaluate(`${tab('Assistant')}.querySelector('[data-testid="tab-close"]').click(); true;`);
      await app.waitFor(`document.querySelector('[data-testid="assistant-panel"]') ? null : true`);
    });

    /*
     * Whether a key is stored is an app-level fact, so it is read at launch and
     * stated in the status bar — which means it must be there whether or not the
     * assistant tab has ever been opened. The test above closed it, so this one
     * runs with none open, which is the case that matters.
     */
    test('the status bar states the assistant, and its menu offers a way to act', async () => {
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="assistant-panel"]')`)).toBe(false);
      await app.waitFor(`document.querySelector('[data-testid="statusbar-assistant"]') ? true : null`);

      await app.evaluate(`document.querySelector('[data-testid="statusbar-assistant"]').click(); true;`);
      const items = await app.waitFor<string[]>(`(() => {
        const menu = [...document.querySelectorAll('[data-testid="context-menu-item"]')].map(e => e.textContent);
        return menu.length ? menu : null;
      })()`);

      // No key on this machine, so the menu offers the way *in* rather than a
      // removal there is nothing to remove. This is where adding one starts; the
      // form it needs is drawn in a tab, which this opens.
      expect(items).toContain('Add an API key');

      await app.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true;`);
      await app.waitFor(`document.querySelector('[data-testid="context-menu"]') ? null : true`);
    });

    // The bar is the only place the server is named now that the tree's header
    // stopped repeating it.
    test('names the connected server', async () => {
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="titlebar-title"]').textContent`))
        .toBe(`${MYSQL.user}@${MYSQL.host}:${MYSQL.port}`);
    });

    test('the maximise button maximises the real window, and restores it', async () => {
      // Start from a known state: restore first so maximise always goes up.
      const max = await app.evaluate<boolean>(`Neutralino.window.isMaximized()`);
      if (max) {
        await app.evaluate(`[...document.querySelectorAll('[data-testid="titlebar-btn"]')][1].click(); true;`);
        await Bun.sleep(800);
      }

      const clickMaximise = `[...document.querySelectorAll('[data-testid="titlebar-btn"]')][1].click(); true;`;
      await app.evaluate(clickMaximise);
      await Bun.sleep(800);
      expect(await app.evaluate<boolean>(`Neutralino.window.isMaximized()`)).toBe(true);

      await app.evaluate(clickMaximise);
      await Bun.sleep(800);
      expect(await app.evaluate<boolean>(`Neutralino.window.isMaximized()`)).toBe(false);
    });

    const openMenu = (label: string) =>
      `document.querySelector('[data-menu="${label}"]').click(); true;`;
    const openMenuItems = `[...document.querySelectorAll('[data-testid="menu-item"]')].map(e => e.textContent)`;
    const clickMenuItem = (label: string) =>
      `[...document.querySelectorAll('[data-testid="menu-item"]')].find(e => e.textContent === ${JSON.stringify(label)}).click(); true;`;

    test('the File menu opens, and closes on Escape', async () => {
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`)).toBe(true);

      await app.evaluate(openMenu('File'));
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(openMenuItems))
        .toEqual(['Environments', 'Export connections', 'Import connections', 'Exit']);

      await app.evaluate(pressEscape);
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="menu-item"]').length`)).toBe(0);
    });

    test('Environments manages the picklist the connect form offers', async () => {
      await app.evaluate(openMenu('File'));
      await Bun.sleep(200);
      await app.evaluate(clickMenuItem('Environments'));
      await Bun.sleep(300);

      const envNames = `[...document.querySelectorAll('[data-testid="env-name"]')].map(e => e.textContent)`;
      expect(await app.evaluate<string[]>(envNames)).toEqual(['local', 'dev', 'qa', 'production']);

      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('[data-testid="modal"] input'), 'staging'); true;`);
      await app.evaluate(`[...document.querySelectorAll('[data-testid="modal"] button')].find(e => e.textContent === '+ Add').click(); true;`);
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(envNames)).toEqual(['local', 'dev', 'qa', 'production', 'staging']);

      // Removed here and gone from the picklist -- but not retroactive, which
      // `saveConnection`'s own test already covers on the store side. This is
      // only the screen: add and remove, immediately reflected.
      const stagingRow = `[...document.querySelectorAll('[data-testid="env-row"]')]
        .find(e => e.querySelector('[data-testid="env-name"]').textContent === 'staging')`;
      await app.evaluate(`${stagingRow}.querySelector('button').click(); true;`); // Delete
      await Bun.sleep(200);
      await app.evaluate(`${stagingRow}.querySelector('button').click(); true;`); // Yes
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(envNames)).toEqual(['local', 'dev', 'qa', 'production']);

      await app.evaluate(`[...document.querySelectorAll('[data-testid="modal"] button')].find(e => e.textContent === 'Close').click(); true;`);
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="modal"]').length`)).toBe(0);
    });

    /*
     * The screens, not the transfer. The file is named by an OS dialog CDP
     * cannot reach and written by the extension, and what lands in the store is
     * `saved.test.ts`'s to prove against the real one -- so what only the running
     * app can answer is whether the menu reaches these screens at all, and
     * whether the box that sends passwords out in plain text starts off.
     */
    test('Export and Import connections open their screens, with passwords off', async () => {
      const heading = `document.querySelector('[data-testid="modal"] h2').textContent`;
      const closeModal =
        `[...document.querySelectorAll('[data-testid="modal"] button')].find(e => e.textContent === 'Close').click(); true;`;

      await app.evaluate(openMenu('File'));
      await Bun.sleep(200);
      await app.evaluate(clickMenuItem('Export connections'));
      await app.waitFor(`document.querySelector('[data-testid="modal"]') ? true : null`);
      expect(await app.evaluate<string>(heading)).toBe('Export connections');
      expect(await app.evaluate<boolean>(`document.querySelector('[data-testid="modal"] input[type="checkbox"]').checked`))
        .toBe(false);

      await app.evaluate(closeModal);
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="modal"]').length`)).toBe(0);

      await app.evaluate(openMenu('File'));
      await Bun.sleep(200);
      await app.evaluate(clickMenuItem('Import connections'));
      await app.waitFor(`document.querySelector('[data-testid="modal"]') ? true : null`);
      expect(await app.evaluate<string>(heading)).toBe('Import connections');

      await app.evaluate(closeModal);
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="modal"]').length`)).toBe(0);
    });

    test('the About menu opens, and Version shows the running version', async () => {
      await app.evaluate(openMenu('About'));
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(openMenuItems))
        .toEqual(['Check for updates', 'Version', 'Open app data']);

      await app.evaluate(clickMenuItem('Version'));
      await Bun.sleep(200);

      // The dialog must show the same version the updater checks against, so
      // assert against the package the build read it from rather than a literal.
      const { version } = await Bun.file(new URL('../package.json', import.meta.url)).json();
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="about-version"]').textContent`))
        .toBe(`Version ${version}`);

      await app.evaluate(
        `[...document.querySelectorAll('[data-testid="modal"] button')].find(e => e.textContent === 'Close').click(); true;`
      );
      await Bun.sleep(200);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="modal"]').length`)).toBe(0);
    });

    /*
     * The whole path, not the screen: what a rebind is worth is the *new* key
     * running the query, which nothing but the running app can say.
     *
     * Every chord here is dispatched at an element and left to bubble, never
     * fired straight at `window`. The recorder listens on the window in the
     * capture phase precisely so a key being *named* is not also obeyed, and an
     * event whose target is `window` reaches both phases there -- so it would
     * be answered twice and prove nothing about the ordering that matters.
     */
    test('Preferences rebinds Run, and the new key is what runs the query', async () => {
      const chordOf = (id: string) => `document.querySelector('[data-shortcut="${id}"]').textContent`;
      const hint = `document.querySelector('[data-testid="shortcut-hint"]').textContent`;
      const modalButton = (label: string) =>
        `[...document.querySelectorAll('[data-testid="modal"] button')].find(e => e.textContent === ${JSON.stringify(label)}).click(); true;`;
      const recordKey = (init: string) =>
        `document.querySelector('[data-testid="modal"]').dispatchEvent(new KeyboardEvent('keydown', { ${init}, bubbles: true })); true;`;

      const openShortcuts = async (): Promise<void> => {
        await app.evaluate(openMenu('Preferences'));
        await Bun.sleep(200);
        await app.evaluate(clickMenuItem('Keyboard shortcuts'));
        await app.waitFor(`document.querySelector('[data-shortcut="run"]') ? true : null`);
      };

      await app.evaluate(openMenu('Preferences'));
      await Bun.sleep(200);
      expect(await app.evaluate<string[]>(openMenuItems)).toEqual(['Keyboard shortcuts']);

      await app.evaluate(clickMenuItem('Keyboard shortcuts'));
      await app.waitFor(`document.querySelector('[data-shortcut="run"]') ? true : null`);
      expect(await app.evaluate<string>(chordOf('run'))).toBe('Ctrl+Enter');

      // A chord another shortcut already answers is refused rather than stolen,
      // and recording stays open so the next press is the correction.
      await app.evaluate(`document.querySelector('[data-shortcut="run"]').click(); true;`);
      await Bun.sleep(150);
      await app.evaluate(recordKey(`key: 'b', ctrlKey: true`));
      await Bun.sleep(250);
      expect(await app.evaluate<string>(hint)).toBe('Ctrl+B is already Toggle sidebar.');
      expect(await app.evaluate<string>(chordOf('run'))).toBe('Press a key…');

      await app.evaluate(recordKey(`key: 'F8'`));
      await app.waitFor(`document.querySelector('[data-shortcut="run"]').textContent === 'F8' ? true : null`);

      await app.evaluate(modalButton('Close'));
      await Bun.sleep(200);

      await app.evaluate(newTab);
      await Bun.sleep(400);
      const opened = await app.evaluate<string>(activeTabLabel);
      await app.evaluate(setEditorText('select 7 as rebound'));
      await Bun.sleep(400);

      await app.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true })); true;`);
      await app.waitFor(
        `document.querySelector('.grid thead [data-testid="grid-col-name"]')?.textContent === 'rebound' ? true : null`
      );

      // Put it back, or every test after this one is running under a keyboard
      // this one changed.
      await openShortcuts();
      await app.evaluate(modalButton('Reset all'));
      await app.waitFor(`document.querySelector('[data-shortcut="run"]').textContent === 'Ctrl+Enter' ? true : null`);
      await app.evaluate(modalButton('Close'));
      await Bun.sleep(200);

      await closeTabConfirmed(opened);
      await Bun.sleep(300);
    });
  });

  // The point of the feature: reach yesterday's database without retyping it.
  // These run last because they are the only ones that assert on the store.
  describe('saved connections', () => {
    // Every connection is saved now, so the smoke describes above left rows in the
    // default workspace. Wipe them so the exact-list assertions below mean what
    // they say.
    beforeAll(async () => {
      await clearSavedConnections();
    });

    test('naming a connection saves it, and it survives a reload', async () => {
      await connect(PG, 'pg-fixture');
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`)).toBe(true);

      // `reload` waits for the root to have children, which the saved list is
      // not: it arrives a bridge round-trip later. Assert straight after and the
      // list is legitimately still empty, which reads as "the connection was
      // never saved" about one that was.
      await app.reload();
      await app.waitFor(`document.querySelector('[data-testid="saved-name"]') ? true : null`);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="saved-name"]')].map(e => e.textContent)`))
        .toEqual(['pg-fixture']);
    });

    test('the connect form marks the missing name rather than refusing the click', async () => {
      // The throwaway, workspace-less connection is gone: a name is required, so
      // every open connection belongs to a workspace the rail can group it under.
      // What changed is how the form says so -- submit is live and answers by
      // naming what is empty, instead of being disabled and saying nothing.
      await app.evaluate(`document.querySelector('[data-testid="saved-new"]')?.click(); true;`);
      await Bun.sleep(300);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('#host'), ${JSON.stringify(MYSQL.host)});
        setNative(document.querySelector('#port'), ${JSON.stringify(String(MYSQL.port))});
        setNative(document.querySelector('#user'), ${JSON.stringify(MYSQL.user)});
        true;`);
      await Bun.sleep(200);

      // Live with no name, and nothing marked until it has actually been tried.
      expect(await app.evaluate<boolean>(`document.querySelector('[data-testid="connect-submit"]').disabled`)).toBe(false);
      expect(await app.evaluate<string | null>(`document.querySelector('#name').getAttribute('aria-invalid')`)).toBe(null);

      // Submitting connects to nothing and says which field is empty.
      await app.evaluate(`document.querySelector('[data-testid="connect-submit"]').click(); true;`);
      await Bun.sleep(300);
      expect(await app.evaluate<string | null>(`document.querySelector('#name').getAttribute('aria-invalid')`)).toBe('true');
      expect(await app.evaluate<boolean>(`!!document.querySelector('#name')`)).toBe(true);

      // Typing withdraws the mark on that field alone, without a second submit.
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('#name'), 'needs-a-name'); true;`);
      await Bun.sleep(200);
      expect(await app.evaluate<string | null>(`document.querySelector('#name').getAttribute('aria-invalid')`)).toBe(null);

      // Back to the list without connecting, so the row assertions below stand.
      await app.reload();
      await app.waitFor(`document.querySelector('[data-testid="saved-name"]') ? true : null`);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="saved-name"]')].map(e => e.textContent)`))
        .toEqual(['pg-fixture']);
    });

    test('the row shows the server it will reach', async () => {
      const label = await app.evaluate<string>(`${savedRow('pg-fixture')}.querySelector('[data-testid="saved-server"]').textContent`);
      expect(label).toContain(`${PG.user}@${PG.host}:${PG.port}`);
    });

    test('picking it connects with no password typed', async () => {
      await app.evaluate(`${savedRow('pg-fixture')}.querySelector('[data-testid="saved-pick"]').click(); true;`);
      await Bun.sleep(3000);

      const shell = await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`);
      if (!shell) {
        throw new Error(
          await app.evaluate<string>(`document.querySelector('[data-testid="callout"]')?.textContent ?? 'no error shown'`)
        );
      }
      // It must be a real session, not just a routed screen.
      const dbs = await app.evaluate<string[]>(`${REACT_SETTERS} optionsOf('sidebar-db-select', 'label');`);
      expect(dbs).toContain('shop');
    });

    /*
     * An edit writes the stored row, and a connection already running off that
     * row never reads it again -- so the row says it is open and refuses the
     * edit, rather than saving one that quietly does nothing. The rail's "+" is
     * the only route to this list with a connection still open.
     */
    test('a connection that is open says so, and its Edit is refused', async () => {
      await app.evaluate(`document.querySelector('[data-testid="rail-add"]').click(); true;`);
      await Bun.sleep(600);

      expect(await app.evaluate<string>(`${savedRow('pg-fixture')}.querySelector('[data-testid="saved-open"]').textContent`))
        .toBe('Open');
      expect(await app.evaluate<boolean>(`${savedRow('pg-fixture')}.querySelector('[data-testid="saved-edit"]').disabled`))
        .toBe(true);

      // Back to the shell, so the disconnect the next test opens with lands.
      await app.evaluate(`document.querySelector('[data-testid="connect-back"]').click(); true;`);
      await Bun.sleep(400);
    });

    test('editing renames it in place', async () => {
      await disconnect();
      await Bun.sleep(400);

      // Closed, so the mark is gone and the form is reachable again.
      expect(await app.evaluate<boolean>(`!!${savedRow('pg-fixture')}.querySelector('[data-testid="saved-open"]')`)).toBe(false);

      await app.evaluate(`${savedRow('pg-fixture')}.querySelector('[data-testid="saved-actions"] button').click(); true;`);
      await Bun.sleep(500);
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('#name'), 'pg-renamed'); true;`);
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('[data-testid="connect-submit"]').click(); true;`);
      await Bun.sleep(1500);

      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="saved-name"]')].map(e => e.textContent)`))
        .toEqual(['pg-renamed']);
    });

    test('the kept password still connects after an edit that never saw it', async () => {
      await app.evaluate(`${savedRow('pg-renamed')}.querySelector('[data-testid="saved-pick"]').click(); true;`);
      await Bun.sleep(3000);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`)).toBe(true);
      await disconnect();
    });

    test('deleting arms the trash can, then removes it on a second click', async () => {
      // Delete is a trash icon that confirms in place rather than in a dialog:
      // one click arms it, a second on that same button commits.
      await app.evaluate(`${savedRow('pg-renamed')}.querySelector('[data-testid="saved-delete"]').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string>(`${savedRow('pg-renamed')}.querySelector('[data-testid="saved-delete"]').title`))
        .toBe('Click again to delete');

      await app.evaluate(`${savedRow('pg-renamed')}.querySelector('[data-testid="saved-delete"]').click(); true;`);
      await Bun.sleep(800);
      expect(await app.evaluate<number>(`document.querySelectorAll('[data-testid="saved-row"]').length`)).toBe(0);
    });
  });

  /*
   * Testing a draft. The two things worth driving through the real window are
   * the ones no unit test can see: that a test leaves the form exactly where it
   * was, and that an edit form -- which is never sent the password it is
   * editing -- can still test the row it is editing.
   */
  describe('testing a connection while typing it', () => {
    beforeAll(async () => {
      await clearSavedConnections();
    });

    test('a draft is tested where it stands: no name, no record, no connection', async () => {
      await app.reload();
      await app.waitFor(`document.querySelector('#host') ? true : null`);
      await app.evaluate(`${REACT_SETTERS} pickOption(document.querySelector('#type'), 'postgres');`);
      await Bun.sleep(200);
      await app.evaluate(`${REACT_SETTERS}
        setNative(document.querySelector('#host'), ${JSON.stringify(PG.host)});
        setNative(document.querySelector('#port'), ${JSON.stringify(String(PG.port))});
        setNative(document.querySelector('#user'), ${JSON.stringify(PG.user)});
        setNative(document.querySelector('#password'), ${JSON.stringify(PG.password)});
        true;`);
      await Bun.sleep(200);

      // A test writes no record, so it asks for none of what saving one needs.
      // Neither button is disabled -- Connect would answer "name is required"
      // and Test simply reaches the server, which is the difference.
      expect(await app.evaluate<boolean>(`document.querySelector('[data-testid="connect-test"]').disabled`)).toBe(false);

      await app.evaluate(`document.querySelector('[data-testid="connect-test"]').click(); true;`);
      expect(
        await app.waitFor<string>(`document.querySelector('[data-testid="connect-test-result"]')?.textContent ?? null`)
      ).toMatch(/^Connected to PostgreSQL \d+\./);

      // Still the form, and nothing was opened behind it.
      expect(await app.evaluate<boolean>(`!!document.querySelector('#host')`)).toBe(true);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="sidebar"]')`)).toBe(false);

      // Editing withdraws the answer, rather than leaving it vouching for a
      // password that has since been retyped.
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('#password'), 'not-the-password'); true;`);
      await Bun.sleep(300);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="connect-test-result"]')`)).toBe(false);

      // And a failure is the server's own words, where the button is.
      await app.evaluate(`document.querySelector('[data-testid="connect-test"]').click(); true;`);
      expect(
        await app.waitFor<string>(`document.querySelector('[data-testid="connect-test-error"]')?.textContent ?? null`)
      ).toMatch(/password authentication failed/i);

      // Nothing was stored either way: an empty workspace opens on the form.
      await app.reload();
      await Bun.sleep(600);
      expect(await app.evaluate<boolean>(`!!document.querySelector('#host')`)).toBe(true);
    });

    test('an edit tests with the password it was never shown', async () => {
      await connect(PG, 'pg-test-draft');
      await disconnect();
      await app.waitFor(`(${savedRow('pg-test-draft')}) ? true : null`);

      await app.evaluate(`${savedRow('pg-test-draft')}.querySelector('[data-testid="saved-edit"]').click(); true;`);
      await app.waitFor(`document.querySelector('[data-testid="connect-test"]') ? true : null`);
      // The box reads `unchanged` and holds nothing -- the password never came
      // back over the bridge -- so this can only pass by naming the stored row.
      expect(await app.evaluate<string>(`document.querySelector('#password').value`)).toBe('');

      await app.evaluate(`document.querySelector('[data-testid="connect-test"]').click(); true;`);
      expect(
        await app.waitFor<string>(`document.querySelector('[data-testid="connect-test-result"]')?.textContent ?? null`)
      ).toMatch(/^Connected to PostgreSQL \d+\./);

      await clearSavedConnections();
    });
  });

  describe('session restore', () => {
    // Its own connection, wiped after: the reconnect that restores tabs is the
    // whole subject, so nothing else may have written this connection's session.
    beforeAll(async () => {
      await clearSavedConnections();
    });

    test('reconnecting reopens the tabs, the query text and the tables', async () => {
      await connect(PG, 'pg-session');
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);

      // A table tab and a query, then let the debounced save settle. The order
      // matters: the grid tab is opened second, so the strip reads [Query 1, users].
      await app.evaluate(clickTable('users'));
      await Bun.sleep(1200);
      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(300);
      await app.evaluate(setEditorText('select 42 as restored'));
      await Bun.sleep(900);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'users']);

      // Disconnect flushes the final shape, then reconnect the *same* saved row --
      // the restore path, not a fresh connect (which mints one blank Query 1).
      await disconnect();
      await app.waitFor(`(${savedRow('pg-session')}) ? true : null`);
      await app.evaluate(`${savedRow('pg-session')}.querySelector('[data-testid="saved-pick"]').click(); true;`);
      await Bun.sleep(3000);

      // Both tabs are back, in the order they were left.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'users']);

      // The query text survived the quit.
      await app.evaluate(clickTab('Query 1'));
      await Bun.sleep(400);
      expect(await app.evaluate<string>(editorText)).toBe('select 42 as restored');

      // The grid tab refetches its rows the first time it is viewed -- lazily, so
      // it had none until the click above's sibling here brings it forward.
      await app.evaluate(clickTab('users'));
      await Bun.sleep(1500);
      expect(await app.evaluate<number>(rowCount)).toBeGreaterThan(0);

      await disconnect();
      await clearSavedConnections();
    });
  });

  describe('saved queries', () => {
    const openPicker = `document.querySelector('[data-testid="saved-queries-open"]').click(); true;`;
    const pickerNames = `[...document.querySelectorAll('[data-testid="saved-query-pick"]')].map(e => e.textContent)`;
    const pickQuery = (name: string) => `
      [...document.querySelectorAll('[data-testid="saved-query-pick"]')]
        .find(e => e.textContent === ${JSON.stringify(name)}).click(); true;`;
    /** Ctrl+S on the window, which is the binding outside Monaco's own DOM. */
    const pressSave = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); true;`;
    const unsavedMarks = `document.querySelectorAll('[data-testid="tab-unsaved"]').length`;
    const dialogOpen = `!!document.querySelector('[data-testid="save-query-name"]')`;

    /** Armed by a first click, committed by a second on that same button. */
    async function deleteFirstSavedQuery(): Promise<void> {
      await app.evaluate(openPicker);
      await app.waitFor(`document.querySelector('[data-testid="saved-query-delete"]') ? true : null`);
      await app.evaluate(`document.querySelector('[data-testid="saved-query-delete"]').click(); true;`);
      await Bun.sleep(200);
      // Still the same button, and still there -- an armed row keeps its delete
      // whether or not the pointer is on it.
      await app.evaluate(`document.querySelector('[data-testid="saved-query-delete"]').click(); true;`);
      await Bun.sleep(400);
      await app.evaluate(pressEscape);
    }

    beforeAll(async () => {
      await clearSavedConnections();
      await connect(PG, 'pg-queries');
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1500);
    });

    afterAll(async () => {
      await disconnect();
      await clearSavedConnections();
    });

    test('Ctrl+S names it, and the tab takes that name', async () => {
      await app.evaluate(setEditorText('select 1 as saved'));
      await Bun.sleep(400);
      await app.evaluate(pressSave);

      // Offered the tab's current name, so the common case is Enter.
      await app.waitFor(`document.querySelector('[data-testid="save-query-name"]') ? true : null`);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="save-query-name"]').value`)).toBe('Query 1');

      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('[data-testid="save-query-name"]'), 'ui-saved'); true;`);
      await Bun.sleep(150);
      await app.evaluate(`document.querySelector('[data-testid="save-query-submit"]').click(); true;`);
      await Bun.sleep(600);

      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['ui-saved']);
      expect(await app.evaluate<boolean>(dialogOpen)).toBe(false);
    });

    test('editing marks it unsaved, and a second Ctrl+S saves without asking again', async () => {
      // The mark is the whole of the feedback a silent save gives, which is what
      // makes saving silently allowed to be silent.
      await app.evaluate(setEditorText('select 2 as saved'));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(1);

      await app.evaluate(pressSave);
      await Bun.sleep(700);
      // No dialog: the tab knows which query it is, so there is nothing to ask.
      expect(await app.evaluate<boolean>(dialogOpen)).toBe(false);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);
    });

    test('the dot takes the close button\'s slot, and gives it back on hover', async () => {
      /*
       * The mark costs no width beside the label, and the control it stands in
       * for is one pointer-move away rather than gone.
       *
       * Driven with `mouseover`/`mouseout`, **not** `mouseenter`: React
       * synthesises `onMouseEnter` from the delegated pair, so a synthetic
       * `mouseenter` reaches the DOM and no handler at all -- which reads as the
       * swap being broken. See `docs/testing.md`.
       */
      const slots = `[...document.querySelectorAll('[data-testid="tab-close"]')].map(b => b.querySelector('[data-testid="tab-unsaved"]') ? 'dot' : 'close')`;
      const hoverClose = (e: string) =>
        `document.querySelector('[data-testid="tab-close"]').dispatchEvent(new MouseEvent(${JSON.stringify(e)}, { bubbles: true, relatedTarget: document.body })); true;`;

      expect(await app.evaluate<string[]>(slots)).toEqual(['close']);

      await app.evaluate(setEditorText('select 9 as saved'));
      await Bun.sleep(500);
      expect(await app.evaluate<string[]>(slots)).toEqual(['dot']);

      await app.evaluate(hoverClose('mouseover'));
      await Bun.sleep(250);
      expect(await app.evaluate<string[]>(slots)).toEqual(['close']);

      await app.evaluate(hoverClose('mouseout'));
      await Bun.sleep(250);
      expect(await app.evaluate<string[]>(slots)).toEqual(['dot']);

      // Back to saved, so the tests after this one start where they expect to.
      await app.evaluate(pressSave);
      await Bun.sleep(800);
      expect(await app.evaluate<string[]>(slots)).toEqual(['close']);
    });

    test('the picker opens it into a new tab, seeded and runnable', async () => {
      await app.evaluate(openPicker);
      await app.waitFor(`document.querySelector('[data-testid="saved-queries-panel"]') ? true : null`);
      expect(await app.evaluate<string[]>(pickerNames)).toEqual(['ui-saved']);

      // Always a *new* tab, never re-pointing the current one -- the same rule
      // clicking a table follows, so an edit can be compared against what is stored.
      await app.evaluate(pickQuery('ui-saved'));
      await Bun.sleep(800);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['ui-saved', 'ui-saved']);
      // What the test above left stored -- the copy is seeded from the query,
      // not from whatever the tab it was opened beside happens to hold.
      expect(await app.evaluate<string>(editorText)).toBe('select 9 as saved');

      await app.evaluate(`document.querySelector('[data-testid="run-btn"]').click(); true;`);
      await Bun.sleep(2000);
      expect(await app.evaluate<number>(rowCount)).toBe(1);
    });

    test('saving one copy lands in every other tab open on the same query', async () => {
      // Two tabs on one saved query are two views of it, not two copies: the
      // save is the query changing, so it shows up in both. Neither is left
      // marked, because what is on disk is now what they both hold.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['ui-saved', 'ui-saved']);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);

      await app.evaluate(setEditorText('select 4 as saved'));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(1);

      await app.evaluate(pressSave);
      await Bun.sleep(800);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);

      // The other tab is carrying the saved text, in its own Monaco model --
      // which only happens if the write reached the model and not just the
      // store. Switching to it is what proves the model was right beforehand:
      // attaching one never fills it.
      await app.evaluate(`document.querySelectorAll('[data-testid="tab-pick"]')[0].click(); true;`);
      await Bun.sleep(500);
      expect(await app.evaluate<string>(editorText)).toBe('select 4 as saved');
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);

      // And it is still live: typing into the tab just written to marks it,
      // rather than the inbound write having left the model detached from the
      // store.
      await app.evaluate(setEditorText('select 5 as saved'));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(1);
      await app.evaluate(pressSave);
      await Bun.sleep(800);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);

      await closeTabConfirmed('ui-saved');
      await Bun.sleep(300);
    });

    test('the link survives a reconnect, so the reopened tab still saves in place', async () => {
      // `savedQueryId` rides in the session snapshot. Without it the restored tab
      // would look identical and quietly ask for a name again on the next Ctrl+S.
      await disconnect();
      await app.waitFor(`(${savedRow('pg-queries')}) ? true : null`);
      await app.evaluate(`${savedRow('pg-queries')}.querySelector('[data-testid="saved-pick"]').click(); true;`);
      await Bun.sleep(3000);

      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['ui-saved']);
      await app.evaluate(setEditorText('select 3 as saved'));
      await Bun.sleep(500);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(1);

      await app.evaluate(pressSave);
      await Bun.sleep(700);
      expect(await app.evaluate<boolean>(dialogOpen)).toBe(false);
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);
    });

    test('deleting it empties the list and leaves the open tab holding the text', async () => {
      // Saved a moment ago, so nothing has drifted from anything yet.
      expect(await app.evaluate<number>(unsavedMarks)).toBe(0);

      await deleteFirstSavedQuery();
      await app.evaluate(openPicker);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(pickerNames)).toEqual([]);
      await app.evaluate(pressEscape);

      // The mark goes *up*, not away: deleting the row is the moment this text
      // stops being backed by anything, which is exactly what the mark names.
      // The tab keeps its title and its text -- what was deleted is the stored
      // copy, not the query on screen.
      expect(await app.evaluate<number>(unsavedMarks)).toBe(1);
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['ui-saved']);

      // The tab came from nowhere now, so Ctrl+S has a name to ask for again --
      // never a silent write that re-creates the row just deleted.
      await app.evaluate(pressSave);
      await app.waitFor(`document.querySelector('[data-testid="save-query-name"]') ? true : null`);
      await app.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); true;`);
      await Bun.sleep(300);
      expect(await app.evaluate<boolean>(dialogOpen)).toBe(false);
    });
  });

  // Late on purpose: these leave a second workspace behind for most of their
  // run, and every describe above is written against a launch screen that skips
  // the picker. They end on a single empty workspace, which is what the describe
  // below then launches into.
  describe('workspaces', () => {
    const groupLabels = `[...document.querySelectorAll('[data-testid="ws-group-label"]')].map(e => e.textContent)`;
    const names = `[...document.querySelectorAll('[data-testid="saved-name"]')].map(e => e.textContent)`;

    test('one workspace is skipped, and the bar names the one you are in', async () => {
      await connect(PG, 'ws-local');
      await disconnect();
      await Bun.sleep(400);

      // Straight to the connections: nothing was picked on the way in.
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="ws-bar-name"]').textContent`)).toBe('Default');
      expect(await app.evaluate<string[]>(names)).toEqual(['ws-local']);
    });

    test('connections sit under their environment, and empty ones are absent', async () => {
      expect(await app.evaluate<string[]>(groupLabels)).toEqual(['local']);

      await connect(PG, 'ws-prod', 'production');
      await disconnect();
      await Bun.sleep(400);

      // local before production, and no headings for the two nobody used.
      expect(await app.evaluate<string[]>(groupLabels)).toEqual(['local', 'production']);
      expect(await app.evaluate<string[]>(names)).toEqual(['ws-local', 'ws-prod']);
    });

    test('the bar is the way to the picker, which is how a second one is made', async () => {
      await app.evaluate(`document.querySelector('[data-testid="ws-bar"]').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(names)).toEqual(['Default']);

      await app.evaluate(`document.querySelector('[data-testid="saved-new"]').click(); true;`);
      await Bun.sleep(400);
      await app.evaluate(`${REACT_SETTERS} setNative(document.querySelector('#workspace-name'), 'Acme'); true;`);
      await Bun.sleep(200);
      await app.evaluate(`document.querySelector('[data-testid="connect-submit"]').click(); true;`);
      await Bun.sleep(1000);

      // A new workspace is empty, so it opens on the form rather than an empty box.
      expect(await app.evaluate<boolean>(`!!document.querySelector('#host')`)).toBe(true);
    });

    test('a second workspace makes the picker the way in, counting what each holds', async () => {
      await app.reload();
      await Bun.sleep(600);

      expect(await app.evaluate<string[]>(names)).toEqual(['Acme', 'Default']);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="ws-count"]')].map(e => e.textContent)`))
        .toEqual(['0 connections', '2 connections']);
    });

    test('deleting one says what it will cost, then takes its connections with it', async () => {
      // The trash icon is the second action; the first is Edit, as on a connection row.
      await app.evaluate(`${savedRow('Default')}.querySelector('[data-testid="saved-delete"]').click(); true;`);
      await Bun.sleep(400);
      // The confirmation names the count because the connections go too -- and
      // their stored passwords with them -- in the armed button's tooltip.
      expect(await app.evaluate<string>(`${savedRow('Default')}.querySelector('[data-testid="saved-delete"]').title`))
        .toBe('Click again to delete with its 2 connections');

      await app.evaluate(`${savedRow('Default')}.querySelector('[data-testid="saved-delete"]').click(); true;`);
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
        [...document.querySelectorAll('[data-testid="connect-actions"] button')]
          .find(e => e.textContent === 'Cancel').click(); true;`);
      await Bun.sleep(400);
      expect(await app.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="ws-count"]')].map(e => e.textContent)`))
        .toEqual(['0 connections']);
    });

    test('the last workspace offers no Delete at all', async () => {
      // Refusing it in the store is the guarantee; not offering it is what keeps
      // the user from ever meeting the refusal.
      expect(await app.evaluate<string[]>(
        `[...${savedRow('Acme')}.querySelectorAll('[data-testid="saved-actions"] button')].map(e => e.textContent)`
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
    beforeAll(async () => {
      await connect(PG, 'Shop dev', 'dev');
      await addConnection(MYSQL, 'Shop prod', 'production');
    });

    test('the rail lists both by name, in the order they were opened', async () => {
      // Both are in the one workspace left standing, so they share a group and the
      // name is what tells them apart -- the two-letter mark is gone.
      expect(await app.evaluate<string[]>(railNames)).toEqual(['Shop dev', 'Shop prod']);
    });

    test('each chip carries its environment as a text tag', async () => {
      // Not a colour: the rail's colour is the workspace's now, and the
      // environment reads as the stored word itself -- no abbreviation table to
      // consult, since the list of environments is user-managed now (and it reads
      // again in the status bar, in full there too).
      expect(await app.evaluate<string[]>(railEnvs)).toEqual(['dev', 'production']);
    });

    test('opening the second lands you on it, and the titlebar and status bar follow', async () => {
      expect(await app.evaluate<number>(activeRail)).toBe(1);
      // The rail says which; the titlebar says what. Neither repeats the other.
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="titlebar-title"]').textContent`))
        .toBe(`${MYSQL.user}@${MYSQL.host}:${MYSQL.port}`);
      // The status bar names the active connection's environment too -- the same
      // stored text the rail's chip already carries, not a second rendering of it.
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="statusbar-env"]').textContent`))
        .toBe('production');
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
      // The `reporting` heading is the tell: MySQL's shop has no such schema, so
      // the group existing at all means this tree answered for Postgres.
      expect(await app.evaluate<string[]>(schemaLabels)).toContain('reporting');

      await app.evaluate(clickRail(1));
      await Bun.sleep(400);
      await app.evaluate(selectDatabase('shop'));
      await Bun.sleep(1800);
      const mysql = await app.evaluate<string[]>(treeLabels);
      // MySQL's shop has a `users`, so the tree did fetch and did answer...
      expect(mysql).toContain('users');
      // ...and it answered for MySQL. Postgres's second-schema table is the
      // proof: there is no such thing here, so its presence would mean this tree
      // had read the other connection's cache. Asserted on the labels rather than
      // the headings, since MySQL draws none either way.
      expect(mysql).not.toContain('daily_stats');
    });

    test('MySQL has no schema layer, so it draws no groups', async () => {
      // Still on Shop prod (MySQL). Its database *is* its schema, so there is
      // nothing to group by and the tree is drawn flat.
      expect(await app.evaluate<string[]>(schemaLabels)).toEqual([]);
      // The sync toggle is there all the same: what it pairs is the tree and
      // the tab, which every engine has.
      expect(await app.evaluate<boolean>(syncToggleExists)).toBe(true);
      // The tree itself is untouched: names are bare, as they always were.
      expect(await app.evaluate<string[]>(treeLabels)).toContain('users');
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

    /*
     * Right-clicking the chip is where people reach for this: the status bar's
     * Disconnect is bottom-left and easy to have never noticed. The menu names
     * the chip it was summoned on and does *not* bring it to the front first —
     * the same rule the tab strip's menu follows — so a background server can be
     * closed without leaving the one you are working in.
     */
    test('a rail chip offers Disconnect, and summoning it does not switch connections', async () => {
      // Shop dev (index 0) is in front, from the test above.
      expect(await app.evaluate<number>(activeRail)).toBe(0);

      await app.evaluate(rightClickRail(1));
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(menuItemLabels)).toEqual(['Disconnect']);
      expect(await app.evaluate<number>(activeRail)).toBe(0);

      await app.evaluate(pressEscape);
      await Bun.sleep(300);
      expect(await app.evaluate<string[]>(railNames)).toEqual(['Shop dev', 'Shop prod']);
    });

    test('disconnecting one leaves the other open, and lands you on it', async () => {
      // Disconnect is the titlebar's, and it has always meant the one in front.
      // Shop dev is in front, from the test above.
      await disconnect();
      await Bun.sleep(600);

      expect(await app.evaluate<string[]>(railNames)).toEqual(['Shop prod']);
      expect(await app.evaluate<number>(activeRail)).toBe(0);
      // Its tabs are still its own, and still both of them: closing one
      // connection is not closing the app.
      expect(await app.evaluate<string[]>(tabLabels)).toEqual(['Query 1', 'Query 2']);
      expect(await app.evaluate<string>(`document.querySelector('[data-testid="titlebar-title"]').textContent`))
        .toBe(`${MYSQL.user}@${MYSQL.host}:${MYSQL.port}`);
    });

    // Through the rail's menu rather than the status bar, so both ways in are
    // exercised: the bar closed the connection above, and this closes the last
    // one. There is no confirmation on either — a disconnect saves the session
    // while the tabs still exist, so reconnecting brings them back.
    test('disconnecting the last one is the way back to the connect screen', async () => {
      await app.evaluate(rightClickRail(0));
      await Bun.sleep(300);
      await app.evaluate(clickContextItem('Disconnect'));
      await Bun.sleep(900);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="rail"]')`)).toBe(false);
      expect(await app.evaluate<boolean>(`!!document.querySelector('[data-testid="saved-row"], #host')`)).toBe(true);
    });
  });
});
