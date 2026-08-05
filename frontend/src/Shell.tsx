import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FunctionInfo, SavedQuery, TableInfo, TriggerInfo } from '../../shared/protocol/index.ts';
import { relationLabel, relationOf } from './common/db/relation.ts';
import { useAppSelector } from './store/hooks.ts';
import { useSavedQueries } from './store/savedQueriesSlice.ts';
import { useSession } from './store/sessionSlice.ts';
import { useShortcuts } from './store/settingsSlice.ts';
import { useTabs, type CloseIntent, type Tab } from './store/tabsSlice.ts';
import { EditorPane, useEditor, useSqlCompletion, useSqlFormatter } from './features/editor/index.ts';
import { Sidebar, useExplorer } from './features/explorer/index.ts';
import { SaveQueryDialog, SavedQueriesButton } from './features/queries/index.ts';
import { ConnectionRail } from './features/rail/index.ts';
import { ResultsProvider, ResultsTable, useResults } from './features/results/index.ts';
import { StatusBar } from './features/statusbar/index.ts';
import { CloseTabsConfirm, TabStrip } from './features/tabs/index.ts';
import Note from './common/components/Note.tsx';
import ResizeHandle from './common/components/ResizeHandle.tsx';
import { chordFromEvent, type ShortcutId } from './common/shortcuts.ts';
import * as t from './common/tokens';

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 480;
const RESULTS_MIN = 120;
const EDITOR_MIN = 120;
/** The narrowest either half of a split may be dragged to. */
const SPLIT_MIN = 280;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface Props { onAddConnection: () => void; }

export default function Shell({ onAddConnection }: Props) {
  return (
    <ResultsProvider>
      <ShellLayout onAddConnection={onAddConnection} />
    </ResultsProvider>
  );
}

