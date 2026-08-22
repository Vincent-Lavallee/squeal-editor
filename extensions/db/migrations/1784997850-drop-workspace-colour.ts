import type { Migration } from './migration.ts';

/**
 * A workspace no longer carries a colour of its own -- that identity moved to
 * each connection instead, which is never colourless either (see
 * `connection-colour`). See `docs/decisions.md` for why.
 *
 * SQLite has supported `DROP COLUMN` since 3.35 (2021), well inside Bun's
 * bundled version, so this is a plain drop rather than the table-rebuild
 * dance `workspaces` needed the one time a constraint had to change.
 */
export const migration: Migration = {
    version: 1784997850,
    name: 'drop-workspace-colour',

    up: (db) => db.run('ALTER TABLE workspaces DROP COLUMN color'),
};
