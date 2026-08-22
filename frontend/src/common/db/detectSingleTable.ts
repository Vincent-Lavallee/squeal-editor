/**
 * Names the one table a query reads from, when it reads from exactly one.
 *
 * **This decides whether a write is offered, so it is stricter than a
 * suggestion scan.** `editor/sqlScope.ts` is right to be loose -- a missed
 * table there costs an absent autocomplete entry. Here a wrong answer costs a
 * write landing on the wrong table, so every check below fails toward "not
 * simple" rather than toward a guess: a query this cannot place plainly does
 * not become editable.
 *
 * A single `FROM` and no `JOIN` anywhere in the text is the whole test.
 * Counting occurrences catches what a naive "first FROM" read would miss:
 * a subquery, a CTE, a UNION or an old-style comma join all add a second
 * `FROM` (or, for the comma form, a second relation before the first keyword
 * that would end the clause), and any of them means there is more than one
 * table's worth of identity folded into the row on screen. `WITH` is
 * rejected outright for the same reason before either count runs, since a
 * CTE's own name would otherwise pass as "the one table" and only fail later,
 * confusingly, when the catalog has never heard of it.
 *
 * Comments and string literals are not stripped first, so a `FROM` spelled
 * inside either of those counts too. That is one-directional the same way the
 * completion scan's blindness to them is: it only ever makes a query look
 * *more* complex than it is, never less, so the failure is a query that stays
 * read-only rather than one that becomes wrongly editable.
 */

const IDENT = String.raw`(?:\`[^\`]+\`|"[^"]+"|[A-Za-z_][\w$]*)`;
const RELATION = String.raw`(${IDENT})(?:\.(${IDENT}))?`;

const LEADING_WITH = /^\s*with\b/i;
const ANY_JOIN = /\bJOIN\b/i;
const ANY_FROM = /\bFROM\b/gi;
// The relation right after the first FROM, rejected if a comma follows it --
// that is the old `FROM a, b` join, which names a second table with no JOIN
// keyword for `ANY_JOIN` to catch.
const FIRST_FROM_RELATION = new RegExp(String.raw`\bFROM\s+${RELATION}(?!\s*,)`, 'i');

function unquote(ident: string): string {
    return (ident.startsWith('"') && ident.endsWith('"')) ||
        (ident.startsWith('`') && ident.endsWith('`'))
        ? ident.slice(1, -1)
        : ident;
}

export interface SingleTable {
    table: string;
    schema?: string;
}

/**
 * `schemaCapable` gates a two-part name: Postgres, where `schema.table` names
 * two different things. MySQL's database *is* its schema and its client is
 * already pinned to one, so `other.table` there names a second database this
 * app cannot browse into -- treating it as this table's schema would silently
 * check the wrong catalog entry's key columns.
 */
export function detectSingleTable(sql: string, schemaCapable: boolean): SingleTable | null {
    if (LEADING_WITH.test(sql) || ANY_JOIN.test(sql)) return null;
    if ((sql.match(ANY_FROM)?.length ?? 0) !== 1) return null;

    const match = FIRST_FROM_RELATION.exec(sql);
    if (!match) return null;
    const [, first, second] = match;
    if (second) return schemaCapable ? { schema: unquote(first!), table: unquote(second) } : null;
    return { table: unquote(first!) };
}
