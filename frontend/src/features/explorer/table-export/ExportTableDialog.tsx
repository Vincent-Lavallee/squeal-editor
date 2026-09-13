import type { TableInfo } from '../../../../../shared/protocol/index.ts';
import Button from '../../../common/components/Button.tsx';
import Modal from '../../../common/components/Modal.tsx';
import * as t from '../../../common/tokens';
import ExportConflictNotice from './ExportConflictNotice.tsx';
import ExportFormatField from './ExportFormatField.tsx';
import ExportProgressStatus from './ExportProgressStatus.tsx';
import ExportTotalLine from './ExportTotalLine.tsx';
import { useExportTableForm } from './hooks/useExportTableForm.ts';

interface Props {
    table: TableInfo;
    database: string;
    /** While busy: hide the dialog, but leave the export running -- see
     *  `useTableExportDialog`. The status bar takes over showing it. */
    onMinimize: () => void;
    /** Otherwise: a real close, dropping the last run's result. */
    onClose: () => void;
    /** Set when this dialog is showing a different table's export than the
     *  one just clicked -- see `useTableExportDialog`'s `blockedExportRequest`. */
    blockedRequest?: TableInfo;
}

/**
 * The tree's "Export table": stream every row to a file, as CSV or as SQL
 * `INSERT` statements, paged from the server.
 *
 * The save dialog is the OS's and the rows are the extension's, the same
 * split `db.saved.export` already makes for the connections file -- see
 * `db.export`.
 */
export default function ExportTableDialog({
    table,
    database,
    onMinimize,
    onClose,
    blockedRequest,
}: Props) {
    const s = useExportTableForm(table, database, onMinimize, onClose);

    return (
        <Modal onClose={s.dismiss}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                    Export {table.name}
                </h2>
                {blockedRequest && (
                    <ExportConflictNotice requestedTable={blockedRequest} runningTable={table} />
                )}
                <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY }}>
                    Streams every row to a file you choose, paged from the server.
                </p>
                <ExportTotalLine total={s.total} totalStatus={s.totalStatus} />

                <ExportFormatField
                    started={s.started}
                    format={s.format}
                    onSelectFormat={s.setFormat}
                    includeCreateTable={s.includeCreateTable}
                    onToggleCreateTable={s.setIncludeCreateTable}
                />

                <ExportProgressStatus
                    busy={s.busy}
                    rowsWritten={s.rowsWritten}
                    total={s.total}
                    error={s.error}
                    result={s.result}
                    onCancel={() => s.exportId && s.cancel(s.exportId)}
                />

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: t.GAP_SM,
                        marginTop: t.GAP_XS,
                    }}
                >
                    <Button onClick={s.dismiss}>{s.busy ? 'Minimize' : 'Close'}</Button>
                    {!s.started && (
                        <Button variant="primary" onClick={() => void s.choose()}>
                            Choose a file…
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
