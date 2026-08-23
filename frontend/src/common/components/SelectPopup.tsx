import type { CSSProperties } from 'react';
import * as t from '../tokens';
import SelectOptionsList from './SelectOptionsList.tsx';
import SelectPopupSearch from './SelectPopupSearch.tsx';
import type { useSelect } from './useSelect.ts';

const popupStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    padding: t.GAP_XS,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
};

export default function SelectPopup({
    select,
    testId,
    ariaLabel,
    placeholder,
    value,
}: {
    select: ReturnType<typeof useSelect>;
    testId: string | undefined;
    ariaLabel: string | undefined;
    placeholder: string | undefined;
    value: string;
}) {
    const { pos } = select.position;

    return (
        <div
            ref={select.position.popup}
            data-testid={testId ? `${testId}-popup` : undefined}
            style={{
                ...popupStyle,
                top: pos.top,
                left: pos.left,
                minWidth: pos.minWidth,
                maxWidth: 360,
            }}
            onKeyDown={select.nav.onKeyDown}
        >
            {select.searchInPopup && (
                <SelectPopupSearch
                    searchRef={select.search}
                    testId={testId}
                    ariaLabel={ariaLabel}
                    query={select.query}
                    setQuery={select.setQuery}
                    selected={select.selected}
                    placeholder={placeholder}
                />
            )}
            <SelectOptionsList
                listRef={select.nav.list}
                ariaLabel={ariaLabel}
                shown={select.shown}
                value={value}
                active={select.nav.active}
                setActive={select.nav.setActive}
                choose={select.choose}
            />
        </div>
    );
}
