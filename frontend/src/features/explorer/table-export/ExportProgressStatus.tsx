import type { CellValue } from '../../../../../shared/protocol/index.ts';
import { exportPercent } from '../../../store/tableExportProgress.ts';
import Button from '../../../common/components/Button.tsx';
import Callout from '../../../common/components/Callout.tsx';
import * as t from '../../../common/tokens';
import ExportProgressBar from './ExportProgressBar.tsx';

interface Props {
    busy: boolean;
    rowsWritten: number;
    /** The server's own `COUNT(*)` cell, printed verbatim -- never through a
     *  JS `Number`, the same rule every other database value follows. Only
     *  `exportPercent` reads it numerically, and only for the bar's width. */
    total: CellValue | null;
    error: string | null;
    result: { rowCount: number; cancelled: boolean } | null;
    onCancel: () => void;
}

/**
 * The progress bar and its readout while busy (with its Cancel button), the
 * error, and the finished summary -- split out of `ExportTableDialog` purely
 * for length.
 */
export default function ExportProgressStatus({
    busy,
    rowsWritten,
    total,
    error,
    result,
    onCancel,
}: Props) {
    const percent = exportPercent(rowsWritten, total);

    return (
        <>
            {busy && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_XS }}>
                    <ExportProgressBar percent={percent} />
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: t.TEXT_BODY,
                            color: t.TEXT_MUTED,
                        }}
                    >
                        <span>
                            {rowsWritten.toLocaleString()}
                            {total !== null ? ` of ${total} rows` : ' rows exported…'}
                            {percent !== null ? ` (${percent}%)` : ''}
                        </span>
                        <Button onClick={onCancel}>Cancel</Button>
                    </div>
                </div>
            )}
            {error && <Callout>{error}</Callout>}
            {result && (
                <Callout tone="success">
                    {result.cancelled
                        ? `Cancelled after ${result.rowCount.toLocaleString()} rows.`
                        : `Exported ${result.rowCount.toLocaleString()} rows.`}
                </Callout>
            )}
        </>
    );
}
