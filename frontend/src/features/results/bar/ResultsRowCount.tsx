import Button from '../../../common/components/Button.tsx';
import * as t from '../../../common/tokens';
import type { CellValue } from '../../../../../shared/protocol/index.ts';
import type { RowCountState } from '../../../store/resultsRowCount.ts';

interface Props {
    rowCount: RowCountState | null;
    onReveal: () => void;
}

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
 * The results bar's click-to-reveal total, next to the row range. Its own
 * component rather than inline in `ResultsBarSummary` because it carries a
 * click handler and three render states, where the rest of the bar is plain
 * text.
 */
export default function ResultsRowCount({ rowCount, onReveal }: Props) {
    if (rowCount?.status === 'loaded' && rowCount.value !== null) {
        return <span data-testid="results-row-count">of {formatCount(rowCount.value)}</span>;
    }

    if (rowCount?.status === 'loading') {
        return <span data-testid="results-row-count-loading">of …</span>;
    }

    return (
        <Button
            variant="ghost"
            data-testid="results-row-count-reveal"
            style={{ height: 18, padding: '0 4px', fontSize: t.TEXT_BADGE, fontWeight: 400 }}
            onClick={onReveal}
            title="Count every row this table has"
        >
            {rowCount?.status === 'error' ? 'total? (retry)' : 'total?'}
        </Button>
    );
}
