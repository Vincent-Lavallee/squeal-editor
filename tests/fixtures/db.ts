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
 * Its `user_id` is a single-column foreign key to `users.id`, set on exactly one
 * row (`e1` -> Ada) -- what FK navigation exists to follow.
 *
 * `tags` and `logs` are for the editable grid's row identity: `tags` has a
 * UNIQUE NOT NULL column and no primary key (so its identity is the unique key),
 * and `logs` has neither (so the grid must stay read-only against it).
 *
 * `cities` -> `regions` is the **composite** foreign key, and it is the pair the
 * two readings of a constraint pull apart on: `pickForeignKeys` drops it (a cell
 * holds one of its two values, so there is no row to navigate to) while
 * `assembleDiagram` keeps it (the tables really are related, and a diagram that
 * dropped it would draw them as strangers). Its local columns are deliberately
 * *not* named after the ones they point at -- `region_code` -> `code` -- so a
 * driver pairing the two sides by name rather than by key position fails here
 * instead of passing by coincidence.
 *
 * `reporting."daily.stats"` has a dot in its *own* name, beside a
 * `reporting.daily_stats` that does not. It is the case that cannot be addressed
 * by splitting a display string -- `reporting.daily.stats` has no correct split
 * -- so it is the proof that the schema travels as a field rather than as a
 * prefix, and the two together are the pair a wrong split confuses.
 *
 * `users."eventType"` is deliberately mixed-case: it is what exposed the filter
 * bar quoting an identifier as `eventType` instead of `"eventType"`, which
 * Postgres folds to `eventtype` and then cannot find. MySQL's own case
 * insensitivity means it cannot reproduce that half of the bug, but the column
 * stays on both so the two engines keep the same shape.
 */

import { $ } from 'bun';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';

import { MYSQL_CONTAINER, PG_CONTAINER, SQLITE_FILE } from './config.ts';

const PG_SEED = `
CREATE TABLE users (
  id serial primary key,
  name text,
  email text,
  created_at timestamptz default now(),
  meta jsonb,
  avatar bytea,
  "eventType" text
);
INSERT INTO users (name, email, meta, avatar, "eventType") VALUES
  ('Ada', 'ada@x.io', '{"role":"admin"}', '\\x0102ff', 'page_view'),
  ('Grace', NULL, NULL, NULL, NULL);
CREATE VIEW active_users AS SELECT id, name FROM users;
CREATE SCHEMA reporting;
CREATE TABLE reporting.daily_stats (day date, hits bigint);
INSERT INTO reporting.daily_stats VALUES ('2026-01-05', 9007199254740993);
CREATE TABLE reporting."daily.stats" (day date, hits bigint);
INSERT INTO reporting."daily.stats" VALUES ('2026-01-06', 1);
CREATE TABLE events (id serial primary key, label text, user_id int REFERENCES users(id));
INSERT INTO events (label) SELECT 'e' || g FROM generate_series(1, 150) g;
UPDATE events SET user_id = (SELECT id FROM users WHERE name = 'Ada') WHERE label = 'e1';
CREATE TABLE regions (country text, code text, name text, PRIMARY KEY (country, code));
INSERT INTO regions VALUES ('fr', 'idf', 'Ile-de-France');
CREATE TABLE cities (
  id serial primary key,
  country text,
  region_code text,
  name text,
  FOREIGN KEY (country, region_code) REFERENCES regions (country, code)
);
INSERT INTO cities (country, region_code, name) VALUES ('fr', 'idf', 'Paris');
CREATE TABLE tags (label text NOT NULL UNIQUE, weight int);
INSERT INTO tags (label, weight) VALUES ('red', 1), ('blue', 2);
CREATE TABLE logs (msg text);
INSERT INTO logs (msg) VALUES ('one'), ('two');
CREATE FUNCTION increment_counter(tablename text, colname text) RETURNS int AS $$
  DECLARE result int;
  BEGIN
    EXECUTE 'SELECT COUNT(*) FROM ' || quote_ident(tablename) INTO result;
    RETURN result;
  END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION square(x int) RETURNS int AS $$
BEGIN
  RETURN x * x;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION audit_trigger() RETURNS TRIGGER AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER events_audit AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER users_audit BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE PROCEDURE log_note(note text) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO logs (msg) VALUES (note);
END;
$$;
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
  big bigint,
  eventType varchar(50)
);
INSERT INTO users (name, email, meta, avatar, big, eventType) VALUES
  ('Ada', 'ada@x.io', '{"role":"admin"}', UNHEX('0102FF'), 9007199254740993, 'page_view'),
  ('Grace', NULL, NULL, NULL, NULL, NULL);
CREATE VIEW active_users AS SELECT id, name FROM users;
CREATE TABLE events (
  id int auto_increment primary key,
  label varchar(20),
  user_id int,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO events (label)
WITH RECURSIVE series AS (
  SELECT 1 AS n UNION ALL SELECT n + 1 FROM series WHERE n < 150
)
SELECT CONCAT('e', n) FROM series;
UPDATE events SET user_id = (SELECT id FROM users WHERE name = 'Ada') WHERE label = 'e1';
CREATE TABLE regions (
  country varchar(2),
  code varchar(10),
  name varchar(50),
  PRIMARY KEY (country, code)
);
INSERT INTO regions VALUES ('fr', 'idf', 'Ile-de-France');
CREATE TABLE cities (
  id int auto_increment primary key,
  country varchar(2),
  region_code varchar(10),
  name varchar(50),
  FOREIGN KEY (country, region_code) REFERENCES regions (country, code)
);
INSERT INTO cities (country, region_code, name) VALUES ('fr', 'idf', 'Paris');
CREATE TABLE tags (label varchar(50) NOT NULL UNIQUE, weight int);
INSERT INTO tags (label, weight) VALUES ('red', 1), ('blue', 2);
CREATE TABLE logs (msg varchar(100));
INSERT INTO logs (msg) VALUES ('one'), ('two');
CREATE TRIGGER events_audit AFTER INSERT ON events
FOR EACH ROW INSERT INTO logs (msg) VALUES (CONCAT('event: ', NEW.label));
CREATE TRIGGER users_audit BEFORE DELETE ON users
FOR EACH ROW INSERT INTO logs (msg) VALUES (CONCAT('deleted user: ', OLD.name));
DELIMITER //
CREATE FUNCTION square(x INT) RETURNS INT DETERMINISTIC
BEGIN
  RETURN x * x;
END//
CREATE PROCEDURE count_rows(IN tablename VARCHAR(255))
BEGIN
  SET @sql = CONCAT('SELECT COUNT(*) FROM ', tablename);
  PREPARE stmt FROM @sql;
  EXECUTE stmt;
  DEALLOCATE PREPARE stmt;
END//
DELIMITER ;
`;

