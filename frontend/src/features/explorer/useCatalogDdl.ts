import { useCallback } from 'react';

import type { FunctionInfo } from '../../../../shared/protocol/index.ts';
import type { Relation } from '../../common/db/relation.ts';
import { useAppDispatch } from '../../store/hooks.ts';
import {
    dropTable as dropTableThunk,
    fetchDdl as fetchDdlThunk,
    fetchFunctionDdl as fetchFunctionDdlThunk,
    fetchTriggerDdl as fetchTriggerDdlThunk,
} from '../../store/explorerSlice.ts';

/**
 * The context menu's bridge-crossing actions. Each returns the thunk's
 * unwrapped result, so the caller sees the DDL string or the rejection reason
 * directly -- a failed drop surfaces in the confirm modal, where it was asked.
 */
export function useCatalogDdl() {
    const dispatch = useAppDispatch();

    const fetchDdl = useCallback(
        (db: string, relation: Relation, kind: 'table' | 'view'): Promise<string> =>
            dispatch(fetchDdlThunk({ database: db, ...relation, kind }))
                .unwrap()
                .then((r) => r.ddl),
        [dispatch],
    );

    const fetchTriggerDdl = useCallback(
        (db: string, table: string, trigger: string, schema?: string): Promise<string> =>
            dispatch(fetchTriggerDdlThunk({ database: db, table, trigger, schema }))
                .unwrap()
                .then((r) => r.ddl),
        [dispatch],
    );

    const fetchFunctionDdl = useCallback(
        (db: string, func: FunctionInfo): Promise<string> =>
            dispatch(fetchFunctionDdlThunk({ database: db, func }))
                .unwrap()
                .then((r) => r.ddl),
        [dispatch],
    );
    const dropTable = useCallback(
        (db: string, relation: Relation, kind: 'table' | 'view'): Promise<unknown> =>
            dispatch(dropTableThunk({ database: db, ...relation, kind })).unwrap(),
        [dispatch],
    );

    return { fetchDdl, fetchTriggerDdl, fetchFunctionDdl, dropTable };
}
