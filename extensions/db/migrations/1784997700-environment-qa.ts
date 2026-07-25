import type { Migration } from './migration.ts';

/**
 * `staging` is renamed to `qa`, the standard name for the pre-production tier.
 *
 * The column is unchanged -- environment has always been a bare TEXT, not a
 * CHECK-constrained enum -- so this is a data rewrite, not a schema one: every
 * row already sitting at the old value is carried across rather than left to
 * point at a label the app no longer offers.
 */
export const migration: Migration = {
  version: 1784997700,
  name: 'environment-qa',

  up: (db) => db.run("UPDATE saved_connections SET environment = 'qa' WHERE environment = 'staging'"),
};