function ShellLayout({ onAddConnection }: Props) {
  const {
    tabs, activeTab, activeTabId, secondaryTabs, secondaryActiveTab, secondaryActiveTabId,
    openGridTab, openEditorTab, openSavedQueryTab, setDatabase, markTabSaved, database,
    activateTab, closeIdsFor, closeTabs, connectionTabs, moveTab, renameTab,
  } = useTabs();
  const { dialect, disconnect } = useSession();
  // `tabRunning`, not the shown result's own `running`: a batch of several
  // statements leaves the pane showing a finished one while a later one is still
  // going, and Run must stay busy until the whole batch is done.
  //
  // Called once per pane rather than once for "the" active tab: a split view has
  // two tabs in front at once, each with its own run/browse/running. See `useResults`.
  const { run: runPrimary, tabRunning: primaryRunning, browseIn: browseInPrimary } = useResults(activeTab);
  const { run: runSecondary, tabRunning: secondaryRunning, browseIn: browseInSecondary } = useResults(secondaryActiveTab);
  const { fetchDdl, fetchTriggerDdl, fetchFunctionDdl, defaultSchema } = useExplorer();
  // `peekSql` alone: every seed now rides `tabOpened`, so the composition root
  // reads the editor's text and never writes it.
  const { peekSql } = useEditor();
  const { queries, save: saveQuery } = useSavedQueries();
  const { bindings } = useShortcuts();

  // The SQL completion provider and the formatter are registered once here,
  // regardless of how many panes are open -- Monaco's registration is global
  // per language, so an `EditorPane` per pane calling these itself would
  // register the same provider twice and cross-contaminate suggestions
  // between panes. See the file comment in `useSqlCompletion.ts`.
  useSqlCompletion(database);
  useSqlFormatter(dialect);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((prev) => !prev), []);

  const [sidebarWidth, setSidebarWidth] = useState(240);
  const dragSidebar = useCallback((deltaPx: number) => {
    setSidebarWidth((prev) => clamp(prev + deltaPx, SIDEBAR_MIN, SIDEBAR_MAX));
  }, []);

  // The results panel's height, in px; the editor above it takes whatever is
  // left (`1fr`). Both bounds are read fresh on every drag so a window resize
  // between drags is respected without a resize observer.
  const [resultsHeight, setResultsHeight] = useState(280);
  const dragResults = useCallback((deltaPx: number) => {
    const chromeAbove = t.RAIL_H + t.TAB_H + t.TAB_H;
    const max = window.innerHeight - t.STATUSBAR_H - chromeAbove - EDITOR_MIN;
    setResultsHeight((prev) => clamp(prev - deltaPx, RESULTS_MIN, Math.max(RESULTS_MIN, max)));
  }, []);

  // The secondary pane's own editor/results split -- independent of the
  // primary's, the same way each pane's grid and editor are independent.
  const [secondaryResultsHeight, setSecondaryResultsHeight] = useState(280);
  const dragSecondaryResults = useCallback((deltaPx: number) => {
    const chromeAbove = t.RAIL_H + t.TAB_H + t.TAB_H;
    const max = window.innerHeight - t.STATUSBAR_H - chromeAbove - EDITOR_MIN;
    setSecondaryResultsHeight((prev) => clamp(prev - deltaPx, RESULTS_MIN, Math.max(RESULTS_MIN, max)));
  }, []);

  // The split's own width, as the primary pane's px. Session-only, the same
  // footing as the sidebar's and the results pane's -- it is never a fact about
  // a tab, only about how the window is currently carved up, so nothing here
  // crosses the bridge.
  const showSplit = secondaryActiveTab !== null;
  const panes = useRef<HTMLDivElement>(null);

  /*
   * How the split is divided, as the primary pane's **share** rather than its
   * pixels -- the two panes are `flex-grow: fraction` against a zero basis, so
   * the ratio is what the layout is told and the pixels fall out of it.
   *
   * A px width was the first cut and it is wrong twice over. It defaults badly:
   * one constant is about half of a small window and a quarter of a wide one,
   * so "even" depended on the machine it was written on. And it does not
   * survive a resize: the primary pane keeps its pixels while the secondary,
   * taking whatever is left, absorbs every pixel the window gains -- maximise
   * a 50/50 split and it lands somewhere near 25/75. A fraction is both fixed
   * at once, and 0.5 needs no measuring to mean half.
   */
  const [splitFraction, setSplitFraction] = useState(0.5);
  const dragSplit = useCallback((deltaPx: number) => {
    const available = panes.current?.getBoundingClientRect().width ?? 0;
    if (available <= 0) return;
    // The minimum is expressed as a share of the room actually available, so a
    // narrow window clamps to the same pane width a wide one does.
    const floor = Math.min(SPLIT_MIN / available, 0.5);
    setSplitFraction((prev) => clamp(prev + deltaPx / available, floor, 1 - floor));
  }, []);

  // Which tab is being dragged, from either strip -- a value the composition
  // root holds so a strip can accept a drop that started in the *other* one
  // (each strip's own local drag state could never see that), and so the
  // dock-to-split zone below knows when to appear. Both `TabStrip`s and the
  // zone read this; only a strip's own `onDragStart`/`onDragEnd` write it.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  /**
   * Which pane the dragged tab is currently in, so a pane can refuse a drop of
   * a tab it already holds -- "move it here" where it already is would only
   * shuffle it to the end of its own strip.
   */
  const draggedPane: Tab['pane'] | null =
    draggingId === null
      ? null
      : tabs.some((tab) => tab.id === draggingId)
        ? 'primary'
        : secondaryTabs.some((tab) => tab.id === draggingId)
          ? 'secondary'
          : null;

  /*
   * Which pane the user is working in. `EditorPane`'s window-level
   * Ctrl+Enter/Ctrl+S fallback -- the one that covers focus being anywhere
   * outside Monaco -- is gated on this, or both panes answer one keypress.
   *
   * **Tracked on pointer-down as well as focus, and the pointer half is what
   * makes it right.** Focus alone looks sufficient and is not: most of a pane
   * is not focusable, so clicking its result grid, its filter bar's blank
   * space or its own divider fires no focus event at all and leaves this
   * pointing at whichever pane was last *focused* -- which, after working in
   * one pane and then clicking into the other, is the wrong one. A run then
   * lands in the pane the user is not looking at, which is exactly the shape
   * of "I ran a query in one tab and got results in the other". Capture
   * phase, so a handler inside the pane cannot swallow it first.
   */
  const [focusedPane, setFocusedPane] = useState<'primary' | 'secondary'>('primary');

  /*
   * Which pane a keyboard command acts on. Not `focusedPane` directly: a split
   * that collapses leaves that pointing at a pane which no longer exists (its
   * `<main>` is unmounted, so nothing sets it back), and every tab command
   * would then quietly act on an empty strip until the user clicked something.
   */
  const workingPane: Tab['pane'] = showSplit && focusedPane === 'secondary' ? 'secondary' : 'primary';

  /**
   * The next or previous tab of the pane being worked in, wrapping at either
   * end. A pane holding one tab has nowhere to step to, and re-activating the
   * tab already in front is not a step.
   */
  const stepTab = useCallback((delta: number) => {
    const strip = workingPane === 'secondary' ? secondaryTabs : tabs;
    const frontId = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
    if (strip.length < 2) return;
    const at = strip.findIndex((tab) => tab.id === frontId);
    if (at === -1) return;
    activateTab(strip[(at + delta + strip.length) % strip.length]!.id);
  }, [workingPane, tabs, secondaryTabs, activeTabId, secondaryActiveTabId, activateTab]);

  /*
   * The dock gesture on the keyboard: the tab in front moves to the other pane,
   * the same single action a drag onto the other strip dispatches. There is no
   * separate "split" verb to reach for -- a split is what it looks like when a
   * tab is in the pane that had none, so moving one there opens it and moving
   * the last one back closes it.
   *
   * With one tab open and no split, that means nothing visible happens: the
   * pane it left is empty, so `promoteIfPrimaryEmpty` hands it straight back.
   * Dragging that same tab does exactly the same thing.
   */
  const dockActiveTab = useCallback(() => {
    const id = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
    if (!id) return;
    moveTab(id, null, workingPane === 'secondary' ? 'primary' : 'secondary');
  }, [workingPane, activeTabId, secondaryActiveTabId, moveTab]);

  /*
   * Every way a tab closes comes through here: the × in the strip, all four
   * context-menu items, and the shortcut. One seam, because the thing being
   * guarded is the *close* and not any one gesture -- wiring the confirm into
   * the strip would leave the shortcut destroying text silently, and the two
   * would drift the first time a third way to close arrived.
   *
   * A set with nothing unsaved in it closes with no dialog at all, which is
   * every grid tab, every untouched definition tab, and every empty Query N.
   */
  const [closing, setClosing] = useState<{ ids: string[]; unsaved: Tab[] } | null>(null);
  const requestClose = useCallback((intent: CloseIntent) => {
    const ids = closeIdsFor(intent);
    if (ids.length === 0) return;
    const unsaved = connectionTabs.filter((tab) => ids.includes(tab.id) && tab.unsaved === true);
    if (unsaved.length === 0) { closeTabs(ids); return; }
    setClosing({ ids, unsaved });
  }, [closeIdsFor, closeTabs, connectionTabs]);

  const closeActiveTab = useCallback(() => {
    const id = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
    if (id) requestClose({ kind: 'one', id });
  }, [workingPane, activeTabId, secondaryActiveTabId, requestClose]);

  const shellCommands: Partial<Record<ShortcutId, () => void>> = useMemo(() => ({
    newTab: () => { openEditorTab(); },
    closeTab: closeActiveTab,
    nextTab: () => stepTab(1),
    previousTab: () => stepTab(-1),
    dockTab: dockActiveTab,
    // The one in front, which is what `useSession().disconnect` already defaults
    // to. The rail's menu is the other way in, and it names its own chip.
    disconnect: () => disconnect(),
    toggleSidebar,
  }), [openEditorTab, closeActiveTab, stepTab, dockActiveTab, disconnect, toggleSidebar]);

  /*
   * The shortcuts the shell owns, and the half of each that answers from
   * anywhere in the window. The other half is Monaco's, which is handed
   * `shellCommands` and registers the same handler as an action of its own --
   * a chord Monaco binds never reaches the window at all.
   *
   * One listener over the whole map rather than one per command: adding a
   * shortcut is a registry row and an entry below, and nothing else.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const chord = chordFromEvent(e);
      if (chord === null) return;
      const id = (Object.keys(shellCommands) as ShortcutId[]).find((key) => bindings[key] === chord);
      if (!id) return;
      e.preventDefault();
      shellCommands[id]?.();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings, shellCommands]);

  /*
   * Lazily browse a restored grid tab the first time it is in front.
   *
   * A tab opened by hand browses imperatively (openTable, FK-nav, duplicate), so
   * by the time this runs it already has a `results` entry -- which is exactly the
   * guard here: only a tab with *no* entry (never attempted) is caught, and the
   * only tabs in that state are the ones `sessionOpened` restored. Their contents
   * are refetched, never cached, and each waits until it is actually viewed rather
   * than firing every table's browse the instant a connection reopens. The seed
   * `filter` is the `WHERE` it was reopened on.
   */
  const activeNeedsBrowse = useAppSelector((s) =>
    activeTab?.kind === 'grid' && activeTab.table ? s.results[activeTab.id] === undefined : false
  );
  useEffect(() => {
    if (activeTab?.kind === 'grid' && activeTab.table && activeNeedsBrowse) {
      browseInPrimary(activeTab.id, activeTab.table, 0, activeTab.filter);
    }
  }, [activeTab, activeNeedsBrowse, browseInPrimary]);

  // The same rule, for the secondary pane. A tab can reach it by being dragged
  // there directly, without ever having been "active" in primary long enough
  // to trigger its own first browse -- so this cannot be folded into the
  // effect above, which only ever watches the primary tab.
  const secondaryNeedsBrowse = useAppSelector((s) =>
    secondaryActiveTab?.kind === 'grid' && secondaryActiveTab.table ? s.results[secondaryActiveTab.id] === undefined : false
  );
  useEffect(() => {
    if (secondaryActiveTab?.kind === 'grid' && secondaryActiveTab.table && secondaryNeedsBrowse) {
      browseInSecondary(secondaryActiveTab.id, secondaryActiveTab.table, 0, secondaryActiveTab.filter);
    }
  }, [secondaryActiveTab, secondaryNeedsBrowse, browseInSecondary]);

  const openTable = useCallback((table: TableInfo) => {
    const relation = relationOf(table);
    const tabId = openGridTab(relation, relationLabel(relation, defaultSchema));
    if (tabId) browseInPrimary(tabId, relation.table, 0);
  }, [openGridTab, browseInPrimary, defaultSchema]);

  /*
   * A definition tab is born holding its text rather than being opened empty and
   * then written into. A `setSql` is a `sqlChanged`, which marks a tab unsaved --
   * so seeding through one would have every DDL tab asking to be saved on close,
   * about text nobody typed and the tree can regenerate. See `Tab.unsaved`.
   */
  const showDefinition = useCallback(async (database: string, table: TableInfo) => {
    const relation = relationOf(table);
    const name = relationLabel(relation, defaultSchema);
    let text: string;
    try { text = await fetchDdl(database, relation, table.kind); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    openEditorTab(name, text);
  }, [fetchDdl, openEditorTab, defaultSchema]);

  const showTriggerDefinition = useCallback(async (database: string, table: string, trigger: TriggerInfo, schema?: string) => {
    const name = trigger.name;
    let text: string;
    try { text = await fetchTriggerDdl(database, table, name, schema); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    openEditorTab(name, text);
  }, [fetchTriggerDdl, openEditorTab]);

  const showFunctionDefinition = useCallback(async (database: string, func: FunctionInfo) => {
    const name = func.name;
    let text: string;
    try { text = await fetchFunctionDdl(database, name, func.kind, func.schema); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    openEditorTab(name, text);
  }, [fetchFunctionDdl, openEditorTab]);

  /*
   * A copy of a tab is a new tab of the same kind, plus whatever the original
   * was holding: a grid tab re-browses its table, an editor tab is seeded with
   * its text. Both of those already have a way in -- this spans tabs, the
   * editor and the results, so it is wired here and passed down.
   *
   * The copy takes the next `Query N` rather than the original's name, which is
   * the same answer the tree gives when a table is opened twice: two tabs, and
   * you can tell them apart.
   *
   * Only wired to the primary strip's context menu today, but looks the id up
   * across both panes regardless -- cheap, and it means nothing has to change
   * here the day the secondary strip grows the same menu item.
   */
  const duplicateTab = useCallback((tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId) ?? secondaryTabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;

    if (tab.kind === 'grid' && tab.table) {
      const id = openGridTab({ table: tab.table, schema: tab.schema }, tab.title);
      if (id) browseInPrimary(id, tab.table, 0);
      return;
    }
    // Seeded at birth, the way a definition tab is: the model reads the tab's
    // text when it is created, so this is not a write into a live editor, and a
    // copy nobody has touched yet is not a tab holding unsaved work.
    openEditorTab(undefined, peekSql(tabId) ?? '');
  }, [tabs, secondaryTabs, openGridTab, openEditorTab, browseInPrimary, peekSql]);

  /*
   * Saved queries span the tabs, the editor's text and the queries slice, so both
   * halves are wired here and arrive at the strip and the editor as props.
   *
   * Opening one is a *new* tab every time, the rule clicking a table already
   * follows: reopening the same query beside itself is how you compare an edit
   * against what is stored. It is born named, linked and already holding its
   * text -- one action rather than an open and a `setSql`, since a `setSql` is
   * what marks a tab edited. Always opens into the primary pane, the same as
   * every other new tab -- the secondary pane is populated only by dragging.
   */
  const openSavedQuery = useCallback((query: SavedQuery) => {
    openSavedQueryTab(query.id, query.name, query.sql);
  }, [openSavedQueryTab]);

  /*
   * Ctrl+S. Which of the two things it does is whether the tab already knows
   * which saved query it is:
   *
   * - it does -- write over that row, no dialog. The strip's unsaved mark
   *   clearing is the acknowledgement, which is why saving silently is allowed
   *   to be silent.
   * - it does not -- ask for a name, once.
   *
   * A link whose query has since been deleted falls to the second case rather
   * than re-creating the row under its old id: the extension refuses that, and
   * the honest reading of a deleted query is that this tab is unsaved again.
   *
   * Parameterized by which tab, not pinned to "the" active one: a split view
   * has two editors, and Ctrl+S from either has to save *that* pane's query,
   * not always the primary pane's.
   */
  const [namingTab, setNamingTab] = useState<{ id: string; title: string; sql: string } | null>(null);

  const saveQueryForTab = useCallback((tab: Tab | null) => {
    if (tab?.kind !== 'editor') return;
    const tabId = tab.id;
    const sql = peekSql(tabId) ?? '';
    const linked = queries.find((query) => query.id === tab.savedQueryId);
    if (linked) {
      // The mark is cleared by the *save landing*, not by pressing the key: a
      // write that the extension refuses must leave the tab saying it still
      // holds edits, because it does.
      void saveQuery({ id: linked.id, name: linked.name, sql })
        .then((saved) => markTabSaved(tabId, saved.id, saved.name, saved.sql))
        .catch(() => undefined);
      return;
    }
    setNamingTab({ id: tabId, title: tab.title, sql });
  }, [peekSql, queries, saveQuery, markTabSaved]);

  const saveActiveQuery = useCallback(() => saveQueryForTab(activeTab), [saveQueryForTab, activeTab]);
  const saveSecondaryQuery = useCallback(() => saveQueryForTab(secondaryActiveTab), [saveQueryForTab, secondaryActiveTab]);

  // The picker moved. It re-browses every grid tab currently on screen so what
  // is on screen follows the database that is now selected -- both panes',
  // not just the primary's, since the picker is one control for the whole
  // connection and a stale secondary pane would disagree with it. If the
  // table a pane was showing is not there, that surfaces as that pane's own
  // error, not as the picker being talked out of the move.
  const changeDatabase = useCallback((database: string) => {
    setDatabase(database);
    if (activeTab?.kind === 'grid' && activeTab.table) browseInPrimary(activeTab.id, activeTab.table, 0);
    if (secondaryActiveTab?.kind === 'grid' && secondaryActiveTab.table) browseInSecondary(secondaryActiveTab.id, secondaryActiveTab.table, 0);
  }, [activeTab, secondaryActiveTab, setDatabase, browseInPrimary, browseInSecondary]);

  const primaryShowEditor = activeTab?.kind === 'editor';
  const secondaryShowEditor = secondaryActiveTab?.kind === 'editor';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ConnectionRail onAdd={onAddConnection} />

      <div style={{ display: 'grid', gridTemplateColumns: sidebarCollapsed ? '28px 1fr' : `${sidebarWidth}px auto 1fr`, flex: 1, minHeight: 0 }}>
        <Sidebar onSelectTable={openTable} onSelectDatabase={changeDatabase} onShowDefinition={showDefinition} onShowTriggerDefinition={showTriggerDefinition} onShowFunctionDefinition={showFunctionDefinition}
          collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        {!sidebarCollapsed && <ResizeHandle orientation="vertical" onDrag={dragSidebar} />}

        <div ref={panes} style={{ display: 'flex', minWidth: 0, minHeight: 0 }}>
          <main data-testid={primaryShowEditor ? undefined : 'main-grid'} className={primaryShowEditor ? '' : 'main--grid'}
            style={{ position: 'relative', display: 'grid', gridTemplateRows: primaryShowEditor ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${resultsHeight}px` : `${t.TAB_H}px 1fr`, flex: showSplit ? `${splitFraction} 1 0` : 1, minWidth: 0, minHeight: 0 }}
            onFocusCapture={() => setFocusedPane('primary')} onPointerDownCapture={() => setFocusedPane('primary')}>
            {/* The button is beside the strip, not inside it: the strip scrolls
                once there are more tabs than fit, and a control inside it would
                scroll away with them. */}
            <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
              <TabStrip tabs={tabs} activeTabId={activeTabId} onActivate={activateTab} onClose={(id) => requestClose({ kind: 'one', id })}
                onCloseOthers={(id) => requestClose({ kind: 'others', id })} onCloseToTheRight={(id) => requestClose({ kind: 'right', id })}
                onCloseAll={() => requestClose({ kind: 'all', pane: 'primary' })}
                onMove={(id, beforeId) => moveTab(id, beforeId, 'primary')} onRename={renameTab}
                onNewTab={() => openEditorTab()} onDuplicateTab={duplicateTab}
                draggingId={draggingId} onDragTab={setDraggingId} />
              <SavedQueriesButton onOpen={openSavedQuery} />
            </div>
            <EditorPane tab={activeTab} onRun={runPrimary} running={primaryRunning} commands={shellCommands} onSaveQuery={saveActiveQuery}
              focused={!showSplit || focusedPane === 'primary'} />
            {primaryShowEditor && <ResizeHandle orientation="horizontal" onDrag={dragResults} />}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', borderTop: primaryShowEditor ? undefined : `1px solid ${t.BORDER}` }}>
              {activeTab ? <ResultsTable tab={activeTab} /> : <Note kind="muted">Nothing open. Click a table, or start a new query.</Note>}
            </div>

            {/*
             * Dropping a tab in the pane's *body* moves it here -- the strip
             * is not the only target, because the strip is a 32px ribbon and
             * the thing the user is aiming at is the pane. While there is no
             * split yet the right half is the dock zone that opens one; once
             * there is, the whole body of each pane accepts a tab from the
             * other one.
             */}
            {!showSplit && draggingId && (
              <TabDropZone testId="dock-zone" half onDropTab={() => { moveTab(draggingId, null, 'secondary'); setDraggingId(null); }} />
            )}
            {showSplit && draggedPane === 'secondary' && (
              <TabDropZone testId="pane-drop-primary" onDropTab={() => { moveTab(draggingId!, null, 'primary'); setDraggingId(null); }} />
            )}
          </main>

          {showSplit && <ResizeHandle orientation="vertical" onDrag={dragSplit} />}

          {showSplit && (
            <main data-testid={secondaryShowEditor ? undefined : 'main-grid-secondary'} className={secondaryShowEditor ? '' : 'main--grid'}
              style={{ position: 'relative', display: 'grid', gridTemplateRows: secondaryShowEditor ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${secondaryResultsHeight}px` : `${t.TAB_H}px 1fr`, flex: `${1 - splitFraction} 1 0`, minWidth: 0, minHeight: 0 }}
              onFocusCapture={() => setFocusedPane('secondary')} onPointerDownCapture={() => setFocusedPane('secondary')}>
              <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
                <TabStrip tabs={secondaryTabs} activeTabId={secondaryActiveTabId} onActivate={activateTab} onClose={(id) => requestClose({ kind: 'one', id })}
                  onCloseOthers={(id) => requestClose({ kind: 'others', id })} onCloseToTheRight={(id) => requestClose({ kind: 'right', id })}
                  onCloseAll={() => requestClose({ kind: 'all', pane: 'secondary' })}
                  onMove={(id, beforeId) => moveTab(id, beforeId, 'secondary')} onRename={renameTab}
                  draggingId={draggingId} onDragTab={setDraggingId} />
              </div>
              <EditorPane tab={secondaryActiveTab} onRun={runSecondary} running={secondaryRunning} commands={shellCommands} onSaveQuery={saveSecondaryQuery}
                focused={focusedPane === 'secondary'} exposeGlobal={false} />
              {secondaryShowEditor && <ResizeHandle orientation="horizontal" onDrag={dragSecondaryResults} />}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', borderTop: secondaryShowEditor ? undefined : `1px solid ${t.BORDER}` }}>
                <ResultsTable tab={secondaryActiveTab} />
              </div>

              {draggedPane === 'primary' && (
                <TabDropZone testId="pane-drop-secondary" onDropTab={() => { moveTab(draggingId!, null, 'secondary'); setDraggingId(null); }} />
              )}
            </main>
          )}
        </div>
      </div>

      <StatusBar />

      {namingTab && (
        <SaveQueryDialog
          initialName={namingTab.title}
          sql={namingTab.sql}
          onSaved={(query) => { markTabSaved(namingTab.id, query.id, query.name, query.sql); setNamingTab(null); }}
          onClose={() => setNamingTab(null)}
        />
      )}

      {closing && (
        <CloseTabsConfirm tabs={closing.unsaved}
          onConfirm={() => { closeTabs(closing.ids); setClosing(null); }}
          onCancel={() => setClosing(null)} />
      )}
    </div>
  );
}

