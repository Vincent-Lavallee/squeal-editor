import { useMemo } from 'react';
import type { SelectOption } from './Select.tsx';

/** The options the search query narrows to, or every option when it is blank. */
export function useFilteredOptions(options: readonly SelectOption[], query: string) {
    return useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    }, [options, query]);
}
