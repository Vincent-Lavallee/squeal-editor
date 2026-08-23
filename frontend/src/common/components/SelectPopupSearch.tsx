import type { CSSProperties } from 'react';
import * as t from '../tokens';
import type { SelectOption } from './Select.tsx';

/*
 * The search box when it cannot be the trigger -- see `caretOnly`. It sits
 * inside the popup's own 4px padding rather than spanning it edge to edge, so
 * the rule under it reads as a divider between two parts of one panel instead
 * of a second border just inside the first.
 */
const popupSearchStyle: CSSProperties = {
    flex: 'none',
    minWidth: 0,
    marginBottom: t.GAP_XS,
    padding: '3px 8px 6px',
    border: 'none',
    borderBottom: `1px solid ${t.BORDER}`,
    borderRadius: 0,
    background: 'none',
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    outline: 'none',
};

export default function SelectPopupSearch({
    searchRef,
    testId,
    ariaLabel,
    query,
    setQuery,
    selected,
    placeholder,
}: {
    searchRef: React.RefObject<HTMLInputElement>;
    testId: string | undefined;
    ariaLabel: string | undefined;
    query: string;
    setQuery: (query: string) => void;
    selected: SelectOption | undefined;
    placeholder: string | undefined;
}) {
    return (
        <input
            ref={searchRef}
            data-testid={testId ? `${testId}-search` : undefined}
            style={popupSearchStyle}
            value={query}
            placeholder={selected?.label ?? placeholder ?? 'Search…'}
            aria-label={ariaLabel}
            aria-autocomplete="list"
            onChange={(e) => setQuery(e.target.value)}
        />
    );
}
