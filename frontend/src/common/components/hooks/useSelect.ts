import { useRef, useState } from 'react';
import type { SelectOption } from '../Select.tsx';
import { useFilteredOptions } from './useFilteredOptions.ts';
import { useSelectNav } from './useSelectNav.ts';
import { useSelectOpenState } from './useSelectOpenState.ts';
import { useSelectPopupPosition } from './useSelectPopupPosition.ts';

/**
 * Every piece of `Select`'s behaviour, composed from `useSelectOpenState`
 * (controlled/uncontrolled open), `useSelectPopupPosition` (where the popup
 * sits, and dismissal) and `useSelectKeyboardNav` (the active row and
 * keyboard handling). `Select` itself only renders what this returns.
 */
type SelectHookOptions = {
    options: readonly SelectOption[];
    value: string;
    onSelect: (value: string) => void;
    variant: 'default' | 'bare' | 'attached';
    searchable: boolean;
    caretOnly: boolean;
    align: 'start' | 'end';
    openProp: boolean | undefined;
    onOpenChange: ((open: boolean) => void) | undefined;
    disabled: boolean | undefined;
};

export function useSelect(hookOptions: SelectHookOptions) {
    const {
        options: allOptions,
        value,
        onSelect,
        searchable,
        caretOnly,
        align,
        disabled,
    } = hookOptions;
    const search = useRef<HTMLInputElement>(null);
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [query, setQuery] = useState('');

    const { open, setOpen } = useSelectOpenState(hookOptions.openProp, hookOptions.onOpenChange);
    const selected = allOptions.find((o) => o.value === value);
    const shown = useFilteredOptions(allOptions, query);

    const position = useSelectPopupPosition({
        open,
        caretOnly,
        align,
        shownLength: shown.length,
        setOpen,
        setQuery,
    });

    const { choose, nav } = useSelectNav({
        shown,
        allOptions,
        open,
        searchable,
        query,
        value,
        searchRef: search,
        onSelect,
        setOpen,
        setQuery,
        triggerRef: position.trigger,
    });

    // Deliberately not `focused`: `close()` refocuses the trigger after a pick,
    // so a bare select would otherwise keep the box lit long after the pointer
    // left it. `:focus-visible` still rings a keyboard-focused one -- this box
    // is the hover affordance, not the focus one.
    const showsBox = open || (hovered && !disabled);
    /*
     * Searching happens in the trigger -- except when the trigger is a caret,
     * which has neither room for a box nor anywhere to show what was typed. That
     * is the one case the "no field above the list" rule does not cover, because
     * its whole argument is that the trigger already *is* the field's slot. With
     * no label slot to reuse, the popup is the only place left.
     */
    const searching = open && searchable && !disabled;

    return {
        search,
        focused,
        setFocused,
        hovered,
        setHovered,
        query,
        setQuery,
        open,
        setOpen,
        selected,
        shown,
        position,
        choose,
        nav,
        showsBox,
        searchInTrigger: searching && !caretOnly,
        searchInPopup: searching && caretOnly,
    };
}
