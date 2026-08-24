import type { SelectOption } from '../Select.tsx';
import { useTypeahead } from './useTypeahead.ts';

type NavOptions = {
    shown: readonly SelectOption[];
    allOptions: readonly SelectOption[];
    open: boolean;
    searchable: boolean;
    active: number;
    setActive: (next: number | ((prev: number) => number)) => void;
    onSelect: (value: string) => void;
    choose: (option: SelectOption) => void;
    close: () => void;
    setOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
    setQuery: (query: string) => void;
};

/** Skip disabled rows rather than landing on one, the way a native list does. */
function stepActive(
    delta: number,
    shown: readonly SelectOption[],
    setActive: NavOptions['setActive'],
): void {
    if (shown.length === 0) return;
    setActive((prev) => {
        let next = prev;
        // Bounded by the list length so an all-disabled list cannot spin.
        for (let i = 0; i < shown.length; i++) {
            next = (next + delta + shown.length) % shown.length;
            if (!shown[next]?.disabled) return next;
        }
        return prev;
    });
}

// The popup's own keys, once it is open -- everything `onKeyDown` does while
// `!open` is a different question (open it, or start a typeahead).
function makeOnOpenKeyDown(args: {
    shown: readonly SelectOption[];
    active: number;
    searchable: boolean;
    setActive: NavOptions['setActive'];
    choose: NavOptions['choose'];
    close: NavOptions['close'];
    setOpen: NavOptions['setOpen'];
    setQuery: NavOptions['setQuery'];
    typeahead: (key: string) => boolean;
}) {
    const { shown, active, searchable, setActive, choose, close, setOpen, setQuery, typeahead } =
        args;
    return (e: React.KeyboardEvent): void => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                stepActive(1, shown, setActive);
                break;
            case 'ArrowUp':
                e.preventDefault();
                stepActive(-1, shown, setActive);
                break;
            // Home/End jump the list, except while typing into the trigger, where
            // they are the caret's and moving the highlight would steal them.
            case 'Home':
                if (searchable) break;
                e.preventDefault();
                setActive(0);
                break;
            case 'End':
                if (searchable) break;
                e.preventDefault();
                setActive(Math.max(0, shown.length - 1));
                break;
            case 'Enter': {
                e.preventDefault();
                const option = shown[active];
                if (option) choose(option);
                break;
            }
            case 'Escape':
                e.preventDefault();
                close();
                break;
            case 'Tab':
                setOpen(false);
                setQuery('');
                break;
            default:
                if (typeahead(e.key)) e.preventDefault();
        }
    };
}

/**
 * Arrow/Home/End/Enter/Escape/Tab handling. Typeahead itself is
 * `useTypeahead`; this is where its result decides what the key did.
 */
export function useSelectKeyboardNav(options: NavOptions) {
    const {
        shown,
        allOptions,
        open,
        searchable,
        active,
        setActive,
        onSelect,
        choose,
        close,
        setOpen,
        setQuery,
    } = options;

    const typeahead = useTypeahead({ allOptions, open, searchable, onSelect, setActive });
    const onOpenKeyDown = makeOnOpenKeyDown({
        shown,
        active,
        searchable,
        setActive,
        choose,
        close,
        setOpen,
        setQuery,
        typeahead,
    });

    const onKeyDown = (e: React.KeyboardEvent): void => {
        if (!open) {
            if (
                e.key === 'ArrowDown' ||
                e.key === 'ArrowUp' ||
                e.key === 'Enter' ||
                e.key === ' '
            ) {
                e.preventDefault();
                setOpen(true);
                return;
            }
            if (typeahead(e.key)) e.preventDefault();
            return;
        }
        onOpenKeyDown(e);
    };

    return { onKeyDown };
}
