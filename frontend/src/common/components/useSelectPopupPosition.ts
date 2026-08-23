import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The floor a caret-only trigger's popup takes, having no width to inherit. */
const CARET_MIN_W = 200;

/**
 * Where the popup sits, and the listeners that close or reposition it.
 *
 * The popup is `position: fixed` and measured off the trigger rather than
 * being a child of it, because callers put this inside bars and scrolling
 * panes -- an absolutely positioned child would be clipped by the first
 * ancestor with `overflow: auto`. Same call `ContextMenu` makes, including
 * the clamp: a picker near the bottom of the window opens upward instead of
 * off the screen.
 */
export function useSelectPopupPosition(options: {
    open: boolean;
    caretOnly: boolean;
    align: 'start' | 'end';
    shownLength: number;
    setOpen: (open: boolean) => void;
    setQuery: (query: string) => void;
}) {
    const { open, caretOnly, align, shownLength, setOpen, setQuery } = options;
    const trigger = useRef<HTMLDivElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });

    const place = useCallback(() => {
        const anchor = trigger.current?.getBoundingClientRect();
        const el = popup.current;
        if (!anchor || !el) return;
        // A caret is a ~20px anchor, so matching it would make a sliver. The list
        // needs a floor of its own; every other trigger is as wide as the thing it
        // names and matching it is exactly right.
        const minWidth = caretOnly ? CARET_MIN_W : anchor.width;
        const measured = el.getBoundingClientRect();
        /*
         * The width it will *render* at, which is not the width it measures at.
         * Placement runs on the frame before `minWidth` has ever reached the popup
         * -- the first open of a mount measures it at `0` -- so a list whose
         * content is narrower than its floor measures narrow and then widens. Hung
         * off the trigger's right edge by that smaller number, it grows rightward
         * past the window when it does, and the clamp below is computed from the
         * same too-small number so it cannot save it. That is a right-aligned
         * picker clipped by exactly the difference: the database caret fused to
         * the Run button at a pane's right edge. `min-width` beats `max-width` in
         * CSS, so the floor is the answer whenever it is the larger of the two.
         */
        const width = Math.max(measured.width, minWidth);
        const below = anchor.bottom + 2;
        const fitsBelow = below + measured.height <= window.innerHeight - 4;
        // `end` hangs the popup off the trigger's right edge, so it grows leftward
        // into the pane it belongs to instead of away from it. The clamp is the
        // same either way -- alignment is a preference, staying on screen is not.
        const edge = align === 'end' ? anchor.right - width : anchor.left;
        setPos({
            top: fitsBelow ? below : Math.max(4, anchor.top - measured.height - 2),
            left: Math.max(4, Math.min(edge, window.innerWidth - width - 4)),
            minWidth,
        });
    }, [align, caretOnly]);

    useLayoutEffect(() => {
        if (open) place();
    }, [open, shownLength, place]);

    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: PointerEvent): void {
            const target = e.target as Node;
            if (popup.current?.contains(target) || trigger.current?.contains(target)) return;
            setOpen(false);
            setQuery('');
        }
        /*
         * A scroll anywhere behind the popup moves the trigger out from under it, so
         * it closes -- but the listbox's *own* scrolling is not that. This listener
         * is on the capture phase, so without the guard, keeping the active row in
         * view scrolls the list, which fires a scroll, which shuts the popup: it
         * would close on the very first arrow key, and on opening at a value far
         * enough down the list to need scrolling to at all.
         */
        function onScroll(e: Event): void {
            if (popup.current?.contains(e.target as Node)) return;
            setOpen(false);
            setQuery('');
        }
        /*
         * A resize re-measures rather than closing. Closing is the obvious reach and
         * it is wrong twice over: the trigger is still right there, so there is
         * nothing for the user to be protected from -- and the app resizes itself at
         * startup, twice, to keep Aero Snap and to make the webview refit its frame
         * (see `useWindowChrome`). A picker opened while that is still settling was
         * being shut by the app's own window management, which reads as a click that
         * did nothing and reproduces only sometimes.
         */
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open, place, setOpen, setQuery]);

    return { trigger, popup, pos };
}
