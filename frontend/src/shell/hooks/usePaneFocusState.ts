import { useCallback, useState } from 'react';

import type { Tab } from '../../store/tabsSlice.ts';

/**
 * Which pane is being worked in, which pane's diagram was last asked to
 * refresh, and which pane's database picker is open. `workingPane` is what
 * every control attached to no particular pane -- the tree, the keyboard --
 * acts on; see *Split the editor* in `docs/frontend.md`.
 */
export function usePaneFocusState(showSplit: boolean) {
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

    return {
        focusedPane,
        setFocusedPane,
        diagramRefresh,
        askDiagramRefresh,
        pickerPane,
        setPickerPane,
        workingPane,
    };
}
