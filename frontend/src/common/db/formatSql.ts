/**
 * The house style for SQL this app writes down, as a pure transform.
 *
 * It lives in `common/db/` rather than in the editor for `splitStatements.ts`'
 * reason: it has two callers in two features and neither may import the other.
 * The editor registers it with Monaco as a document formatter; the assistant
 * runs SQL it wrote through it before that SQL lands in a tab, so a tab the
 * model wrote reads like a tab the user formatted rather than like whatever the
 * model felt like emitting. One definition of the style, so the two cannot
 * drift.
 *
 * It is the third thing up here that reads `SqlDialect` for itself, beside
 * `sql.ts`'s quoting and `splitStatements.ts`' lexer, and for the same reason:
 * how the text on screen is *spelled* is this side's business, while what SQL
 * *means* stays the extension's. Nothing here authors SQL — it only re-spaces
 * what someone already wrote.
 */

import { format, type SqlLanguage } from 'sql-formatter';

import type { SqlDialect } from '../../../../shared/protocol/index.ts';

/**
 * The protocol's dialect as sql-formatter spells it. `sql` is the fallback the
 * protocol already uses for an engine Monaco does not know, and sql-formatter's
 * generic `sql` is the right thing to hand it -- neither side invents a dialect.
 */
const LANGUAGE: Record<SqlDialect, SqlLanguage> = {
    mysql: 'mysql',
    pgsql: 'postgresql',
    sql: 'sql',
};

/**
 * Format one statement or a whole tab. `null` when sql-formatter could not parse
 * it, and **every caller treats that as "leave the text alone"**: it refuses
 * input it cannot parse — a half-written statement, a dialect quirk it does not
 * cover — and a no-op is the honest answer to "I could not format this".
 *
 * `keywordCase: 'upper'` uppercases keywords only. Identifiers, string literals
 * and the data they name are left exactly as written, which is the same line the
 * value-handling rules draw: casing SQL's own words is presentation, casing
 * anything a server gave us would be a lie.
 *
 * `tabWidth: 2` matches the editor's own tabSize, so formatting does not fight
 * the setting the rest of the document is typed under.
 */
export function formatSql(sql: string, dialect: SqlDialect): string | null {
    try {
        return format(sql, { language: LANGUAGE[dialect], tabWidth: 2, keywordCase: 'upper' });
    } catch {
        return null;
    }
}
