import type { SqlDialect } from '../../../../shared/protocol/index.ts';

/** A value as a SQL string literal, with embedded quotes doubled per the standard. */
export const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Quotes an identifier the way this dialect's own driver would.
 *
 * Mirrors `Driver.quoteIdent` in `extensions/db/drivers.ts` exactly — backtick
 * for MySQL, double quote (the ANSI default, and every other engine this app
 * or a future one is likely to speak) otherwise, each escaping an embedded
 * instance of its own quote character by doubling it. `SqlDialect` is already
 * the frontend's to read: it is what `EditorPane` hands Monaco for
 * highlighting and what `format.ts` maps to a formatter language, so reading
 * it here to answer "which character quotes an identifier" follows the same
 * pattern rather than inventing a new one.
 *
 * **Unconditional, the same call `quoteIdent` already makes.** A plain
 * lowercase name gains quotes it did not strictly need; an unquoted
 * mixed-case or reserved-word name is the bug this exists to prevent —
 * Postgres folds an unquoted identifier to lowercase, so `eventType` typed
 * bare becomes a lookup for a column named `eventtype`, which does not exist.
 */
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  return dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}
