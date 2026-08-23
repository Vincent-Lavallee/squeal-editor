import { useCallback, useState } from 'react';

/**
 * Controlled when the caller passed `open`, self-owned otherwise -- the
 * standard pair, and the reason every `setOpen` call reads the same whichever
 * mode it is in. The internal state is still kept in controlled mode and
 * simply ignored, which is cheaper than branching every call site.
 */
export function useSelectOpenState(
    openProp: boolean | undefined,
    onOpenChange: ((open: boolean) => void) | undefined,
) {
    const [selfOpen, setSelfOpen] = useState(false);
    const open = openProp ?? selfOpen;
    const setOpen = useCallback(
        (next: boolean | ((prev: boolean) => boolean)) => {
            const resolved = typeof next === 'function' ? next(openProp ?? selfOpen) : next;
            setSelfOpen(resolved);
            onOpenChange?.(resolved);
        },
        [openProp, selfOpen, onOpenChange],
    );
    return { open, setOpen };
}