/**
 * Where a dragged tab may be dropped inside a pane, over the pane's body.
 *
 * It starts below the tab strip (`top: TAB_H`) rather than covering the pane
 * whole: the strip runs its own drag, and swallowing its `dragover` would take
 * away the insertion mark that says *where* among the tabs it lands.
 *
 * `half` is the pane that has no split yet, where only the trailing half means
 * "open a second pane" -- the leading half is where the tab already is. It
 * carries an edge at rest, because a target that appears only once you are
 * already over it is one nobody finds; a whole-pane zone needs no such hint,
 * since by then there are two panes on screen and the gesture is to drop on
 * the other one.
 *
 * **Dashed, and grayscale until it is the one being dropped on.** A solid
 * accent edge standing by through every drag reads as a thing that is already
 * happening; dashed says *provisional*, which is what a drop target is, and
 * `--border-strong` keeps it in the chrome's grayscale until hovering earns it
 * the accent. The fill it takes then is `--selected`, the system's existing
 * word for "this one", and nothing louder.
 *
 * **It sits above the grid's own sticky chrome** (`zIndex`), which the first
 * cut did not: a sticky header or row gutter carries `z-index: 1`/`2`, and a
 * positioned element with no z-index of its own paints *below* those however
 * late it comes in the DOM -- so the zone was live over the rows and dead over
 * the header and the gutter. Well below the 50-tier floating layer (menus,
 * select popups), which must still cover it.
 */
function TabDropZone({ testId, half, onDropTab }: { testId: string; half?: boolean; onDropTab: () => void }) {
  const [over, setOver] = useState(false);
  const edge = `1px dashed ${over ? t.ACCENT : t.BORDER_STRONG}`;
  return (
    <div
      data-testid={testId}
      onDragEnter={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      // Without this the drop never fires: the default for a dragover is to
      // refuse the drop.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropTab(); }}
      style={{
        position: 'absolute',
        zIndex: 20,
        top: t.TAB_H,
        bottom: 0,
        right: 0,
        left: half ? undefined : 0,
        width: half ? '50%' : undefined,
        background: over ? t.SELECTED : 'transparent',
        borderLeft: half ? edge : undefined,
        outline: over && !half ? edge : undefined,
        outlineOffset: -1,
      }}
    />
  );
}
