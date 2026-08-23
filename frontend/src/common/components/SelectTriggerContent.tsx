import type { CSSProperties } from 'react';
import * as t from '../tokens';
import type { TriggerProps } from './SelectTrigger.tsx';

/*
 * The search box *is* the trigger's label slot: same font, same weight, no box
 * of its own. It has to be indistinguishable from the text it replaces, or
 * opening the list would visibly swap one control for another under the cursor.
 */
const searchStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: 0,
    border: 'none',
    background: 'none',
    color: t.TEXT,
    font: 'inherit',
    outline: 'none',
};

export default function SelectTriggerContent({
    select,
    caretOnly,
    testId,
    placeholder,
    ariaLabel,
}: Pick<TriggerProps, 'select' | 'caretOnly' | 'testId' | 'placeholder' | 'ariaLabel'>) {
    if (caretOnly) return null;
    if (select.searchInTrigger) {
        return (
            <input
                ref={select.search}
                data-testid={testId ? `${testId}-search` : undefined}
                style={searchStyle}
                value={select.query}
                // The value it is replacing, so the box reads as the same control
                // it was a moment ago rather than as an empty field.
                placeholder={select.selected?.label ?? placeholder ?? ''}
                aria-label={ariaLabel}
                aria-autocomplete="list"
                onChange={(e) => select.setQuery(e.target.value)}
            />
        );
    }
    return (
        <span
            style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                ...(select.selected ? {} : { color: t.TEXT_FAINT }),
            }}
        >
            {select.selected?.label ?? placeholder ?? ''}
        </span>
    );
}
