import { useLayoutEffect, useState } from 'react';
import type { Tab } from '../../../store/tabsSlice.ts';

/*
 * A plain top-level function, not a closure inside the hook below: this hook
 * calls other hooks, so `react-hooks/immutability` treats writes to its own
 * parameters -- including through a nested closure -- as mutating a hook
 * argument. Moving the write outside the hook's body is what satisfies it.
 */
function scrollToEnd(el: HTMLDivElement) {
    el.scrollLeft = el.scrollWidth;
}

/**
 * Bring a tab into view, and the two triggers that ask for it. Split out of
 * `TabStrip` purely for length. Takes the strip's ref as a parameter rather
 * than creating its own, since `useTabStripDrag` needs to scroll through the
 * same element while dragging.
 */
export function useTabReveal(
    strip: React.RefObject<HTMLDivElement | null>,
    tabList: Tab[],
    activeTabId: string | null,
) {
    /*
     * Bring a tab into view.
     *
     * The last tab is scrolled to the strip's very *end* rather than merely into
     * view: `scrollIntoView` stops as soon as the tab fits, which parks its right
     * edge against the strip's and leaves the `+` beyond it still off screen --
     * a strip that visibly stopped short of the end it was asked for.
     */
    const revealTab = (id: string) => {
        const el = strip.current;
        if (!el) return;
        if (tabList[tabList.length - 1]?.id === id) scrollToEnd(el);
        else
            el.querySelector(`[data-tab-id="${id}"]`)?.scrollIntoView({
                inline: 'nearest',
                block: 'nearest',
            });
    };

    /*
     * Follow a tab that has just moved.
     *
     * The move is the store's and this strip re-renders from it, so the scroll
     * cannot happen in the drop handler -- the tab is not yet where it is going.
     * A layout effect keyed on the id runs after that render and before the
     * paint, so the strip never shows the tab at its old position first. Cleared
     * once spent, or the next unrelated render would scroll again.
     */
    const [reveal, setReveal] = useState<string | null>(null);
    useLayoutEffect(() => {
        if (reveal === null) return;
        revealTab(reveal);
        setReveal(null);
    }, [reveal]);

    /*
     * Follow the tab that is now in front.
     *
     * A tab arriving (`+`, a table, a definition, a duplicate, a saved query, a
     * tab docked from the other pane) is appended and made active, so on a strip
     * that already overflows it is born off screen -- the click opens something
     * nobody can see. The tab count is a dependency beside the id because a tab
     * can arrive without changing which one is active, and a *reorder* changes
     * neither, which is what `reveal` above is for.
     */
    useLayoutEffect(() => {
        if (activeTabId) revealTab(activeTabId);
    }, [activeTabId, tabList.length]);

    return { setReveal };
}
