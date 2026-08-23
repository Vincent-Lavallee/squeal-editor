import { useCallback } from 'react';

import type { ColumnInfo, FunctionInfo, TriggerInfo } from '../../../../shared/protocol/index.ts';
import { relationName, type Relation } from '../../common/db/relation.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { loadColumns, loadTriggers } from '../../store/explorerSlice.ts';

/**
 * Readers and lazy loaders over the columns, triggers and functions caches --
 * the tree expands a row into exactly what these already hold, or asks for it.
 */
export function useRelationCache(connectionId: string | null) {
    const dispatch = useAppDispatch();
    const { columns, triggers, functions } = useAppSelector((s) => s.explorer);

    /*
     * The tree fetches a table's columns the same way the completion does -- the
     * same thunk, the same cache -- so expanding a row the editor has already
     * completed against costs nothing. `loadColumns`' condition dedupes, so the
     * caller may ask on every expand without guarding it here.
     *
     * `undefined` means never asked, `null` means asked (in flight, or failed),
     * and an array is the answer -- the same three states the cache holds, passed
     * straight through so the tree can tell "loading" from "empty".
     */
    const columnsFor = useCallback(
        (db: string, relation: Relation): ColumnInfo[] | null | undefined =>
            connectionId ? columns[connectionId]?.[db]?.[relationName(relation)] : undefined,
        [columns, connectionId],
    );
    const loadTableColumns = useCallback(
        (db: string, relation: Relation) => {
            void dispatch(loadColumns({ database: db, ...relation }));
        },
        [dispatch],
    );

    // Triggers for a table, with lazy loading when the table is expanded
    const triggersFor = useCallback(
        (db: string, table: string): TriggerInfo[] | null | undefined =>
            connectionId ? triggers[connectionId]?.[db]?.[table] : undefined,
        [connectionId, triggers],
    );

    const loadTableTriggers = useCallback(
        (db: string, table: string, schema?: string) => {
            void dispatch(loadTriggers({ database: db, table, schema }));
        },
        [dispatch],
    );

    // Functions for a database
    const functionsFor = useCallback(
        (db: string): FunctionInfo[] | null | undefined =>
            connectionId ? functions[connectionId]?.[db] : undefined,
        [connectionId, functions],
    );

    return { columnsFor, loadTableColumns, triggersFor, loadTableTriggers, functionsFor };
}
