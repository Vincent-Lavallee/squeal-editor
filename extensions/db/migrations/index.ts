/**
 * The store's schema, as one file per change, applied oldest first.
 *
 * There is no `CREATE TABLE` for the current schema anywhere. The schema *is*
 * what this list produces when it is run from nothing, which is the point: a
 * fresh store and a store written three versions ago walk the same steps and
 * therefore cannot end up different. A "current schema" constant kept beside the
 * migrations is a second answer to what shape the file is, and the two drift the
 * moment either is edited alone.
 *
 * ## Adding one
 *
 * 1. `extensions/db/migrations/<epoch>-what-it-does.ts`, exporting `migration`,
 *    with `version` set to the same epoch the file is named for. Take it from
 *    the clock — `date +%s`, or `Math.floor(Date.now() / 1000)` — not from the
 *    last file + 1, which is what a sequence of ordinals was abandoned for.
 * 2. Import it below and append it to `MIGRATIONS`.
 * 3. Leave `applied` off. It exists only for migrations older than the
 *    `schema_migrations` table itself; see `runner.ts`.
 *
 * ## Why step 2 is by hand, and must stay that way
 *
 * Reading the directory would be nicer and would ship a store that silently
 * never migrates. The extension is distributed as a `bun build --compile`
 * binary, and the release then **deletes every source file next to it**
 * (`.github/workflows/release.yml`, "Slim the extension folder"). Only what is
 * statically imported gets compiled in; a path computed at runtime resolves
 * against files that are no longer there.
 *
 * The reason this is worth a paragraph rather than a line: **the tests would not
 * catch it.** They spawn `bun main.ts` against the source tree, where a
 * directory scan finds every file and passes. The failure appears only in a
 * packaged build, as a store that quietly has no tables.
 *
 * ## The rules
 *
 * - **A migration is frozen once it has shipped.** It has already run on
 *   someone's disk, so editing it changes what a *new* store gets and nothing
 *   else -- the two schemas then differ silently and permanently. Change the
 *   schema by appending a file, never by editing one.
 * - **Each one spells its own SQL out in full, values included.** They read
 *   repetitively on purpose. A migration that reaches for a shared constant
 *   rewrites its own history the day that constant changes: rename the default
 *   workspace and `workspaces` below would retroactively claim it always wrote
 *   the new name.
 */

import type { Migration } from './migration.ts';

import { migration as savedConnections } from './1784202096-saved-connections.ts';
import { migration as workspaces } from './1784289561-workspaces.ts';
import { migration as connectionSsl } from './1784289562-connection-ssl.ts';
import { migration as connectionReadOnly } from './1784313318-connection-read-only.ts';
import { migration as connectionAwsIam } from './1784374797-connection-aws-iam.ts';
import { migration as workspaceColour } from './1784408527-workspace-colour.ts';
import { migration as settings } from './1784584732-settings.ts';
import { migration as stars } from './1784629337-stars.ts';
import { migration as connectionSessions } from './1784997641-connection-sessions.ts';

/** Oldest first. Append only. */
export const MIGRATIONS: Migration[] = [
  savedConnections,
  workspaces,
  connectionSsl,
  connectionReadOnly,
  connectionAwsIam,
  workspaceColour,
  settings,
  stars,
  connectionSessions,
];

/*
 * The order is maintained by hand, so it is checked at import rather than
 * trusted. A file appended out of order runs before the one it depends on, and a
 * duplicated timestamp is recorded once and skipped forever after -- both of
 * which surface as a confusing SQL error on someone's launch, a long way from
 * the list that caused them. Failing here names the actual problem.
 */
MIGRATIONS.forEach((migration, i) => {
  const previous = MIGRATIONS[i - 1];
  if (previous && migration.version <= previous.version) {
    throw new Error(
      `Migrations are out of order: ${migration.name} (${migration.version}) ` +
        `must come after ${previous.name} (${previous.version}).`
    );
  }
});

export type { Migration };
