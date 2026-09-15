import type { CSSProperties, RefObject } from 'react';
import Checkbox from '../../../common/components/Checkbox.tsx';
import * as t from '../../../common/tokens';
import type { HiddenColumns } from '../ResultsContext.tsx';

const popupStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 260,
    overflowY: 'auto',
    padding: t.GAP_XS,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
};

interface Props {
    popupRef: RefObject<HTMLDivElement>;
    style: CSSProperties;
    allColumns: string[];
    hiddenColumns: HiddenColumns;
    onToggleColumn: (column: string) => void;
}

/**
 * The results bar's "Columns" button pops this open: every column the tab
 * has, checked when it is showing, so a column with no header left to
 * right-click still has a way back. Its own file rather than folded into the
 * button beside it, the way `SelectPopup` sits apart from `SelectTrigger`.
 */
export default function ColumnVisibilityList({
    popupRef,
    style,
    allColumns,
    hiddenColumns,
    onToggleColumn,
}: Props) {
    return (
        <div
            ref={popupRef}
            data-testid="grid-columns-popup"
            role="menu"
            aria-label="Show or hide columns"
            style={{ ...popupStyle, ...style }}
        >
            {allColumns.map((column) => (
                <Checkbox
                    key={column}
                    label={column}
                    checked={!hiddenColumns.has(column)}
                    onChange={() => onToggleColumn(column)}
                />
            ))}
        </div>
    );
}
