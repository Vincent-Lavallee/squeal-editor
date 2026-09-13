import type { TableInfo } from '../../../../../shared/protocol/index.ts';
import * as t from '../../../common/tokens';

/**
 * Shown in place of a silent switch: "Export table" was chosen for one table
 * while another's export was still running, and the dialog below is still
 * that other one's -- only one export runs at a time, see
 * `useTableExportDialog`.
 */
export default function ExportConflictNotice({
    requestedTable,
    runningTable,
}: {
    requestedTable: TableInfo;
    runningTable: TableInfo;
}) {
    return (
        <div
            style={{
                padding: '9px 11px',
                borderRadius: t.RADIUS,
                border: `1px solid ${t.BORDER}`,
                fontSize: t.TEXT_BADGE,
                color: t.TEXT_MUTED,
            }}
        >
            {requestedTable.name} did not start — {runningTable.name} is still exporting.
        </div>
    );
}
