import { useCallback, useState } from 'react';

import { SIDEBAR_MAX, SIDEBAR_MIN } from './constants.ts';

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** The sidebar's own chrome: collapsed or not, its dragged width, and the tree filter's focus request. */
export function useSidebarState() {
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

    return {
        sidebarCollapsed,
        toggleSidebar,
        filterFocusRequest,
        focusTableFilter,
        sidebarWidth,
        dragSidebar,
    };
}
