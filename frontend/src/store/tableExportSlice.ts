import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { CellValue, ExportProgress } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * "Export a table": streaming a whole table to a file the extension writes.
 * A slice for the reason `transferSlice` is one -- the file itself never
 * comes back over the bridge, only a path went out and a result comes back --
 * plus a `rowsWritten` counter that arrives separately, on the broadcast, the
 * same split `updaterSlice`'s download progress draws.
 */
export interface TableExportArg {
    database: string;
    table: string;
    schema?: string;
    exportId: string;
    path: string;
    format: 'csv' | 'sql';
    includeCreateTable: boolean;
}

interface TableExportState {
    busy: boolean;
    exportId: string | null;
    rowsWritten: number;
    result: { rowCount: number; cancelled: boolean } | null;
    error: string | null;
    /**
     * `db.count` on the table, asked before the export starts so the dialog
     * (and the status bar's progress %) has a denominator. The server's own
     * cell, carried exactly as it crossed the bridge -- see `total` below.
     */
    total: CellValue | null;
    totalStatus: 'idle' | 'loading' | 'loaded' | 'error';
    /**
     * What the running (or last-run) export was actually asked for. Kept here
     * rather than only in the dialog's own local state, because minimizing the
     * dialog unmounts it -- reopening it has to show what is really running,
     * not a fresh component's defaults.
     */
    format: 'csv' | 'sql' | null;
    includeCreateTable: boolean;
}

const initialState: TableExportState = {
    busy: false,
    exportId: null,
    rowsWritten: 0,
    result: null,
    error: null,
    total: null,
    totalStatus: 'idle',
    format: null,
    includeCreateTable: false,
};

export const exportTable = createAppThunk(
    'tableExport/export',
    async (arg: TableExportArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            // No timeout: a large table can run for minutes, and `rowsWritten`
            // arrives separately on `EXPORT_PROGRESS_EVENT` in the meantime.
            return await call('db.export', { connectionId, ...arg }, Infinity);
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * The table's whole row count, fetched once before an export starts --
 * `db.count` with no filter, the same command the results bar's
 * click-to-reveal total already calls. `total` is shown verbatim, like every
 * other database value; only `exportPercent` (`tableExportProgress.ts`) ever
 * converts it through a JS `Number`, and only to size a progress bar.
 */
export const fetchExportTotal = createAppThunk(
    'tableExport/fetchTotal',
    async (
        arg: { database: string; table: string; schema?: string },
        { getState, rejectWithValue },
    ) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            return await call('db.count', { connectionId, ...arg });
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Fire-and-forget, the same shape `ai.cancel`'s caller uses: the running
 * export's own reply (`exportTable.fulfilled`'s `cancelled` field) is how the
 * caller learns the stop actually landed, not this call's own resolution.
 */
export function cancelTableExport(exportId: string): void {
    void call('db.exportCancel', { exportId });
}

const tableExportSlice = createSlice({
    name: 'tableExport',
    initialState,
    reducers: {
        cleared: () => initialState,
        progressReceived(state, action: PayloadAction<ExportProgress>) {
            if (state.exportId !== action.payload.exportId) return;
            state.rowsWritten = action.payload.rowsWritten;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(exportTable.pending, (state, action) => {
                state.busy = true;
                state.exportId = action.meta.arg.exportId;
                state.rowsWritten = 0;
                state.result = null;
                state.error = null;
                state.format = action.meta.arg.format;
                state.includeCreateTable = action.meta.arg.includeCreateTable;
            })
            .addCase(exportTable.fulfilled, (state, action) => {
                state.busy = false;
                state.result = action.payload;
            })
            .addCase(exportTable.rejected, (state, action) => {
                state.busy = false;
                state.error = action.payload ?? 'Could not export that table.';
            })

            .addCase(fetchExportTotal.pending, (state) => {
                state.totalStatus = 'loading';
                state.total = null;
            })
            .addCase(fetchExportTotal.fulfilled, (state, action) => {
                state.totalStatus = 'loaded';
                state.total = action.payload.count;
            })
            .addCase(fetchExportTotal.rejected, (state) => {
                state.totalStatus = 'error';
            });
    },
});

export const { cleared, progressReceived } = tableExportSlice.actions;
export const tableExportReducer = tableExportSlice.reducer;

export function useTableExport() {
    const dispatch = useAppDispatch();
    const {
        busy,
        exportId,
        rowsWritten,
        result,
        error,
        total,
        totalStatus,
        format,
        includeCreateTable,
    } = useAppSelector((s) => s.tableExport);

    return {
        busy,
        exportId,
        rowsWritten,
        result,
        error,
        total,
        totalStatus,
        format,
        includeCreateTable,
        exportTo: useCallback((arg: TableExportArg) => void dispatch(exportTable(arg)), [dispatch]),
        cancel: useCallback((id: string) => cancelTableExport(id), []),
        /** Dropped when the dialog closes for good, so opening a new export does
         *  not show the last run's answer. */
        clear: useCallback(() => dispatch(cleared()), [dispatch]),
    };
}
