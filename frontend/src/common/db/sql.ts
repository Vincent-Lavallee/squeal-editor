import type { SqlDialect } from '../../../../shared/protocol/index.ts';

/** A value as a SQL string literal, with embedded quotes doubled per the standard. */
export const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * The character this dialect quotes an identifier with — backtick for MySQL,
 * double quote (the ANSI default, and every other engine this app or a future
 * one is likely to speak) otherwise.
 *
 * `SqlDialect` is already the frontend's to read: it is what `EditorPane` hands
 * Monaco for highlighting and what `format.ts` maps to a formatter language, so
 * reading it here follows the same pattern rather than inventing a new one.
 */
export const identifierQuote = (dialect: SqlDialect): string => (dialect === 'mysql' ? '`' : '"');

/**
 * Quotes an identifier the way this dialect's own driver would.
 *
 * Mirrors `Driver.quoteIdent` in `extensions/db/drivers/` exactly, escaping an
 * embedded instance of the quote character by doubling it.
 *
 * **Unconditional, the same call `quoteIdent` already makes.** A plain
 * lowercase name gains quotes it did not strictly need; an unquoted
 * mixed-case or reserved-word name is the bug this exists to prevent —
 * Postgres folds an unquoted identifier to lowercase, so `eventType` typed
 * bare becomes a lookup for a column named `eventtype`, which does not exist.
 */
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  const quote = identifierQuote(dialect);
  return quote + name.replaceAll(quote, quote + quote) + quote;
}

/**
 * What an identifier may look like to reach this dialect's parser bare and
 * still name the thing it spells.
 *
 * Postgres is the one that folds: an unquoted identifier is lowercased before
 * it is looked up, so an uppercase letter anywhere in the name makes the bare
 * form a lookup for a different column. MySQL and SQLite preserve the case they
 * are given, so only characters that cannot appear in a bare identifier at all
 * — a space, a dash, a leading digit — force quotes there.
 *
 * A reserved word (`order`, `select`) also needs quoting and is deliberately
 * not detected: telling the reserved ones apart from the many keywords that are
 * legal column names would take a per-dialect list, and getting it wrong the
 * generous way would quote half the ordinary columns there are.
 */
const BARE_IDENTIFIER: Record<SqlDialect, RegExp> = {
  pgsql: /^[a-z_][a-z0-9_$]*$/,
  mysql: /^[A-Za-z_$][A-Za-z0-9_$]*$/,
  sql: /^[A-Za-z_][A-Za-z0-9_$]*$/,
};

/**
 * Quotes an identifier only where writing it bare would not name it.
 *
 * The counterpart of `quoteIdentifier` above, and the split is which side is
 * reading the result. SQL this app *assembles* is quoted unconditionally —
 * nobody reads a `WHERE` clause the filter bar built, so the noise costs
 * nothing and the judgment call cannot be got wrong. SQL the user is *writing*
 * is read by them, so completing `email` as `"email"` would put quotes through
 * a query that never needed one.
 */
export const quoteIdentifierIfNeeded = (name: string, dialect: SqlDialect): string =>
  BARE_IDENTIFIER[dialect].test(name) ? name : quoteIdentifier(name, dialect);
