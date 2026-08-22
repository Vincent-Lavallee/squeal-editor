import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
    FunctionInfo,
    SavedQuery,
    TableInfo,
    TriggerInfo,
} from '../../shared/protocol/index.ts';
import { relationLabel, relationOf } from './common/db/relation.ts';
import { selectAssistantReady, sendMessage } from './store/assistantSlice.ts';
import { useAppDispatch, useAppSelector } from './store/hooks.ts';
import { useSavedQueries } from './store/savedQueriesSlice.ts';
import { useSession } from './store/sessionSlice.ts';
import { useBooleanSetting, useShortcuts } from './store/settingsSlice.ts';
import { useTabs, type CloseIntent, type Tab } from './store/tabsSlice.ts';
import { AssistantPanel, diagnosePrompt, explainPrompt } from './features/assistant/index.ts';
import { RelationshipDiagram } from './features/diagram/index.ts';
import {
    EditorPane,
    useEditor,
    useEditorKeybindings,
    useSqlCompletion,
    useSqlFormatter,
} from './features/editor/index.ts';
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

/**
 * Whether the tree keeps to the database of the tab in front.
 *
 * Remembered globally rather than per connection: it is a choice about how you
 * browse, so moving to another server keeps the pairing you chose. On by
 * default, because one database is what an ordinary session works in and the
 * tree and the tab agreeing is what that looks like -- the pin is the state you
 * ask for, when comparing two databases is the thing you are doing.
 */
const SYNC_TREE_WITH_TAB = 'tree.syncWithTab';

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

interface Props {
    onAddConnection: () => void;
    /**
     * A counter the titlebar's *Relationship diagram* bumps, because the menu is
     * `App`'s child and the tab it opens is this one's — see `App.tsx`. A counter
     * and not a flag for `focusFilter`'s reason: opening is an *event*, there is
     * no "off" state for a boolean to come back to, and asking twice has to mean
     * two tabs, which is the answer clicking a table twice already gives.
     */
    openDiagramRequest: number;
    /**
     * A counter the titlebar's assistant button bumps, exactly as
     * `openDiagramRequest` is and for its reason: the button is `App`'s child and
     * the tab it opens is this one's. Asking twice means two tabs, since an
     * assistant tab is a conversation and two conversations are a real thing to
     * want.
     */
    openAssistantRequest: number;
}

export default function Shell({
    onAddConnection,
    openDiagramRequest,
    openAssistantRequest,
}: Props) {
    return (
        <ResultsProvider>
            <ShellLayout
                onAddConnection={onAddConnection}
                openDiagramRequest={openDiagramRequest}
                openAssistantRequest={openAssistantRequest}
            />
        </ResultsProvider>
    );
}

