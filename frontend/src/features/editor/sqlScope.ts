/**
 * What a query says it is reading, as far as a regex can tell.
 *
 * **This is a scan, not a parser, and that is the design rather than the budget.**
 * The text this runs against is a query *being typed*: half a statement, an
 * unclosed paren, a `FROM` with nothing after it yet. A real parser answers
 * "this is not valid SQL" for almost every keystroke that matters -- which is
 * exactly when the completion has to have an answer -- so it would have to be
 * error-recovering, per dialect, and be wrong about the same partial text anyway.
 * A regex that finds `FROM users u` in anything is right far more often, and its
 * failures are the harmless direction: a suggestion missing, never a wrong one.
 *
 * It follows that this must never be leaned on for anything but suggestions.
 * Nothing here decides what runs.
 */

/**
 * One name: backtick-quoted, double-quoted, or bare.
 *
 * A relation is a part, optionally `schema.part` -- and each half quotes itself
 * independently, which is why this is built from a part rather than written out.
 * `"reporting"."hits"` is ordinary Postgres, and a pattern that only allowed the
 * whole thing to be quoted would match `"reporting"` and stop at the dot.
 */
const PART = String.raw`\`[^\`]+\`|"[^"]+"|[A-Za-z_][\w$]*`;
const RELATION = String.raw`(?:${PART})(?:\.(?:${PART}))?`;

const FROM_OR_JOIN = new RegExp(
    String.raw`\b(?:FROM|JOIN)\s+(${RELATION})(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?`,
    'gi',
);

/**
 * Words that follow a table without being its alias.
 *
 * `FROM users WHERE x` and `FROM users u` are the same shape to the regex above,
 * so the word after the table is an alias only if it is not one of these. Being
 * wrong here is cheap and one-directional: a missed entry invents an alias that
 * nothing will ever type a dot after.
 */
const NOT_AN_ALIAS = new Set([
    'WHERE',
    'JOIN',
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'CROSS',
    'OUTER',
    'NATURAL',
    'ON',
    'USING',
    'GROUP',
    'ORDER',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'FETCH',
    'WINDOW',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'SET',
    'VALUES',
    'RETURNING',
    'FOR',
    'INTO',
    'SELECT',
    'WITH',
    'LATERAL',
    'TABLESAMPLE',
    'PARTITION',
    'STRAIGHT_JOIN',
    'AS',
]);

export interface SqlScope {
    /** Tables named in a FROM or a JOIN, in the order they appear, deduped. */
    tables: string[];
    /** Lower-cased alias -> the table it stands for, from `FROM users u`. */
    aliases: Map<string, string>;
}

const EMPTY: SqlScope = { tables: [], aliases: new Map() };

/**
 * `` `users` ``, `"users"` and `users` all name the same table, and
 * `"reporting"."hits"` names the one the catalog reports as `reporting.hits` --
 * which is the spelling this has to land on, since that is the name columns are
 * asked for by.
 *
 * Dropping the quote characters outright rather than slicing the ends off each
 * part: it is the same answer for every name the engines produce, and a name
 * with a literal quote inside it is past what a scan can be asked to do.
 */
const unquote = (name: string): string => name.replace(/[`"]/g, '');

/**
 * Reads the tables and aliases out of a query.
 *
 * Comments and string literals are not stripped first, so a `-- FROM users` in a
 * comment contributes a table. Deliberate: the cost is one extra name in a
 * popup, and the alternative is tokenizing the dialect properly, which is the
 * parser this file exists not to be.
 */
export function scanScope(sql: string): SqlScope {
    if (!sql) return EMPTY;

    const tables: string[] = [];
    const aliases = new Map<string, string>();

    for (const [, relation, alias] of sql.matchAll(FROM_OR_JOIN)) {
        if (!relation) continue;

        const table = unquote(relation);
        if (!tables.includes(table)) tables.push(table);

        if (alias && !NOT_AN_ALIAS.has(alias.toUpperCase())) {
            aliases.set(alias.toLowerCase(), table);
        }
    }

    return { tables, aliases };
}

/**
 * The `users.`, `u.` or `"Users".` immediately left of the cursor, if there is
 * one -- unquoted, which is the spelling `resolveQualifier` below answers for.
 *
 * A qualifier may itself be schema-qualified -- `reporting.hits.` is a relation
 * and a dot, not an alias and two dots -- so the pattern takes the longest name
 * it can before the final dot. The optional quote *after* that dot belongs to
 * the column being typed (`u."crea`), not to the qualifier: without it the whole
 * match fails the moment a name is opened with a quote, and the popup falls back
 * to offering the entire dialect at a dot.
 */
const QUALIFIER = new RegExp(String.raw`(${RELATION})\.["\`]?[\w$]*$`);

export function qualifierAt(line: string): string | null {
    const qualifier = QUALIFIER.exec(line)?.[1];
    return qualifier === undefined ? null : unquote(qualifier);
}

/**
 * What `u` in `u.` refers to: an alias, or a table named outright.
 *
 * **It resolves against the scope and never against the catalog**, and that is
 * the invariant rather than a shortcut. Columns are fetched and cached under the
 * name *as the query wrote it*, so a resolver that answered with the catalog's
 * spelling would hand back a key the cache cannot have -- `FROM Users` caches
 * under `Users` and resolving to the catalog's `users` looks up nothing, on a
 * table whose columns are sitting right there. Only a table in the `FROM` has
 * had its columns fetched at all, so only a table in the `FROM` is answerable:
 * resolution and fetching read the same list, which is what keeps them from
 * disagreeing.
 *
 * Aliases win over bare names. `FROM users u JOIN u ...` is not a query anyone
 * writes, and in the tie the alias is the one the cursor is inside.
 *
 * The case-insensitive sweep is the last step because both engines accept a
 * table typed in a case their catalog does not store; matching exactly and
 * stopping would leave the completion silent on text the server is happy with.
 */
export function resolveQualifier(qualifier: string, scope: SqlScope): string | null {
    const alias = scope.aliases.get(qualifier.toLowerCase());
    if (alias) return alias;

    if (scope.tables.includes(qualifier)) return qualifier;

    const lower = qualifier.toLowerCase();
    return scope.tables.find((table) => table.toLowerCase() === lower) ?? null;
}
