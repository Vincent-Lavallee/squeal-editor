import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Where the tooltip sits, measured off the trigger's own rect -- same call
 * `useSelectPopupPosition` makes, minus the outside-click handling a hover
 * label has no use for. `onDismiss` is `Tooltip`'s own `hide`, so a scroll or
 * a resize behind it closes it exactly as a click leaving the trigger would.
 */
export function useTooltipPosition(visible: boolean, onDismiss: () => void) {
    const triggerRef = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useLayoutEffect(() => {
        if (!visible) return;
        const anchor = triggerRef.current?.getBoundingClientRect();
        const el = tooltipRef.current;
        if (!anchor || !el) return;
        const { width, height } = el.getBoundingClientRect();
        const below = anchor.bottom + 6;
        const fitsBelow = below + height <= window.innerHeight - 4;
        const center = anchor.left + anchor.width / 2 - width / 2;
        setPos({
            top: fitsBelow ? below : Math.max(4, anchor.top - height - 6),
            left: Math.max(4, Math.min(center, window.innerWidth - width - 4)),
        });
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        window.addEventListener('scroll', onDismiss, true);
        window.addEventListener('resize', onDismiss);
        return () => {
            window.removeEventListener('scroll', onDismiss, true);
            window.removeEventListener('resize', onDismiss);
        };
    }, [visible, onDismiss]);

    return { triggerRef, tooltipRef, pos };
}
