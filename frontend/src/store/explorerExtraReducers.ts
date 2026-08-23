import type { ActionReducerMapBuilder } from '@reduxjs/toolkit';

import type { TableInfo } from '../../../shared/protocol/index.ts';
import { relationName, type Relation } from '../common/db/relation.ts';
import { disconnect, sessionOpened } from './sessionSlice.ts';
import type { ExplorerState } from './explorerSlice.ts';
import { sameRequest } from './explorerSlice.ts';
import { loadColumns, loadDatabases, loadTables } from './explorerCatalogThunks.ts';
import { dropTable, loadStars, setStar } from './explorerRelationThunks.ts';
import { loadFunctions, loadRelationships, loadTriggers } from './explorerTriggerThunks.ts';

export function buildExplorerCatalogReducers(
    builder: ActionReducerMapBuilder<ExplorerState>,
): void {
    builder
        .addCase(disconnect.fulfilled, (state, action) => {
            const { connectionId } = action.payload;
            // Only this connection's catalog. Everything here names its connection,
            // so there is exactly one key to drop per map and the other servers'
            // trees are untouched.
            delete state.databases[connectionId];
            delete state.tables[connectionId];
            delete state.columns[connectionId];
            delete state.stars[connectionId];
            delete state.triggers[connectionId];
            delete state.functions[connectionId];
            delete state.relationships[connectionId];
            if (state.tableSearch?.connectionId === connectionId) state.tableSearch = null;
            if (state.loadingTables?.connectionId === connectionId) state.loadingTables = null;
            if (state.error?.connectionId === connectionId) state.error = null;
        })
        .addCase(loadTables.fulfilled, (state, action) => {
            const { connectionId, database, search, tables, truncated } = action.payload;
            // A disconnect that landed first dropped the connection; writing here
            // anyway would resurrect it with nothing left to ever collect it -- the
            // guard `loadStars` and `loadRelationships` already make.
            if (!(connectionId in state.databases)) return;
            // A search answers the slot, never the cache: see `tables` above for
            // what reads the unsearched listing and why it must not move.
            if (search === '')
                (state.tables[connectionId] ??= {})[database] = { tables, truncated };
            else state.tableSearch = action.payload;
            if (sameRequest(state.loadingTables, action.payload)) state.loadingTables = null;
        })
        .addCase(loadDatabases.fulfilled, (state, action) => {
            const { connectionId, databases } = action.payload;
            state.databases[connectionId] = databases;
        })
        // `loadTables.rejected` is deliberately not handled: `tablesFailed`
        // carried the failure, with the connection in it, which is the one thing
        // `rejected` cannot see.
        .addCase(loadColumns.fulfilled, (state, action) => {
            const { connectionId, database, table, columns } = action.payload;
            // Find the marker `columnsRequested` left, or no-op. A disconnect that
            // lands while this is in flight drops the map, and writing here anyway
            // would resurrect a connection that is gone -- with nothing left to
            // collect it, since only a disconnect ever clears this. Same guard, and
            // the same reason for it, as a query landing after its tab closed.
            const byTable = state.columns[connectionId]?.[database];
            if (!byTable || byTable[table] === undefined) return;
            byTable[table] = columns;
        });
    // `loadColumns.rejected` is deliberately not handled. The `null` the
    // request left behind stays exactly where it is, which is what says "asked
    // once, and it did not answer" -- handling it to clear the marker would
    // put the retry back on every keystroke.
}

