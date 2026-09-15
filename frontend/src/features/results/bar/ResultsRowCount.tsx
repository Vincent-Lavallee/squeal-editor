import type { CSSProperties } from 'react';
import Button from '../../../common/components/Button.tsx';
import { RowCountIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import type { CellValue } from '../../../../../shared/protocol/index.ts';
import type { RowCountState } from '../../../store/resultsRowCount.ts';
import { iconSvg } from '../grid/resultsGridStyles.ts';

interface Props {
    rowCount: RowCountState | null;
    onReveal: () => void;
}

const countTextStyle: CSSProperties = { fontSize: t.TEXT_BADGE, fontWeight: 500 };

/**
 * Groups a count's digits with commas without ever parsing it into a JS
 * `Number` -- `COUNT(*)` is a database value like any other, and the rule
 * against rendering one through `Number` (see `docs/extension.md`, *Value
 * handling*) applies to it exactly as it does to a cell in the grid.
 */
function formatCount(value: CellValue): string {
    const text = String(value);
    if (!/^-?\d+$/.test(text)) return text;
    const negative = text.startsWith('-');
    const digits = negative ? text.slice(1) : text;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return negative ? `-${grouped}` : grouped;
}

/**
 * The results bar's click-to-reveal total, in the button row beside *Clear
 * filter* and the pager. Its own component rather than inline in `ResultsBar`
 * because it carries a click handler and three render states, where its
 * neighbours are each one.
 */
export default function ResultsRowCount({ rowCount, onReveal }: Props) {
    if (rowCount?.status === 'loaded' && rowCount.value !== null) {
        return (
            <span
                data-testid="results-row-count"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: t.GAP_XS,
                    ...countTextStyle,
                }}
            >
                <RowCountIcon style={iconSvg} aria-hidden="true" />
                {formatCount(rowCount.value)} rows
            </span>
        );
    }

    if (rowCount?.status === 'loading') {
        return (
            <span
                data-testid="results-row-count-loading"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: t.GAP_XS,
                    ...countTextStyle,
                }}
            >
                <RowCountIcon style={iconSvg} aria-hidden="true" />… rows
            </span>
        );
    }

    const isError = rowCount?.status === 'error';
    return (
        <Button
            variant="ghost"
            data-testid="results-row-count-reveal"
            style={{
                height: t.BUTTON_H_BAR,
                padding: '0 8px',
                ...(isError ? { color: t.RED_TEXT } : {}),
            }}
            onClick={onReveal}
            title="Count every row this table has"
        >
            <RowCountIcon style={iconSvg} aria-hidden="true" />
            {isError ? 'Load count (retry)' : 'Load count'}
        </Button>
    );
}