/**
 * The same shapes as the other two, in SQLite's spelling.
 *
 * `big` sits on `users` the way MySQL's does, because SQLite has no second
 * schema to put a `reporting.daily_stats` in -- the BIGINT still has to be
 * somewhere, since it is the value the whole `safeIntegers` rule exists for.
 *
 * `id INTEGER PRIMARY KEY` is deliberate and not incidental: it is the rowid
 * alias, the form `pragma_table_info` reports as **nullable**, so it is exactly
 * the table that proves the driver's primary-key override works. Written any
 * other way this fixture would pass while the common case stayed broken.
 *
 * `created_at` is text, which is what SQLite stores a timestamp as -- there is
 * no date type to shift, so the verbatim rule holds here for free.
 */
const SQLITE_SEED = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  email TEXT,
  created_at TEXT DEFAULT '2026-01-05 09:30:00',
  meta TEXT,
  avatar BLOB,
  big BIGINT,
  eventType TEXT
);
INSERT INTO users (name, email, created_at, meta, avatar, big, eventType) VALUES
  ('Ada', 'ada@x.io', '2026-01-05 09:30:00', '{"role":"admin"}', X'0102FF', 9007199254740993, 'page_view'),
  ('Grace', NULL, '2026-01-05 09:30:00', NULL, NULL, NULL, NULL);
CREATE VIEW active_users AS SELECT id, name FROM users;
CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT, user_id INTEGER REFERENCES users(id));
INSERT INTO events (label)
WITH RECURSIVE series(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM series WHERE n < 150
)
SELECT 'e' || n FROM series;
UPDATE events SET user_id = (SELECT id FROM users WHERE name = 'Ada') WHERE label = 'e1';
CREATE TABLE regions (country TEXT, code TEXT, name TEXT, PRIMARY KEY (country, code));
INSERT INTO regions VALUES ('fr', 'idf', 'Ile-de-France');
CREATE TABLE cities (
  id INTEGER PRIMARY KEY,
  country TEXT,
  region_code TEXT,
  name TEXT,
  FOREIGN KEY (country, region_code) REFERENCES regions (country, code)
);
INSERT INTO cities (country, region_code, name) VALUES ('fr', 'idf', 'Paris');
CREATE TABLE tags (label TEXT NOT NULL UNIQUE, weight INT);
INSERT INTO tags (label, weight) VALUES ('red', 1), ('blue', 2);
CREATE TABLE logs (msg TEXT);
INSERT INTO logs (msg) VALUES ('one'), ('two');
CREATE TRIGGER events_audit AFTER INSERT ON events
BEGIN
  INSERT INTO logs (msg) VALUES ('event: ' || NEW.label);
END;
CREATE TRIGGER users_audit BEFORE DELETE ON users
BEGIN
  INSERT INTO logs (msg) VALUES ('deleted user: ' || OLD.name);
END;
`;

/**
 * Rebuilt from nothing every time, which is what makes `up` re-runnable here --
 * the containers get a DROP DATABASE, and deleting the file is the same move.
 */
function seedSqlite(): void {
  rmSync(SQLITE_FILE, { force: true });
  const db = new Database(SQLITE_FILE, { create: true });
  try {
    db.run(SQLITE_SEED);
  } finally {
    db.close();
  }
}

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

  // No container to wait for: a file engine is ready the moment it is written.
  seedSqlite();

  console.log('test databases up and seeded');
}

export async function down(): Promise<void> {
  await $`docker rm -f ${PG_CONTAINER} ${MYSQL_CONTAINER}`.quiet().nothrow();
  rmSync(SQLITE_FILE, { force: true });
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
