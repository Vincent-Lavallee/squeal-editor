import type { Migration } from './migration.ts';

/**
 * A connection has its own colour, the same way it has its own icon-less
 * identity beside its workspace's -- see `docs/decisions.md`.
 *
 * `slate` is the neutral default, so a connection made before this column, or
 * one nobody has bothered to colour, is never colourless -- the same
 * guess-that-costs-least as every other default column here.
 */
export const migration: Migration = {
  version: 1784997750,
  name: 'connection-colour',

  up: (db) => db.run("ALTER TABLE saved_connections ADD COLUMN color TEXT NOT NULL DEFAULT 'slate'"),
};
