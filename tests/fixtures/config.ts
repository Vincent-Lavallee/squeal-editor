import type { ConnectionConfig } from '../../shared/protocol.ts';

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

export const PG_CONTAINER = 'squeal-pg';
export const MYSQL_CONTAINER = 'squeal-mysql';

/** The database both engines get seeded with. */
export const FIXTURE_DB = 'shop';
