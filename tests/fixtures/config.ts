import { join } from 'node:path';

import type { ConnectionConfig } from '../../shared/protocol/index.ts';

/**
 * Set by CI (docs/decisions.md: "CI provisions test databases without
 * Docker"), never locally: PG/MYSQL/MSSQL below are already listening as
 * native services, so anything that would otherwise `docker exec` into a
 * container has to reach them over the client CLIs instead. Declared first so
 * `MSSQL`'s port below can read it -- a `const` is not visible to another
 * declared above it in the same module.
 */
export const NATIVE_TEST_DB = process.env.SQUEAL_TEST_DB_NATIVE === '1';

/**
 * Throwaway servers on non-default ports so they cannot collide with anything
 * real you have running. Managed by `bun run test:db:up` / `:down`.
 */
export const PG: ConnectionConfig = {
    type: 'postgres',
    host: '127.0.0.1',
    port: 55432,
    user: 'postgres',
    password: 'secret',
    database: 'postgres',
};

export const MYSQL: ConnectionConfig = {
    type: 'mysql',
    host: '127.0.0.1',
    port: 53306,
    user: 'root',
    password: 'secret',
};

// A separate server, not a second config pointed at MYSQL's port: the point of
// having it at all is a real MariaDB binary answering the same driver, so a
// shared container would test nothing `mysql` doesn't already.
export const MARIADB: ConnectionConfig = {
    type: 'mariadb',
    host: '127.0.0.1',
    port: 53316,
    user: 'root',
    password: 'secret',
};

// SQL Server's `sa` account enforces a complexity policy the other two
// engines' throwaway passwords don't have to meet -- three of uppercase,
// lowercase, digit and symbol, and long enough that a real one won't
// accidentally satisfy it by luck.
//
// The port is the one exception to "always the non-default port": the CI
// action that provisions it natively (`potatoqualitee/mssqlsuite`) has no
// documented port override the way `action-setup-postgres`/`actions-setup-
// mysql` do, so native mode is left on SQL Server's real default (1433)
// rather than guessing at a flag that may not exist. Local Docker still uses
// 51433, the same non-collision reasoning as the other two.
export const MSSQL: ConnectionConfig = {
    type: 'mssql',
    host: '127.0.0.1',
    port: NATIVE_TEST_DB ? 1433 : 51433,
    user: 'sa',
    password: 'Squeal_Test_Pw!1',
};

/**
 * The SQLite fixture is a file rather than a container, so it needs no Docker --
 * but it is still seeded by `test:db:up` along with the other two, so one
 * command puts every engine's fixture in place.
 *
 * The path is absolute because the extension is a separate process with its own
 * working directory, and it is the *whole* address: a file engine writes no
 * host, port or user, and carries its path in `database`. See `ServerConfig`.
 */
export const SQLITE_FILE = join(import.meta.dir, 'shop.db');

export const SQLITE: ConnectionConfig = {
    type: 'sqlite',
    host: '',
    port: 0,
    user: '',
    password: '',
    database: SQLITE_FILE,
};

export const PG_CONTAINER = 'squeal-pg';
export const MYSQL_CONTAINER = 'squeal-mysql';
export const MARIADB_CONTAINER = 'squeal-mariadb';
export const MSSQL_CONTAINER = 'squeal-mssql';

/** The database the two server engines get seeded with. */
export const FIXTURE_DB = 'shop';
