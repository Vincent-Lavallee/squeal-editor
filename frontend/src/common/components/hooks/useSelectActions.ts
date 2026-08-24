import { useCallback } from 'react';
import type { SelectOption } from '../Select.tsx';

/** Closing (which refocuses the trigger) and picking an option (which closes). */
export function useSelectActions(options: {
    onSelect: (value: string) => void;
    setOpen: (open: boolean) => void;
    setQuery: (query: string) => void;
    triggerRef: React.RefObject<HTMLDivElement | null>;
}) {
    const { onSelect, setOpen, setQuery, triggerRef } = options;

    const close = useCallback(() => {
        setOpen(false);
        setQuery('');
        triggerRef.current?.focus();
    }, []);

    const choose = useCallback(
        (option: SelectOption) => {
            if (option.disabled) return;
            onSelect(option.value);
            close();
        },
        [onSelect, close],
    );

    return { close, choose };
}
