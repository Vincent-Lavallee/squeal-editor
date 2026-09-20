import { useState } from 'react';
import Button from '../../../common/components/Button.tsx';
import { useSelectPopupPosition } from '../../../common/components/hooks/useSelectPopupPosition.ts';
import Tooltip from '../../../common/components/Tooltip.tsx';
import { ViewIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import type { HiddenColumns } from '../ResultsContext.tsx';
import { iconSvg } from '../grid/resultsGridStyles.ts';
import ColumnVisibilityList from './ColumnVisibilityList.tsx';

const noop = () => {};

interface Props {
    allColumns: string[];
    hiddenColumns: HiddenColumns;
    onToggleColumn: (column: string) => void;
}

/**
 * The results bar's way to a column that hiding took its header away from --
 * `useSelectPopupPosition` is `Select`'s own placement-and-dismissal hook,
 * reused as-is: this needs the exact same "anchored below the trigger,
 * clamped to the viewport, closed by an outside click/scroll/resize" it
 * already gives the database picker, just around a checkbox list instead of
 * an option list.
 */
export default function ResultsColumnsButton({ allColumns, hiddenColumns, onToggleColumn }: Props) {
    const [open, setOpen] = useState(false);
    const { trigger, popup, pos } = useSelectPopupPosition({
        open,
        caretOnly: false,
        align: 'end',
        shownLength: allColumns.length,
        setOpen,
        setQuery: noop,
    });

    return (
        <>
            <div ref={trigger} style={{ display: 'inline-flex' }}>
                <Tooltip
                    disabled={open}
                    label={
                        hiddenColumns.size > 0
                            ? `Show or hide columns (${hiddenColumns.size} hidden)`
                            : 'Show or hide columns'
                    }
                >
                    <Button
                        variant="ghost"
                        data-testid="grid-columns-button"
                        style={{
                            justifyContent: 'center',
                            flex: 'none',
                            width: t.BUTTON_H_BAR,
                            height: t.BUTTON_H_BAR,
                            padding: 0,
                            ...(hiddenColumns.size > 0 ? { color: t.ACCENT } : {}),
                        }}
                        onClick={() => setOpen((o) => !o)}
                        aria-label="Show or hide columns"
                    >
                        <ViewIcon style={iconSvg} aria-hidden="true" />
                    </Button>
                </Tooltip>
            </div>
            {open && (
                <ColumnVisibilityList
                    popupRef={popup}
                    style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
                    allColumns={allColumns}
                    hiddenColumns={hiddenColumns}
                    onToggleColumn={onToggleColumn}
                />
            )}
        </>
    );
}
