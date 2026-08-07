/**
 * The engine layer: one file per database, behind one barrel.
 *
 * Three things stay central here and one thing does not. Central: the contract
 * every engine answers (`driver.ts`), the engine-neutral assemblers they all
 * lean on (`common.ts`), and the dispatch below. Per-engine: the SQL, the
 * catalog queries, the quoting, and the library's own quirks -- `mysql.ts`,
 * `postgres.ts`, `sqlite.ts`, each of which imports the first two and knows
 * nothing of the others.
 *
 * ## Adding an engine
 *
 * 1. Add the name to `EngineType` in `shared/protocol/config.ts`.
 * 2. Write `extensions/db/drivers/<engine>.ts`, exporting a `Driver<C>` where
 *    `C` is the library's client type.
 * 3. Import it below and add a `case` to `withDriver`.
 * 4. Add the option to `ENGINES` in `frontend/src/common/db/engines.ts`.
 *
 * Then add it to the `describe.each` in `tests/extension.test.ts` -- every
 * engine runs the *same* contract tests, which is what keeps them
 * interchangeable. Nothing in the UI or the transport changes.
 *
 * **Import this barrel, never a file beside it**, the same rule
 * `shared/protocol/` follows: it is what lets a helper move between `common.ts`
 * and an engine without touching a caller. The one exception is the engine files
 * themselves, which import `driver.ts` and `common.ts` directly -- importing the
 * barrel that imports them would be the cycle.
 *
 * Step 3 is by hand for the reason `migrations/index.ts` spells out at length:
 * the extension ships as a `bun build --compile` binary with its source deleted
 * beside it, so only a statically imported file is in there at all.
 */
import type { EngineType } from '../../../shared/protocol/index.ts';
import type { Driver } from './driver.ts';
import { mysqlDriver } from './mysql.ts';
import { postgresDriver } from './postgres.ts';
import { sqliteDriver } from './sqlite.ts';

export type { Driver, QueryOutcome, Relation, TableMeta, TableSearch } from './driver.ts';
export { buildWhere, orderByClause, type WhereClause } from './common.ts';
export { mysqlDriver } from './mysql.ts';
export { postgresDriver } from './postgres.ts';
export { sqliteDriver } from './sqlite.ts';

/**
 * Hands the driver for `type` to `use`, which must work for any client type.
 * This is what lets a caller build something concrete (see connection.ts)
 * without the driver's client type leaking into the registry.
 */
export function withDriver<R>(type: EngineType, use: <C>(driver: Driver<C>) => R): R {
  switch (type) {
    case 'mysql':
      return use(mysqlDriver);
    case 'postgres':
      return use(postgresDriver);
    case 'sqlite':
      return use(sqliteDriver);
    default:
      // Unreachable per the type, but `type` arrives from user-supplied JSON.
      throw new Error(`Unsupported database type: ${String(type)}`);
  }
}
