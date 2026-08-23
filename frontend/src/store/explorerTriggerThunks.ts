import type { FunctionInfo } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { triggersRequested, functionsRequested } from './explorerSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/** Argument for loading triggers for a specific table. */
interface TriggersArg {
    database: string;
    table: string;
    schema?: string;
}

/**
 * Fetch triggers for a table. Like columns, this is called on-demand when a table
 * is expanded to show nested triggers.
 */
export const loadTriggers = createAppThunk(
    'explorer/loadTriggers',
    async ({ database, table, schema }: TriggersArg, { getState, dispatch, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');

        dispatch(triggersRequested({ connectionId, database, table }));

        try {
            const res = await call('db.triggers', { connectionId, database, table, schema });
            return { connectionId, database, table, triggers: res.triggers };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
    {
        condition: ({ database, table }, { getState }) => {
            if (!getState().session.activeConnectionId) return false;
            const connectionId = getState().session.activeConnectionId!;
            return getState().explorer.triggers[connectionId]?.[database]?.[table] === undefined;
        },
    },
);

/** Argument for loading functions for a database. */
interface FunctionsArg {
    database: string;
}

/**
 * Fetch functions and procedures for a database. Called once when the database is
 * selected, similar to how tables are fetched.
 */
export const loadFunctions = createAppThunk(
    'explorer/loadFunctions',
    async ({ database }: FunctionsArg, { getState, dispatch, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');

        dispatch(functionsRequested({ connectionId, database }));

        try {
            const res = await call('db.functions', { connectionId, database });
            return { connectionId, database, functions: res.functions };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
    {
        condition: ({ database }, { getState }) => {
            if (!getState().session.activeConnectionId) return false;
            const connectionId = getState().session.activeConnectionId!;
            return getState().explorer.functions[connectionId]?.[database] === undefined;
        },
    },
);

/**
 * Every table of a database with its columns and foreign keys, for the diagram.
 *
 * **Deliberately uncached, unlike every other list in this slice.** The tree's
 * tables are fetched on every database switch, so a `condition` is what keeps
 * that off the bridge; the diagram is opened by hand and rarely, and it is
 * *about* the shape of the schema right now. A cached answer would draw a
 * foreign key added since as missing, and every way of asking again -- the
 * toolbar's refresh, Ctrl+R, reopening the tab -- comes back through here.
 *
 * It returns the unwrapped result rather than a slice flag for the wait, the
 * call `refreshDatabases` already makes: the diagram is one component that
 * opens, fetches once and closes, so its spinner and its error live and die
 * with it. The tables themselves land here because they crossed the bridge.
 */
export const loadRelationships = createAppThunk(
    'explorer/loadRelationships',
    async ({ database }: FunctionsArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            const { tables } = await call('db.relationships', { connectionId, database });
            return { connectionId, database, tables };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/** Argument for fetching a trigger's DDL. */
interface TriggerDdlArg {
    database: string;
    table: string;
    trigger: string;
    schema?: string;
}

/**
 * Fetch a trigger's CREATE statement for "open definition".
 */
export const fetchTriggerDdl = createAppThunk(
    'explorer/fetchTriggerDdl',
    async ({ database, table, trigger, schema }: TriggerDdlArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            const { ddl } = await call('db.triggerDdl', {
                connectionId,
                database,
                table,
                trigger,
                schema,
            });
            return { ddl };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Argument for fetching a function's DDL: the whole tree row, because an
 * overload is not addressable by name -- see `FunctionInfo`.
 */
interface FunctionDdlArg {
    database: string;
    func: FunctionInfo;
}

/**
 * Fetch a function or procedure's CREATE statement for "open definition".
 */
export const fetchFunctionDdl = createAppThunk(
    'explorer/fetchFunctionDdl',
    async ({ database, func }: FunctionDdlArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            const { ddl } = await call('db.functionDdl', { connectionId, database, func });
            return { ddl };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);