function ShellLayout({ onAddConnection, openDiagramRequest, openAssistantRequest }: Props) {
    const {
        tabs,
        activeTab,
        activeTabId,
        secondaryTabs,
        secondaryActiveTab,
        secondaryActiveTabId,
        openGridTab,
        openEditorTab,
        openSavedQueryTab,
        openDiagramTab,
        openAssistantTab,
        setDatabase,
        markTabSaved,
        database,
        activateTab,
        closeIdsFor,
        closeTabs,
        connectionTabs,
        moveTab,
        renameTab,
    } = useTabs();
    const { dialect, disconnect, activeConnectionId } = useSession();
    const dispatch = useAppDispatch();
    // One boolean, deliberately: see `selectAssistantReady`.
    const assistantReady = useAppSelector(selectAssistantReady);
    // `tabRunning`, not the shown result's own `running`: a batch of several
    // statements leaves the pane showing a finished one while a later one is still
    // going, and Run must stay busy until the whole batch is done.
    //
    // Called once per pane rather than once for "the" active tab: a split view has
    // two tabs in front at once, each with its own run/browse/running. See `useResults`.
    const {
        run: runPrimary,
        tabRunning: primaryRunning,
        browseIn: browseInPrimary,
        refresh: refreshPrimary,
    } = useResults(activeTab);
    const {
        run: runSecondary,
        tabRunning: secondaryRunning,
        browseIn: browseInSecondary,
        refresh: refreshSecondary,
    } = useResults(secondaryActiveTab);
    const { fetchDdl, fetchTriggerDdl, fetchFunctionDdl, defaultSchema, databases } = useExplorer();
    // `peekSql` alone: every seed now rides `tabOpened`, so the composition root
    // reads the editor's text and never writes it.
    const { peekSql } = useEditor();
    const { queries, save: saveQuery } = useSavedQueries();
    const { bindings } = useShortcuts();

    // The formatter is registered once here, regardless of how many panes are
    // open -- Monaco's registration is global per language, so an `EditorPane`
    // per pane calling it itself would register the same one twice. The
    // completion provider is the same rule and is registered below, once
    // `workingDatabase` exists to point it at. See `useSqlCompletion.ts`.
    useSqlFormatter(dialect);
    // The third of them, and the same rule: keybinding rules belong to the
    // standalone keybinding service, which there is one of. See the file comment.
    useEditorKeybindings(bindings);

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const toggleSidebar = useCallback(() => setSidebarCollapsed((prev) => !prev), []);

    /*
     * Focus the tree's filter, revealing the sidebar first if it is folded away.
     *
     * A counter rather than a flag, because focusing is an event: there is no
     * "off" state for a boolean to return to, and pressing the key twice has to
     * mean two requests. The un-collapse rides in the same update so `Sidebar`'s
     * effect finds the field on screen -- focus cannot enter `display: none`.
     */
    const [filterFocusRequest, setFilterFocusRequest] = useState(0);
    const focusTableFilter = useCallback(() => {
        setSidebarCollapsed(false);
        setFilterFocusRequest((request) => request + 1);
    }, []);

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
        setSecondaryResultsHeight((prev) =>
            clamp(prev - deltaPx, RESULTS_MIN, Math.max(RESULTS_MIN, max)),
        );
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
     * How many times a fresh read has been asked of each pane's diagram.
     *
     * A diagram's fetch is its own — local to `RelationshipDiagram`, because it
     * lives and dies with one open — so `Ctrl+R` cannot call it the way it calls
     * `useResults.refresh`. What crosses instead is the *asking*, as a counter,
     * the shape `openDiagramRequest` and `focusFilter` already use: an event has
     * no "off" state for a boolean to come back from, and pressing twice has to
     * mean two reads. One per pane, because the key acts on the pane being
     * worked in and a split can show two diagrams.
     */
    const [diagramRefresh, setDiagramRefresh] = useState({ primary: 0, secondary: 0 });
    const askDiagramRefresh = useCallback((pane: Tab['pane']) => {
        setDiagramRefresh((asked) => ({ ...asked, [pane]: asked[pane] + 1 }));
    }, []);

    /*
     * Which pane's database list is open, if any.
     *
     * Held here rather than inside each picker because the keyboard is the other
     * way in: `selectDatabase` has to open the picker of the pane being *worked
     * in*, and a picker that owned its own open state could only ever be opened
     * by its own trigger. One value rather than one per pane, since two lists
     * open at once is not a state worth being able to represent.
     */
    const [pickerPane, setPickerPane] = useState<Tab['pane'] | null>(null);

    /*
     * Which pane a keyboard command acts on. Not `focusedPane` directly: a split
     * that collapses leaves that pointing at a pane which no longer exists (its
     * `<main>` is unmounted, so nothing sets it back), and every tab command
     * would then quietly act on an empty strip until the user clicked something.
     */
    const workingPane: Tab['pane'] =
        showSplit && focusedPane === 'secondary' ? 'secondary' : 'primary';

    /*
     * Where the pane being worked in runs: the database its tab is pointed at,
     * falling back to the connection's seed when nothing is open at all.
     *
     * The completion answers against it, which is why it follows the *focused*
     * pane rather than the primary one -- with two panes on two databases,
     * suggesting the other half's tables is suggesting the wrong ones. The tree
     * is deliberately not drawn from this; see `treeDatabase` below.
     */
    const workingTab = workingPane === 'secondary' ? secondaryActiveTab : activeTab;
    const workingDatabase = workingTab?.database ?? database;

    useSqlCompletion(workingDatabase);

    /*
     * Which database the tree is browsing, per connection, for as long as it is
     * **not** following the tab. Session-local by the bridge test -- it has never
     * crossed -- and held here for the same reason `pickerPane` is: the sidebar
     * belongs to no pane, and the composition root is the only thing that can see
     * the connection it is about.
     */
    const [treeDatabases, setTreeDatabases] = useState<Record<string, string>>({});

    /*
     * Whether the tree draws the tab in front's database or the one pinned above.
     *
     * Following is the default and the sidebar's toggle is what unpins it. Both
     * readings are real and the toggle exists because neither is right for
     * everyone: a session working in one database wants them to agree, and one
     * comparing two wants the tree to stay put while the tabs move. See
     * `docs/decisions.md` for the round trip this took to arrive at a switch.
     */
    const [treeFollowsTab, setTreeFollowsTab] = useBooleanSetting(SYNC_TREE_WITH_TAB, true);
    const toggleTreeSync = useCallback(
        () => setTreeFollowsTab(!treeFollowsTab),
        [setTreeFollowsTab, treeFollowsTab],
    );

    const pinnedDatabase = activeConnectionId ? treeDatabases[activeConnectionId] : undefined;
    const treeDatabase = treeFollowsTab ? workingDatabase : (pinnedDatabase ?? workingDatabase);

    /*
     * The pin is kept level with the tab while the tree is following it, so
     * unpinning **freezes** the tree where it stands rather than throwing it back
     * to wherever it was last pinned -- a toggle whose first effect is to move
     * the thing it was pressed over says nothing about what it does.
     *
     * Unfollowed, it is written once when this connection's database is first
     * known and not again. The `??` above is what covers the frames before that:
     * a fallback rather than a default, so a connection still opening shows a
     * tree rather than none.
     */
    useEffect(() => {
        if (!activeConnectionId || !workingDatabase) return;
        setTreeDatabases((prev) =>
            !treeFollowsTab && prev[activeConnectionId]
                ? prev
                : { ...prev, [activeConnectionId]: workingDatabase },
        );
    }, [activeConnectionId, workingDatabase, treeFollowsTab]);

    // Dropped by diffing the open connections rather than by hooking Disconnect,
    // the same rule everything else keyed by a runtime id follows here.
    const openConnections = useAppSelector((s) => s.session.connections);
    useEffect(() => {
        setTreeDatabases((prev) => {
            const stale = Object.keys(prev).filter((id) => openConnections[id] === undefined);
            if (stale.length === 0) return prev;
            const next = { ...prev };
            for (const id of stale) delete next[id];
            return next;
        });
    }, [openConnections]);

    /**
     * The next or previous tab of the pane being worked in, wrapping at either
     * end. A pane holding one tab has nowhere to step to, and re-activating the
     * tab already in front is not a step.
     */
    const stepTab = useCallback(
        (delta: number) => {
            const strip = workingPane === 'secondary' ? secondaryTabs : tabs;
            const frontId = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
            if (strip.length < 2) return;
            const at = strip.findIndex((tab) => tab.id === frontId);
            if (at === -1) return;
            activateTab(strip[(at + delta + strip.length) % strip.length]!.id);
        },
        [workingPane, tabs, secondaryTabs, activeTabId, secondaryActiveTabId, activateTab],
    );

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
    const requestClose = useCallback(
        (intent: CloseIntent) => {
            const ids = closeIdsFor(intent);
            if (ids.length === 0) return;
            const unsaved = connectionTabs.filter(
                (tab) => ids.includes(tab.id) && tab.unsaved === true,
            );
            if (unsaved.length === 0) {
                closeTabs(ids);
                return;
            }
            setClosing({ ids, unsaved });
        },
        [closeIdsFor, closeTabs, connectionTabs],
    );

    const closeActiveTab = useCallback(() => {
        const id = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
        if (id) requestClose({ kind: 'one', id });
    }, [workingPane, activeTabId, secondaryActiveTabId, requestClose]);

    const shellCommands: Partial<Record<ShortcutId, () => void>> = useMemo(
        () => ({
            // Into the pane being worked in, like every other tab command here.
            newTab: () => {
                openEditorTab(undefined, undefined, treeDatabase, workingPane);
            },
            /*
             * Into the *other* pane, which with no split yet is what opens one.
             *
             * The one command that produces a split by minting rather than by moving,
             * and it is allowed to where `dockTab` is not: the objection to a `split`
             * verb was that overloading the move gesture would mint a tab nobody asked
             * for. Asking for a tab is the whole of what this is. See `docs/decisions.md`.
             */
            newTabOtherPane: () => {
                openEditorTab(
                    undefined,
                    undefined,
                    treeDatabase,
                    workingPane === 'secondary' ? 'primary' : 'secondary',
                );
            },
            closeTab: closeActiveTab,
            nextTab: () => stepTab(1),
            previousTab: () => stepTab(-1),
            dockTab: dockActiveTab,
            /*
             * The pane being worked in, not the primary one -- the same rule every
             * other tab command here follows. Opening it is all this does; the picking
             * is the picker's, and Escape closes it the way it always did.
             *
             * Every kind of tab has a picker now, each in the bar it already had: the
             * caret on Run, the caret on Search, the diagram's own name at the left of
             * its toolbar. `workingTab` still has to exist, or the next thing to read
             * `pickerPane` inherits a pointer at a pane with no list in it.
             */
            selectDatabase: () => {
                if (workingTab) setPickerPane(workingPane);
            },
            /*
             * Re-read what the pane being worked in is showing: a grid tab's page, or
             * a diagram's schema. An editor tab has neither -- its rows came from
             * statements the user wrote, and re-issuing those is Run -- so
             * `useResults.refresh` refuses for itself and nothing happens.
             *
             * Bound on every kind regardless, because the whole point of claiming
             * Ctrl+R is that the webview does not get to reload the app with it.
             */
            refresh: () => {
                if (workingTab?.kind === 'diagram') {
                    askDiagramRefresh(workingPane);
                    return;
                }
                if (workingPane === 'secondary') refreshSecondary();
                else refreshPrimary();
            },
            // The one in front, which is what `useSession().disconnect` already defaults
            // to. The rail's menu is the other way in, and it names its own chip.
            disconnect: () => disconnect(),
            toggleSidebar,
            syncTree: toggleTreeSync,
            filterTables: focusTableFilter,
            // Named `toggle` because that is the gesture: `openAssistantTab` focuses the
            // one already open rather than minting a second, so pressing it twice lands
            // you back where you were.
            newAssistantChat: () => openAssistantTab(workingPane),
        }),
        [
            openEditorTab,
            closeActiveTab,
            stepTab,
            dockActiveTab,
            disconnect,
            toggleSidebar,
            toggleTreeSync,
            focusTableFilter,
            openAssistantTab,
            workingPane,
            workingTab,
            treeDatabase,
            refreshPrimary,
            refreshSecondary,
            askDiagramRefresh,
        ],
    );

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
            const id = (Object.keys(shellCommands) as ShortcutId[]).find(
                (key) => bindings[key] === chord,
            );
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
        activeTab?.kind === 'grid' && activeTab.table
            ? s.results[activeTab.id] === undefined
            : false,
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
        secondaryActiveTab?.kind === 'grid' && secondaryActiveTab.table
            ? s.results[secondaryActiveTab.id] === undefined
            : false,
    );
    useEffect(() => {
        if (
            secondaryActiveTab?.kind === 'grid' &&
            secondaryActiveTab.table &&
            secondaryNeedsBrowse
        ) {
            browseInSecondary(
                secondaryActiveTab.id,
                secondaryActiveTab.table,
                0,
                secondaryActiveTab.filter,
            );
        }
    }, [secondaryActiveTab, secondaryNeedsBrowse, browseInSecondary]);

    /*
     * The titlebar's *Relationship diagram*, arriving as a bumped counter.
     *
     * It opens on **the database the tree is showing**, for the reason a table
     * clicked in the tree does below: the menu belongs to no pane and no tab, so
     * the only database it can mean is the one being looked at. Into the pane
     * being worked in, the rule every control attached to no pane follows.
     *
     * The ref is what makes a counter a counter: an effect keyed on it alone
     * would also fire on mount, opening a diagram nobody asked for the moment a
     * connection appears.
     */
    const lastDiagramRequest = useRef(openDiagramRequest);
    useEffect(() => {
        if (openDiagramRequest === lastDiagramRequest.current) return;
        lastDiagramRequest.current = openDiagramRequest;
        openDiagramTab(treeDatabase, workingPane);
    }, [openDiagramRequest, openDiagramTab, treeDatabase, workingPane]);

    // The assistant arrives the same way and through the same guard. No database
    // travels with it: the conversation is about no one database, and its tools
    // name whichever connection they used.
    const lastAssistantRequest = useRef(openAssistantRequest);
    useEffect(() => {
        if (openAssistantRequest === lastAssistantRequest.current) return;
        lastAssistantRequest.current = openAssistantRequest;
        openAssistantTab(workingPane);
    }, [openAssistantRequest, openAssistantTab, workingPane]);

    /*
     * A table clicked in the tree opens on **the database the tree is showing**,
     * never on whatever the tab in front happens to be pointed at. The two are
     * now separate facts by design, so this is the whole of how a table reached
     * by browsing elsewhere opens somewhere it exists -- inheriting would open
     * `analytics.orders` as a tab pointed at `shop`, a grid that fails to browse
     * the instant it appears.
     *
     * `database` is for the caller that is looking at a database of its own: a
     * diagram is a picture of one, and a node clicked in it means that one's
     * table however far the tree has since been moved. The tree passes none,
     * because for the tree the default *is* the answer.
     *
     * The tree belongs to no pane, so what it opens goes to the one being worked
     * in. A strip's own `+` and bookmark name their own pane instead, because
     * those *are* attached to one.
     */
    const openTable = useCallback(
        (table: TableInfo, database?: string | null) => {
            const relation = relationOf(table);
            const tabId = openGridTab(
                relation,
                relationLabel(relation, defaultSchema),
                database ?? treeDatabase,
                workingPane,
            );
            if (!tabId) return;
            if (workingPane === 'secondary') browseInSecondary(tabId, relation.table, 0);
            else browseInPrimary(tabId, relation.table, 0);
        },
        [openGridTab, browseInPrimary, browseInSecondary, defaultSchema, treeDatabase, workingPane],
    );

    /*
     * A definition tab is born holding its text rather than being opened empty and
     * then written into. A `setSql` is a `sqlChanged`, which marks a tab unsaved --
     * so seeding through one would have every DDL tab asking to be saved on close,
     * about text nobody typed and the tree can regenerate. See `Tab.unsaved`.
     */
    const showDefinition = useCallback(
        async (database: string, table: TableInfo) => {
            const relation = relationOf(table);
            const name = relationLabel(relation, defaultSchema);
            let text: string;
            try {
                text = await fetchDdl(database, relation, table.kind);
            } catch (err) {
                const reason =
                    typeof err === 'string'
                        ? err
                        : err instanceof Error
                          ? err.message
                          : String(err);
                text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`;
            }
            // On the database the definition was read from -- the tab is *about* that
            // relation, so running anything in it anywhere else would be about a
            // different one, or about nothing.
            openEditorTab(name, text, database, workingPane);
        },
        [fetchDdl, openEditorTab, defaultSchema],
    );

    const showTriggerDefinition = useCallback(
        async (database: string, table: string, trigger: TriggerInfo, schema?: string) => {
            const name = trigger.name;
            let text: string;
            try {
                text = await fetchTriggerDdl(database, table, name, schema);
            } catch (err) {
                const reason =
                    typeof err === 'string'
                        ? err
                        : err instanceof Error
                          ? err.message
                          : String(err);
                text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`;
            }
            openEditorTab(name, text, database, workingPane);
        },
        [fetchTriggerDdl, openEditorTab],
    );

    const showFunctionDefinition = useCallback(
        async (database: string, func: FunctionInfo) => {
            const name = func.name;
            let text: string;
            try {
                text = await fetchFunctionDdl(database, func);
            } catch (err) {
                const reason =
                    typeof err === 'string'
                        ? err
                        : err instanceof Error
                          ? err.message
                          : String(err);
                text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`;
            }
            openEditorTab(name, text, database, workingPane);
        },
        [fetchFunctionDdl, openEditorTab],
    );

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
    const duplicateTab = useCallback(
        (tabId: string) => {
            const tab =
                tabs.find((candidate) => candidate.id === tabId) ??
                secondaryTabs.find((candidate) => candidate.id === tabId);
            if (!tab) return;

            // A copy runs where the original ran. Inheriting from whatever is in front
            // would make "duplicate" quietly mean "duplicate, somewhere else" for any
            // tab that is not the one being copied.
            if (tab.kind === 'grid' && tab.table) {
                // Beside the original, in its own pane -- a copy you have to go and find
                // in the other half is not the comparison the gesture is for.
                const id = openGridTab(
                    { table: tab.table, schema: tab.schema },
                    tab.title,
                    tab.database,
                    tab.pane,
                );
                if (!id) return;
                if (tab.pane === 'secondary') browseInSecondary(id, tab.table, 0);
                else browseInPrimary(id, tab.table, 0);
                return;
            }
            // A diagram has nothing to carry across but the database it is about, so a
            // copy is simply another one of it -- and it must be taken before the
            // editor branch below, which would otherwise hand back a blank query tab.
            if (tab.kind === 'diagram') {
                openDiagramTab(tab.database, tab.pane);
                return;
            }
            // Seeded at birth, the way a definition tab is: the model reads the tab's
            // text when it is created, so this is not a write into a live editor, and a
            // copy nobody has touched yet is not a tab holding unsaved work.
            openEditorTab(undefined, peekSql(tabId) ?? '', tab.database, tab.pane);
        },
        [
            tabs,
            secondaryTabs,
            openGridTab,
            openEditorTab,
            openDiagramTab,
            browseInPrimary,
            browseInSecondary,
            peekSql,
        ],
    );

    /*
     * Saved queries span the tabs, the editor's text and the queries slice, so both
     * halves are wired here and arrive at the strip and the editor as props.
     *
     * Opening one is a *new* tab every time, the rule clicking a table already
     * follows: reopening the same query beside itself is how you compare an edit
     * against what is stored. It is born named, linked and already holding its
     * text -- one action rather than an open and a `setSql`, since a `setSql` is
     * what marks a tab edited. It opens into the pane whose bookmark was pressed:
     * each strip has one, so the button you reach for is the answer.
     */
    const openSavedQuery = useCallback(
        (query: SavedQuery, pane: Tab['pane']) => {
            openSavedQueryTab(query.id, query.name, query.sql, pane, treeDatabase);
        },
        [openSavedQueryTab, treeDatabase],
    );

    /*
     * Ask the assistant something on the user's behalf: a new conversation, born
     * holding the question.
     *
     * Both callers are elsewhere in the app -- the error under a result grid, a
     * selection in the editor -- and both go through here for the reason every
     * cross-feature gesture does: opening a tab is the tabs', sending a message is
     * the assistant's, and neither feature may import the other.
     *
     * **A new tab every time**, which is what `openAssistantTab` already means: a
     * diagnosis is a new question, and dropping it into a conversation about
     * something else buries both.
     *
     * **It opens in the *other* pane, splitting the view.** This is the one place
     * in the app that does not use `workingPane`, and the exception is the whole
     * point of these two entry points: the question is *about what is on screen*,
     * so an answer that replaces it with itself makes you flip back and forth
     * between the error and the explanation of the error. Beside it, the two are
     * readable together -- which is the gesture `Ctrl+Shift+T` already exists for,
     * taken automatically because here the app is the one deciding to open a tab.
     * With no split yet, minting into the secondary pane is what creates one.
     *
     * **Whether it can be asked at all is decided by the callers**, which draw
     * their control only when a key is stored -- so there is no branch here for
     * the state where nothing could be sent. A button offering to diagnose an
     * error and then opening a form to paste a key into is help that turns into
     * an errand; and queuing the question to fire once a key arrives is real
     * machinery (a prompt with a lifetime, surviving a tab close) for the one
     * state where the assistant does not work at all.
     */
    const askAssistant = useCallback(
        (question: string) => {
            const tabId = openAssistantTab(workingPane === 'secondary' ? 'primary' : 'secondary');
            if (tabId) void dispatch(sendMessage({ tabId, text: question }));
        },
        [openAssistantTab, workingPane, dispatch],
    );

    const diagnoseFailure = useCallback(
        (tab: Tab, failure: { sql: string | null; error: string }) => {
            askAssistant(
                diagnosePrompt({ tabTitle: tab.title, database: tab.database, ...failure }),
            );
        },
        [askAssistant],
    );

    const explainSelection = useCallback(
        (tab: Tab, sql: string) => {
            askAssistant(explainPrompt({ tabTitle: tab.title, database: tab.database, sql }));
        },
        [askAssistant],
    );

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
    const [namingTab, setNamingTab] = useState<{ id: string; title: string; sql: string } | null>(
        null,
    );

    const saveQueryForTab = useCallback(
        (tab: Tab | null) => {
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
        },
        [peekSql, queries, saveQuery, markTabSaved],
    );

    // The strip's menu can be summoned on a tab that is not in front, so it names
    // the tab it acts on rather than relying on which one is active.
    const saveTab = useCallback(
        (id: string) => saveQueryForTab(connectionTabs.find((tab) => tab.id === id) ?? null),
        [saveQueryForTab, connectionTabs],
    );

    const saveActiveQuery = useCallback(
        () => saveQueryForTab(activeTab),
        [saveQueryForTab, activeTab],
    );
    const saveSecondaryQuery = useCallback(
        () => saveQueryForTab(secondaryActiveTab),
        [saveQueryForTab, secondaryActiveTab],
    );

    /*
     * Point one tab at a database -- the whole of what a *tab's* picker does,
     * whichever pane's, and whichever kind of tab it hangs off.
     *
     * There is one per pane per kind -- the caret on Run for an editor tab, the
     * caret on Search for a grid tab, the name at the left of a diagram's
     * toolbar -- and they are all controls onto one value rather than several:
     * each names the tab it is about, and all of them land here. A grid tab
     * re-browses on the spot, so what is on screen never disagrees with what the
     * tab says it is showing; if the table is not there under the new database
     * that surfaces as that pane's own error, the same as any missing table. A
     * diagram needs no line here at all: it draws from `Tab.database`, so moving
     * the tab is the whole of moving the drawing.
     *
     * The sidebar's picker is one of these only while the tree is following the
     * tab -- see `browseDatabase`.
     */
    const pointTabAt = useCallback(
        (target: Tab | null, pane: Tab['pane'], database: string) => {
            setDatabase(database, target?.id ?? null);
            if (target?.kind !== 'grid' || !target.table) return;
            if (pane === 'secondary') browseInSecondary(target.id, target.table, 0);
            else browseInPrimary(target.id, target.table, 0);
        },
        [setDatabase, browseInPrimary, browseInSecondary],
    );

    /*
     * The sidebar's picker, which the toggle beside it makes mean two things.
     *
     * **Following**, it points the tab in front at the database as well. Not a
     * convenience: a following tree *is* the tab's database, so a pick that moved
     * only the tree would be undone by the very next render -- a picker that
     * visibly snaps back. Pointing the tab is what makes it land, and it is the
     * other half of what the two arrows on the toggle say.
     *
     * **Pinned**, it moves the tree and the connection's seed and nothing that is
     * already open: retargeting a tab from here would re-couple the two facts at
     * the one gesture the pin exists for. The seed still moves because with
     * nothing open the tree's database is the only one on screen and is what a
     * first tab should be born on -- which is also the whole of what the
     * following branch does when there is no tab, since `pointTabAt` takes a
     * `null` target to mean exactly that.
     */
    const browseDatabase = useCallback(
        (database: string) => {
            if (!activeConnectionId) return;
            setTreeDatabases((prev) => ({ ...prev, [activeConnectionId]: database }));
            if (treeFollowsTab) pointTabAt(workingTab, workingPane, database);
            else setDatabase(database, null);
        },
        [activeConnectionId, setDatabase, treeFollowsTab, pointTabAt, workingTab, workingPane],
    );

    const primaryShowEditor = activeTab?.kind === 'editor';
    const secondaryShowEditor = secondaryActiveTab?.kind === 'editor';

    /*
     * Every kind of tab opens on the database the tree was pointed at and can be
     * moved from there by its own picker: the caret on Run, the caret on Search,
     * the diagram's own name at the left of its toolbar. They differ in where
     * the control hangs, never in what it does -- all three land in `pointTabAt`.
     * See `docs/decisions.md` for the two that went without one first.
     */

    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
            }}
        >
            <ConnectionRail onAdd={onAddConnection} />

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: sidebarCollapsed
                        ? '28px 1fr'
                        : `${sidebarWidth}px auto 1fr`,
                    flex: 1,
                    minHeight: 0,
                }}
            >
                <Sidebar
                    shownDatabase={treeDatabase}
                    synced={treeFollowsTab}
                    onToggleSync={toggleTreeSync}
                    onSelectTable={openTable}
                    onSelectDatabase={browseDatabase}
                    onShowDefinition={showDefinition}
                    onShowTriggerDefinition={showTriggerDefinition}
                    onShowFunctionDefinition={showFunctionDefinition}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={toggleSidebar}
                    focusFilter={filterFocusRequest}
                />
                {!sidebarCollapsed && <ResizeHandle orientation="vertical" onDrag={dragSidebar} />}

                <div ref={panes} style={{ display: 'flex', minWidth: 0, minHeight: 0 }}>
                    {/* `main--grid` is every non-editor tab, since it is what hides Monaco;
              the test id is the *grid* alone, so a diagram tab does not answer
              to a selector meaning "the result grid's pane". */}
                    <main
                        data-testid={
                            primaryShowEditor ||
                            activeTab?.kind === 'diagram' ||
                            activeTab?.kind === 'assistant'
                                ? undefined
                                : 'main-grid'
                        }
                        className={primaryShowEditor ? '' : 'main--grid'}
                        style={{
                            position: 'relative',
                            display: 'grid',
                            gridTemplateRows: primaryShowEditor
                                ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${resultsHeight}px`
                                : `${t.TAB_H}px 1fr`,
                            flex: showSplit ? `${splitFraction} 1 0` : 1,
                            minWidth: 0,
                            minHeight: 0,
                        }}
                        onFocusCapture={() => setFocusedPane('primary')}
                        onPointerDownCapture={() => setFocusedPane('primary')}
                    >
                        {/* The button is beside the strip, not inside it: the strip scrolls
                once there are more tabs than fit, and a control inside it would
                scroll away with them. */}
                        <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
                            <TabStrip
                                tabs={tabs}
                                activeTabId={activeTabId}
                                onActivate={activateTab}
                                onClose={(id) => requestClose({ kind: 'one', id })}
                                onCloseOthers={(id) => requestClose({ kind: 'others', id })}
                                onCloseToTheRight={(id) => requestClose({ kind: 'right', id })}
                                onCloseAll={() => requestClose({ kind: 'all', pane: 'primary' })}
                                onMove={(id, beforeId) => moveTab(id, beforeId, 'primary')}
                                onRename={renameTab}
                                onNewTab={() =>
                                    openEditorTab(undefined, undefined, treeDatabase, 'primary')
                                }
                                onDuplicateTab={duplicateTab}
                                onSaveTab={saveTab}
                                draggingId={draggingId}
                                onDragTab={setDraggingId}
                            />
                            <SavedQueriesButton
                                onOpen={(query) => openSavedQuery(query, 'primary')}
                            />
                        </div>
                        <EditorPane
                            tab={activeTab}
                            onRun={runPrimary}
                            running={primaryRunning}
                            commands={shellCommands}
                            onSaveQuery={saveActiveQuery}
                            onExplainSelection={
                                assistantReady && activeTab
                                    ? (sql) => explainSelection(activeTab, sql)
                                    : undefined
                            }
                            focused={!showSplit || focusedPane === 'primary'}
                            databases={databases}
                            onSelectDatabase={(db) => pointTabAt(activeTab, 'primary', db)}
                            pickerOpen={pickerPane === 'primary'}
                            onPickerOpenChange={(open) => setPickerPane(open ? 'primary' : null)}
                        />
                        {primaryShowEditor && (
                            <ResizeHandle orientation="horizontal" onDrag={dragResults} />
                        )}
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                minHeight: 0,
                                overflow: 'hidden',
                                borderTop: primaryShowEditor ? undefined : `1px solid ${t.BORDER}`,
                            }}
                        >
                            {activeTab?.kind === 'assistant' ? (
                                <AssistantPanel tabId={activeTab.id} />
                            ) : activeTab?.kind === 'diagram' ? (
                                <RelationshipDiagram
                                    tab={activeTab}
                                    onOpenTable={openTable}
                                    refreshRequest={diagramRefresh.primary}
                                    databases={databases}
                                    onSelectDatabase={(db) => pointTabAt(activeTab, 'primary', db)}
                                    pickerOpen={pickerPane === 'primary'}
                                    onPickerOpenChange={(open) =>
                                        setPickerPane(open ? 'primary' : null)
                                    }
                                />
                            ) : activeTab ? (
                                <ResultsTable
                                    tab={activeTab}
                                    onDiagnose={
                                        assistantReady
                                            ? (failure) => diagnoseFailure(activeTab, failure)
                                            : undefined
                                    }
                                    databases={databases}
                                    onSelectDatabase={(db) => pointTabAt(activeTab, 'primary', db)}
                                    pickerOpen={pickerPane === 'primary'}
                                    onPickerOpenChange={(open) =>
                                        setPickerPane(open ? 'primary' : null)
                                    }
                                />
                            ) : (
                                <Note kind="muted">
                                    Nothing open. Click a table, or start a new query.
                                </Note>
                            )}
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
                            <TabDropZone
                                testId="dock-zone"
                                half
                                onDropTab={() => {
                                    moveTab(draggingId, null, 'secondary');
                                    setDraggingId(null);
                                }}
                            />
                        )}
                        {showSplit && draggedPane === 'secondary' && (
                            <TabDropZone
                                testId="pane-drop-primary"
                                onDropTab={() => {
                                    moveTab(draggingId!, null, 'primary');
                                    setDraggingId(null);
                                }}
                            />
                        )}
                    </main>

                    {showSplit && <ResizeHandle orientation="vertical" onDrag={dragSplit} />}

                    {showSplit && (
                        <main
                            data-testid={
                                secondaryShowEditor ||
                                secondaryActiveTab?.kind === 'diagram' ||
                                secondaryActiveTab?.kind === 'assistant'
                                    ? undefined
                                    : 'main-grid-secondary'
                            }
                            className={secondaryShowEditor ? '' : 'main--grid'}
                            style={{
                                position: 'relative',
                                display: 'grid',
                                gridTemplateRows: secondaryShowEditor
                                    ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${secondaryResultsHeight}px`
                                    : `${t.TAB_H}px 1fr`,
                                flex: `${1 - splitFraction} 1 0`,
                                minWidth: 0,
                                minHeight: 0,
                            }}
                            onFocusCapture={() => setFocusedPane('secondary')}
                            onPointerDownCapture={() => setFocusedPane('secondary')}
                        >
                            <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
                                <TabStrip
                                    tabs={secondaryTabs}
                                    activeTabId={secondaryActiveTabId}
                                    onActivate={activateTab}
                                    onClose={(id) => requestClose({ kind: 'one', id })}
                                    onCloseOthers={(id) => requestClose({ kind: 'others', id })}
                                    onCloseToTheRight={(id) => requestClose({ kind: 'right', id })}
                                    onCloseAll={() =>
                                        requestClose({ kind: 'all', pane: 'secondary' })
                                    }
                                    onMove={(id, beforeId) => moveTab(id, beforeId, 'secondary')}
                                    onRename={renameTab}
                                    onNewTab={() =>
                                        openEditorTab(
                                            undefined,
                                            undefined,
                                            treeDatabase,
                                            'secondary',
                                        )
                                    }
                                    onDuplicateTab={duplicateTab}
                                    onSaveTab={saveTab}
                                    draggingId={draggingId}
                                    onDragTab={setDraggingId}
                                />
                                <SavedQueriesButton
                                    onOpen={(query) => openSavedQuery(query, 'secondary')}
                                />
                            </div>
                            <EditorPane
                                tab={secondaryActiveTab}
                                onRun={runSecondary}
                                running={secondaryRunning}
                                commands={shellCommands}
                                onSaveQuery={saveSecondaryQuery}
                                onExplainSelection={
                                    assistantReady && secondaryActiveTab
                                        ? (sql) => explainSelection(secondaryActiveTab, sql)
                                        : undefined
                                }
                                focused={focusedPane === 'secondary'}
                                exposeGlobal={false}
                                databases={databases}
                                onSelectDatabase={(db) =>
                                    pointTabAt(secondaryActiveTab, 'secondary', db)
                                }
                                pickerOpen={pickerPane === 'secondary'}
                                onPickerOpenChange={(open) =>
                                    setPickerPane(open ? 'secondary' : null)
                                }
                            />
                            {secondaryShowEditor && (
                                <ResizeHandle
                                    orientation="horizontal"
                                    onDrag={dragSecondaryResults}
                                />
                            )}
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    minHeight: 0,
                                    overflow: 'hidden',
                                    borderTop: secondaryShowEditor
                                        ? undefined
                                        : `1px solid ${t.BORDER}`,
                                }}
                            >
                                {secondaryActiveTab?.kind === 'assistant' ? (
                                    <AssistantPanel tabId={secondaryActiveTab.id} />
                                ) : secondaryActiveTab?.kind === 'diagram' ? (
                                    <RelationshipDiagram
                                        tab={secondaryActiveTab}
                                        onOpenTable={openTable}
                                        refreshRequest={diagramRefresh.secondary}
                                        databases={databases}
                                        onSelectDatabase={(db) =>
                                            pointTabAt(secondaryActiveTab, 'secondary', db)
                                        }
                                        pickerOpen={pickerPane === 'secondary'}
                                        onPickerOpenChange={(open) =>
                                            setPickerPane(open ? 'secondary' : null)
                                        }
                                    />
                                ) : (
                                    <ResultsTable
                                        tab={secondaryActiveTab}
                                        onDiagnose={
                                            assistantReady && secondaryActiveTab
                                                ? (failure) =>
                                                      diagnoseFailure(secondaryActiveTab, failure)
                                                : undefined
                                        }
                                        databases={databases}
                                        onSelectDatabase={(db) =>
                                            pointTabAt(secondaryActiveTab, 'secondary', db)
                                        }
                                        pickerOpen={pickerPane === 'secondary'}
                                        onPickerOpenChange={(open) =>
                                            setPickerPane(open ? 'secondary' : null)
                                        }
                                    />
                                )}
                            </div>

                            {draggedPane === 'primary' && (
                                <TabDropZone
                                    testId="pane-drop-secondary"
                                    onDropTab={() => {
                                        moveTab(draggingId!, null, 'secondary');
                                        setDraggingId(null);
                                    }}
                                />
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
                    onSaved={(query) => {
                        markTabSaved(namingTab.id, query.id, query.name, query.sql);
                        setNamingTab(null);
                    }}
                    onClose={() => setNamingTab(null)}
                />
            )}

            {closing && (
                <CloseTabsConfirm
                    tabs={closing.unsaved}
                    onConfirm={() => {
                        closeTabs(closing.ids);
                        setClosing(null);
                    }}
                    onCancel={() => setClosing(null)}
                />
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
function TabDropZone({
    testId,
    half,
    onDropTab,
}: {
    testId: string;
    half?: boolean;
    onDropTab: () => void;
}) {
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
            onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                onDropTab();
            }}
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
