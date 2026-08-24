import { useRef } from 'react';
import type { SelectOption } from '../Select.tsx';

/** How long a typeahead buffer survives between keystrokes, as a native select does. */
const TYPEAHEAD_MS = 700;

/**
 * Typeahead, for the lists that cannot be searched. On a searchable one the
 * letters belong in the trigger's own box: typing `u` to mean "narrow to
 * users" and having it also jump the highlight is two answers to one
 * keystroke.
 *
 * Searches the *unfiltered* `allOptions`, never the filtered `shown` list --
 * see `useSelectKeyboardNav`'s own doc comment.
 */
export function useTypeahead(options: {
    allOptions: readonly SelectOption[];
    open: boolean;
    searchable: boolean;
    onSelect: (value: string) => void;
    setActive: (index: number) => void;
}) {
    const { allOptions, open, searchable, onSelect, setActive } = options;
    const typed = useRef({ buffer: '', at: 0 });

    return (key: string): boolean => {
        if (key.length !== 1 || searchable) return false;
        const now = Date.now();
        const buffer = now - typed.current.at > TYPEAHEAD_MS ? key : typed.current.buffer + key;
        typed.current = { buffer, at: now };
        const at = allOptions.findIndex(
            (o) => !o.disabled && o.label.toLowerCase().startsWith(buffer.toLowerCase()),
        );
        if (at === -1) return false;
        if (open) setActive(at);
        else onSelect(allOptions[at]!.value);
        return true;
    };
}
