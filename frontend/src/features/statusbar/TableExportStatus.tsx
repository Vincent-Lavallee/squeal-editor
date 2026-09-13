import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { exportPercent } from '../../store/tableExportProgress.ts';
import { useTableExport } from '../../store/tableExportSlice.ts';
import * as t from '../../common/tokens';
import BusyDot from './BusyDot.tsx';

function exportLabel(table: TableInfo, s: ReturnType<typeof useTableExport>): string {
    if (s.busy) {
        const percent = exportPercent(s.rowsWritten, s.total);
        return `Exporting ${table.name}… ${percent !== null ? `${percent}%` : `${s.rowsWritten.toLocaleString()} rows`}`;
    }
    if (s.result) {
        return s.result.cancelled
            ? `${table.name} export cancelled`
            : `${table.name} exported (${s.result.rowCount.toLocaleString()} rows)`;
    }
    if (s.error) return `${table.name} export failed`;
    return `Exporting ${table.name}`;
}

/**
 * "Export table", once it has been minimized -- a fact about the
 * connection the way the read-only lock and the environment badge are, so it
 * lives here rather than only inside the dialog that started it. See
 * `AssistantStatus` for the same reasoning, and `useTableExportDialog` for
 * why the dialog's own open/closed state cannot own this instead.
 */
export default function TableExportStatus({
    table,
    onReopen,
}: {
    table: TableInfo;
    onReopen: () => void;
}) {
    const exportState = useTableExport();

    return (
        <button
            type="button"
            data-testid="statusbar-export"
            onClick={onReopen}
            title="Click to reopen the export"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                height: '100%',
                padding: `0 ${t.GAP}px`,
                border: 'none',
                borderLeft: `1px solid ${t.BORDER}`,
                background: 'none',
                color: t.TEXT_MUTED,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                cursor: 'pointer',
            }}
        >
            {exportState.busy && <BusyDot />}
            {exportLabel(table, exportState)}
        </button>
    );
}
