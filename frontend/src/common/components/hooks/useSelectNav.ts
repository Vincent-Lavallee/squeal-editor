import type { SelectOption } from '../Select.tsx';
import { useActiveRow } from './useActiveRow.ts';
import { useSelectActions } from './useSelectActions.ts';
import { useSelectKeyboardNav } from './useSelectKeyboardNav.ts';

/** The active row and the keyboard/pointer handling built from it, plus the `close`/`choose` actions both depend on. Split out of `useSelect` purely for length. */
export function useSelectNav(args: {
    shown: readonly SelectOption[];
    allOptions: readonly SelectOption[];
    open: boolean;
    searchable: boolean;
    query: string;
    value: string;
    searchRef: React.RefObject<HTMLInputElement | null>;
    onSelect: (value: string) => void;
    setOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
    setQuery: (query: string) => void;
    triggerRef: React.RefObject<HTMLDivElement | null>;
}) {
    const {
        shown,
        allOptions,
        open,
        searchable,
        query,
        value,
        searchRef,
        onSelect,
        setOpen,
        setQuery,
        triggerRef,
    } = args;

    const { close, choose } = useSelectActions({ onSelect, setOpen, setQuery, triggerRef });
    const activeRow = useActiveRow({ shown, open, searchable, query, value, searchRef });
    const keyboard = useSelectKeyboardNav({
        shown,
        allOptions,
        open,
        searchable,
        active: activeRow.active,
        setActive: activeRow.setActive,
        onSelect,
        choose,
        close,
        setOpen,
        setQuery,
    });

    return { close, choose, nav: { ...activeRow, ...keyboard } };
}
