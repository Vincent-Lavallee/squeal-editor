import { hasColumn, type Migration } from './migration.ts';

/**
 * A workspace carries a colour, which the rail tints its group with.
 *
 * `slate` is the neutral swatch, so a workspace made before this column is never
 * colourless -- the same guess-that-costs-least as every other default here.
 */
export const migration: Migration = {
  version: 1784408527,
  name: 'workspace-colour',

  up: (db) => db.run("ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT 'slate'"),

  applied: (db) => hasColumn(db, 'workspaces', 'color'),
};
