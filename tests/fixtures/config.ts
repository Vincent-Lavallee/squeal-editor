import { join } from 'node:path';

import type { ConnectionConfig } from '../../shared/protocol/index.ts';

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

/** The database the two server engines get seeded with. */
export const FIXTURE_DB = 'shop';

/**
 * Set by CI (docs/decisions.md: "CI provisions test databases without
 * Docker"), never locally: PG/MYSQL above are already listening as native
 * services, so anything that would otherwise `docker exec` into
 * PG_CONTAINER/MYSQL_CONTAINER has to reach them over the client CLIs instead.
 */
export const NATIVE_TEST_DB = process.env.SQUEAL_TEST_DB_NATIVE === '1';
