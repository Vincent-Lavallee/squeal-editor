import type { Migration } from './migration.ts';

/**
 * Assistant conversations: a thread, kept so it can be reopened after a quit.
 *
 * The second table here that references nothing, and for the same reason
 * `saved_queries` does not: a conversation may name three connections over its
 * life, or none, so filing it under one would be filing it under whichever
 * server it happened to mention first. Nothing is cleared when a connection is
 * deleted, because nothing here was ever that connection's.
 *
 * `body` is opaque — `connection_sessions`'s rule, applied to a thread. What is
 * *not* opaque is `title` and `updated_at`, and that is the one deliberate
 * departure: the picker names a conversation and orders the list by them, and
 * parsing every transcript on disk to draw a dozen rows is exactly what a column
 * costs nothing to avoid.
 */
export const migration: Migration = {
  version: 1786107358,
  name: 'conversations',

  up: (db) =>
    db.run(`CREATE TABLE conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      body       TEXT NOT NULL
    )`),
};
