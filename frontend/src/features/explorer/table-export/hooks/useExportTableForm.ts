import { nanoid } from '@reduxjs/toolkit';
import { useState } from 'react';

import type { TableInfo } from '../../../../../../shared/protocol/index.ts';
import { relationOf } from '../../../../common/db/relation.ts';
import { useTableExport } from '../../../../store/tableExportSlice.ts';

/**
 * `ExportTableDialog`'s form state (format, the CREATE TABLE checkbox) and
 * its two actions -- split out purely for length.
 *
 * Dismissing the dialog means two different things depending on whether an
 * export is running: while `busy`, it minimizes (the export keeps going in
 * the background and the status bar takes over showing it -- see
 * `useTableExportDialog`); otherwise it is a real close, which also drops the
 * last run's result so opening a new export does not show a stale answer.
 */
export function useExportTableForm(
    table: TableInfo,
    database: string,
    onMinimize: () => void,
    onClose: () => void,
) {
    const tableExport = useTableExport();
    // Seeded from the slice, not a fresh default: reopening a minimized dialog
    // remounts this hook, and it has to show what is actually running rather
    // than resetting to "CSV" underneath a still-live SQL export.
    const [format, setFormat] = useState<'csv' | 'sql'>(tableExport.format ?? 'csv');
    const [includeCreateTable, setIncludeCreateTable] = useState(
        tableExport.format === null ? true : tableExport.includeCreateTable,
    );

    async function choose(): Promise<void> {
        const path = await Neutralino.os.showSaveDialog('Export table', {
            defaultPath: `${table.name}.${format}`,
            filters: [{ name: format.toUpperCase(), extensions: [format] }],
        });
        // Cancelling resolves with an empty string rather than rejecting.
        if (!path) return;
        tableExport.exportTo({
            ...relationOf(table),
            database,
            exportId: nanoid(),
            path,
            format,
            includeCreateTable,
        });
    }

    function dismiss(): void {
        if (tableExport.busy) {
            onMinimize();
            return;
        }
        tableExport.clear();
        onClose();
    }

    return {
        ...tableExport,
        format,
        setFormat,
        includeCreateTable,
        setIncludeCreateTable,
        // Once a run has started (or finished, or failed), the format and the
        // CREATE TABLE checkbox can no longer be changed -- see
        // `ExportTableDialog`'s static summary in their place.
        started: tableExport.busy || tableExport.result !== null || tableExport.error !== null,
        choose,
        dismiss,
    };
}
