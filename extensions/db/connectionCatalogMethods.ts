import type { ConnectionConfig } from '../../shared/protocol/index.ts';
import type { Driver } from './drivers/index.ts';
import type { UseClient } from './connectionState.ts';
import type { ConnectionHandle } from './connectionTypes.ts';

export function connectionCatalogMethods<C>(
    use: UseClient<C>,
    driver: Driver<C>,
    config: ConnectionConfig,
): Pick<
    ConnectionHandle,
    | 'serverVersion'
    | 'listDatabases'
    | 'listTables'
    | 'listColumns'
    | 'listRelationships'
    | 'rowKey'
    | 'tableDdl'
    | 'listTriggers'
    | 'triggerDdl'
    | 'listFunctions'
    | 'functionDdl'
    | 'dropRelation'
> {
    return {
        async serverVersion() {
            return use(config.database, (client) => driver.serverVersion(client));
        },

        async listDatabases() {
            return use(config.database, (client) => driver.listDatabases(client));
        },

        async listTables(database, search) {
            return use(database, (client) => driver.listTables(client, database, search));
        },

        async listColumns(database, relation) {
            return use(database, (client) => driver.listColumns(client, database, relation));
        },

        async listRelationships(database) {
            return use(database, (client) => driver.listRelationships(client, database));
        },

        async rowKey(database, relation) {
            return use(database, (client) => driver.rowKey(client, database, relation));
        },

        async tableDdl(database, relation, kind) {
            return use(database, (client) => driver.tableDdl(client, relation, kind));
        },

        async listTriggers(database, relation) {
            return use(database, (client) => driver.listTriggers(client, database, relation));
        },

        async triggerDdl(database, relation, trigger) {
            return use(database, (client) =>
                driver.triggerDdl(client, database, relation, trigger),
            );
        },

        async listFunctions(database) {
            return use(database, (client) => driver.listFunctions(client, database));
        },

        async functionDdl(database, func) {
            return use(database, (client) => driver.functionDdl(client, database, func));
        },

        async dropRelation(database, relation, kind) {
            await use(database, (client) => driver.dropRelation(client, relation, kind));
        },
    };
}
