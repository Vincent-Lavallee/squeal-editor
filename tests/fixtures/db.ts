/**
 * Throwaway MySQL + Postgres for the test suite.
 *
 *   bun run test:db:up     start and seed
 *   bun run test:db:down   remove
 *
 * The seed deliberately contains the values that have caused real bugs: a BIGINT
 * past 2^53, a timezone-less DATETIME, NULLs, a BLOB, JSON, a view, and (on
 * Postgres) a table outside the public schema.
 *
 * `events` is sized for paging: 150 rows is more than one 100-row page, and it
 * makes the case that broke the old row-count guess reachable without a second
 * table -- page from row 51 and a *full* page comes back with nothing after it.
 */

import { $ } from 'bun';
import { MYSQL_CONTAINER, PG_CONTAINER } from './config.ts';

const PG_SEED = `
CREATE TABLE users (
  id serial primary key,
  name text,
  email text,
  created_at timestamptz default now(),
  meta jsonb,
  avatar bytea
);
INSERT INTO users (name, email, meta, avatar) VALUES
  ('Ada', 'ada@x.io', '{"role":"admin"}', '\\x0102ff'),
  ('Grace', NULL, NULL, NULL);
CREATE VIEW active_users AS SELECT id, name FROM users;
CREATE SCHEMA reporting;
CREATE TABLE reporting.daily_stats (day date, hits bigint);
INSERT INTO reporting.daily_stats VALUES ('2026-01-05', 9007199254740993);
CREATE TABLE events (id serial primary key, label text);
INSERT INTO events (label) SELECT 'e' || g FROM generate_series(1, 150) g;
`;

const MYSQL_SEED = `
CREATE DATABASE shop;
USE shop;
CREATE TABLE users (
  id int auto_increment primary key,
  name varchar(50),
  email varchar(50),
  created_at datetime default current_timestamp,
  meta json,
  avatar blob,
  big bigint
);
INSERT INTO users (name, email, meta, avatar, big) VALUES
  ('Ada', 'ada@x.io', '{"role":"admin"}', UNHEX('0102FF'), 9007199254740993),
  ('Grace', NULL, NULL, NULL, NULL);
CREATE VIEW active_users AS SELECT id, name FROM users;
CREATE TABLE events (id int auto_increment primary key, label varchar(20));
INSERT INTO events (label)
WITH RECURSIVE series AS (
  SELECT 1 AS n UNION ALL SELECT n + 1 FROM series WHERE n < 150
)
SELECT CONCAT('e', n) FROM series;
`;

async function waitFor(label: string, probe: () => Promise<boolean>, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await probe().catch(() => false)) return;
    await Bun.sleep(2000);
  }
  throw new Error(`${label} never became ready`);
}

export async function up(): Promise<void> {
  await $`docker run -d --name ${PG_CONTAINER} -e POSTGRES_PASSWORD=secret -p 55432:5432 postgres:16-alpine`.quiet().nothrow();
  await $`docker run -d --name ${MYSQL_CONTAINER} -e MYSQL_ROOT_PASSWORD=secret -p 53306:3306 mysql:8`.quiet().nothrow();

  await waitFor('postgres', async () => {
    const r = await $`docker exec ${PG_CONTAINER} pg_isready -U postgres`.quiet().nothrow();
    return r.exitCode === 0;
  });
  await waitFor('mysql', async () => {
    const r = await $`docker exec ${MYSQL_CONTAINER} mysqladmin ping -uroot -psecret`.quiet().nothrow();
    return r.exitCode === 0 && r.stdout.toString().includes('alive');
  });

  // Seeding is idempotent-ish: drop first so `up` twice is harmless.
  await $`docker exec ${PG_CONTAINER} psql -U postgres -c ${'DROP DATABASE IF EXISTS shop'}`.quiet().nothrow();
  await $`docker exec ${PG_CONTAINER} psql -U postgres -c ${'CREATE DATABASE shop'}`.quiet().nothrow();
  await $`docker exec ${PG_CONTAINER} psql -U postgres -d shop -c ${PG_SEED}`.quiet().nothrow();

  await $`docker exec ${MYSQL_CONTAINER} mysql -uroot -psecret -e ${'DROP DATABASE IF EXISTS shop'}`.quiet().nothrow();
  await $`docker exec ${MYSQL_CONTAINER} mysql -uroot -psecret -e ${MYSQL_SEED}`.quiet().nothrow();

  console.log('test databases up and seeded');
}

export async function down(): Promise<void> {
  await $`docker rm -f ${PG_CONTAINER} ${MYSQL_CONTAINER}`.quiet().nothrow();
  console.log('test databases removed');
}

if (import.meta.main) {
  const cmd = Bun.argv[2];
  if (cmd === 'up') await up();
  else if (cmd === 'down') await down();
  else {
    console.error('usage: bun run tests/fixtures/db.ts <up|down>');
    process.exit(1);
  }
}