export function buildExplorerDropAndStarReducers(
    builder: ActionReducerMapBuilder<ExplorerState>,
): void {
    builder
        .addCase(dropTable.fulfilled, (state, action) => {
            const { connectionId, database, table, schema } = action.payload;
            // Drop the one relation from both caches. The tables array may not be
            // fetched (the menu can drop from a tree that was never expanded past its
            // list) -- only touch what is there, and never resurrect a connection a
            // disconnect cleared while the drop was in flight.
            //
            // Matched on both halves: two schemas may each hold a table of the same
            // name, and dropping one of them must not take the other out of the tree.
            //
            // The search's own rows are dropped from too, and they have to be: a
            // drop from a searched tree is the case where the row on screen is the
            // slot's rather than the cache's, so forgetting only the cache would
            // leave the table you just dropped sitting there.
            const dropped = (t: TableInfo) => t.name === table && t.schema === schema;
            const listing = state.tables[connectionId]?.[database];
            if (listing) listing.tables = listing.tables.filter((t) => !dropped(t));
            if (
                state.tableSearch?.connectionId === connectionId &&
                state.tableSearch.database === database
            ) {
                state.tableSearch.tables = state.tableSearch.tables.filter((t) => !dropped(t));
            }
            const key = relationName({ table, schema });
            const byTable = state.columns[connectionId]?.[database];
            if (byTable) delete byTable[key];
            /*
             * And its star, which used to look after itself: the pinned group was
             * built by picking the starred rows out of the listing, so a star whose
             * table had gone simply matched nothing. The group is built from the
             * stars now (see `stars` above), so a star left behind here is a row
             * pointing at a table this app has just dropped.
             *
             * Only the cache. The store keeps the row until the next `db.stars.set`,
             * and it costs nothing there -- nothing reads a star for a table that
             * does not exist, and a drop is not the moment to fire a write that
             * could fail on its own.
             */
            const starred = state.stars[connectionId]?.[database];
            if (starred) delete starred[key];
        })
        .addCase(loadStars.fulfilled, (state, action) => {
            const { connectionId, stars } = action.payload;
            // A disconnect that lands first drops the connection outright; writing
            // here anyway would resurrect it with nothing left to ever collect it.
            if (!(connectionId in state.databases)) return;
            const byDatabase: Record<string, Record<string, Relation>> = {};
            for (const s of stars) {
                const relation = { table: s.table, schema: s.schema };
                (byDatabase[s.database] ??= {})[relationName(relation)] = relation;
            }
            state.stars[connectionId] = byDatabase;
        })
        .addCase(setStar.fulfilled, (state, action) => {
            const { connectionId, database, table, schema, starred } = action.payload;
            const byDatabase = (state.stars[connectionId] ??= {});
            const byTable = (byDatabase[database] ??= {});
            const key = relationName({ table, schema });
            if (starred) byTable[key] = { table, schema };
            else delete byTable[key];
        });
}

export function buildExplorerTriggerFunctionReducers(
    builder: ActionReducerMapBuilder<ExplorerState>,
): void {
    builder
        .addCase(loadTriggers.fulfilled, (state, action) => {
            const { connectionId, database, table, triggers } = action.payload;
            const byTable = state.triggers[connectionId]?.[database];
            if (!byTable || byTable[table] === undefined) return;
            byTable[table] = triggers;
        })
        .addCase(loadFunctions.fulfilled, (state, action) => {
            const { connectionId, database, functions } = action.payload;
            const byDatabase = state.functions[connectionId];
            if (!byDatabase || byDatabase[database] === undefined) return;
            byDatabase[database] = functions;
        })
        .addCase(loadRelationships.fulfilled, (state, action) => {
            const { connectionId, database, tables } = action.payload;
            // A disconnect that landed first dropped the connection; writing here
            // anyway would resurrect it with nothing left to ever collect it. There
            // is no requested-marker to look for, because this one is never cached.
            if (!(connectionId in state.databases)) return;
            (state.relationships[connectionId] ??= {})[database] = tables;
        })
        //
        // The database list arrives with the connection itself, so the explorer
        // reads it off the session's event rather than fetching it again. Matching
        // the event and not a thunk is what keeps this working when a new way to
        // connect appears; addMatcher must follow every addCase.
        .addMatcher(sessionOpened, (state, action) => {
            const { connectionId, databases } = action.payload;
            state.databases[connectionId] = databases;
            // Nothing is cleared. `tables` names its connection now, so a new
            // connection's `app` cannot read an older one's -- which is exactly what
            // this used to have to empty the whole cache to prevent.
        });
}
