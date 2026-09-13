import type { CellValue } from '../../../../../shared/protocol/index.ts';
import * as t from '../../../common/tokens';

/**
 * The table's whole row count, fetched before the export starts (`db.count`,
 * no filter -- the same command the results bar's click-to-reveal total
 * already calls) so the dialog states a total before committing to anything,
 * and so the progress bar below has a denominator once one starts. Printed
 * verbatim, the same rule every other database value follows.
 */
export default function ExportTotalLine({
    total,
    totalStatus,
}: {
    total: CellValue | null;
    totalStatus: 'idle' | 'loading' | 'loaded' | 'error';
}) {
    if (totalStatus === 'loading') {
        return <div style={{ fontSize: t.TEXT_BODY, color: t.TEXT_FAINT }}>Counting rows…</div>;
    }
    if (totalStatus === 'loaded' && total !== null) {
        return <div style={{ fontSize: t.TEXT_BODY, color: t.TEXT_MUTED }}>{total} rows total</div>;
    }
    return null;
}
