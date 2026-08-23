import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SelectOption } from './Select.tsx';

/**
 * Which row is active, kept in view, and reset to the current value whenever
 * the popup opens or the search narrows the list.
 */
export function useActiveRow(options: {
    shown: readonly SelectOption[];
    open: boolean;
    searchable: boolean;
    query: string;
    value: string;
    searchRef: React.RefObject<HTMLInputElement | null>;
}) {
    const { shown, open, searchable, query, value, searchRef } = options;
    const list = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(0);

    /*
     * Keep the active row in view by scrolling *the listbox*, never
     * `scrollIntoView`: that walks every scrollable ancestor, so on a form long
     * enough to scroll it moves the page under a popup that is `position: fixed`
     * and does not follow -- and the scroll it causes is one the dismissal above
     * then has to be taught to ignore anyway.
     */
    useLayoutEffect(() => {
        const box = list.current;
        const row = box?.children[active];
        if (!box || !(row instanceof HTMLElement)) return;
        const bottom = row.offsetTop + row.offsetHeight;
        if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
        else if (bottom > box.scrollTop + box.clientHeight)
            box.scrollTop = bottom - box.clientHeight;
    }, [active, open]);

    // Opening lands on the current value, so arrowing starts from where you are
    // rather than from the top of the list. Deps are `open`/`searchable` only,
    // on purpose: this runs once per open, not on every value/shown change.
    useEffect(() => {
        if (!open) return;
        const at = shown.findIndex((o) => o.value === value);
        setActive(at === -1 ? 0 : at);
        if (searchable) searchRef.current?.focus();
    }, [open, searchable]);

    // Filtering moves the list under the cursor; keeping a stale index would
    // highlight a row that is no longer there, or none at all.
    useEffect(() => {
        setActive(0);
    }, [query]);

    return { active, setActive, list };
}
