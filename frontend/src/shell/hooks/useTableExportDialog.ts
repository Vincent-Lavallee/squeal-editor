import { useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../common/db/relation.ts';
import type { ExportTarget } from '../../features/explorer/table-export/exportTarget.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { cleared, fetchExportTotal } from '../../store/tableExportSlice.ts';

const sameTarget = (a: ExportTarget, b: ExportTarget): boolean =>
    a.database === b.database &&
    relationName(relationOf(a.table)) === relationName(relationOf(b.table));

/**
 * Which table's "Export table" dialog is open, if any -- lifted out of the
 * sidebar (which opens it) because the status bar (its sibling under
 * `ShellLayout`, not a descendant) has to be able to reopen it after the
 * user minimizes it mid-export. The export's own progress lives in
 * `tableExportSlice` and outlives this regardless of whether the dialog is
 * mounted -- this hook only tracks which table it is for, and whether the
 * dialog is currently on screen.
 */
export function useTableExportDialog() {
    const dispatch = useAppDispatch();
    const busy = useAppSelector((s) => s.tableExport.busy);
    const [exporting, setExporting] = useState<ExportTarget | null>(null);
    const [exportDialogVisible, setExportDialogVisible] = useState(false);
    // Set when "Export table" is chosen for a different table while one is
    // already running -- `exporting` stays on the run in progress (see below),
    // so this is the only record of what the user actually clicked, for
    // `ExportTableDialog` to explain why it isn't showing that.
    const [blockedRequest, setBlockedRequest] = useState<ExportTarget | null>(null);

    function openExportDialog(table: TableInfo, database: string): void {
        const requested: ExportTarget = { table, database };
        // Only one export runs at a time (one slot in `tableExportSlice`), so a
        // second "Export table" while one is already running reopens the dialog
        // for whichever table that is, rather than losing track of it.
        if (!busy) {
            // A finished-but-not-yet-closed run's result/error/format would
            // otherwise bleed into this fresh dialog, which has not run anything
            // yet -- `reopenExportDialog` (the status bar's click) is the path
            // that is allowed to see it; a new "Export table" is not.
            dispatch(cleared());
            setExporting(requested);
            setBlockedRequest(null);
            void dispatch(fetchExportTotal({ database, table: table.name, schema: table.schema }));
        } else {
            setBlockedRequest(exporting && sameTarget(exporting, requested) ? null : requested);
        }
        setExportDialogVisible(true);
    }

    function minimizeExportDialog(): void {
        setBlockedRequest(null);
        setExportDialogVisible(false);
    }

    function reopenExportDialog(): void {
        setBlockedRequest(null);
        setExportDialogVisible(true);
    }

    function closeExportDialog(): void {
        setExporting(null);
        setBlockedRequest(null);
        setExportDialogVisible(false);
    }

    return {
        exporting,
        exportDialogVisible,
        blockedExportRequest: blockedRequest,
        openExportDialog,
        minimizeExportDialog,
        reopenExportDialog,
        closeExportDialog,
    };
}
