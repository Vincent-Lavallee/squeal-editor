import type {
    CellValue,
    FilterOperator,
    SortOrder,
    TableFilter,
} from '../../../shared/protocol/index.ts';
import type { TableSearch } from './driver.ts';

/** A `WHERE` clause and the values bound into it, ready to run. */
export interface WhereClause {
    /** The clause *without* the `WHERE` keyword, or null when nothing narrows. */
    clause: string | null;
    params: CellValue[];
}

/** The operators the builder may author, as a runtime guard over user JSON. */
const FILTER_OPERATORS = new Set<FilterOperator>([
    '=',
    '<>',
    '>',
    '<',
    '>=',
    '<=',
    'LIKE',
    'IN',
    'IS NULL',
    'IS NOT NULL',
]);

const NO_VALUE_OPERATORS = new Set<FilterOperator>(['IS NULL', 'IS NOT NULL']);

/**
 * Turns a filter into the `WHERE` a browsed page runs under.
 *
 * Shared between the engines for `runWrites`' reason: the assembly and the
 * operator guard must not drift, and the only thing that differs is how a
 * placeholder is spelled. Quoting and the placeholder arrive as callbacks so
 * the per-engine halves stay in the engines' own files.
 *
 * **The builder path binds every value and interpolates none.** The column is
 * quoted, the operator comes from a closed set checked here rather than trusted
 * from the JSON, and the value becomes a parameter -- so a BIGINT compares
 * exactly, a date is the server's string to parse, and there is nothing for a
 * quote in the text to break out of. This is *Value handling* on the read path.
 *
 * **The raw path interpolates by design.** It is the user's own `WHERE` text,
 * the same category as the statement they type in the editor, and there is no
 * structure in it to bind. It is the escape hatch for what the operator set
 * cannot express, and it can express anything they could have written by hand.
 */
export function buildWhere(
    filter: TableFilter | undefined,
    quoteIdent: (name: string) => string,
    placeholder: (position: number) => string,
    startAt = 0,
): WhereClause {
    const empty: WhereClause = { clause: null, params: [] };
    if (!filter) return empty;

    if (filter.kind === 'raw') {
        const where = filter.where.trim();
        return where ? { clause: where, params: [] } : empty;
    }

    const params: CellValue[] = [];
    let position = startAt;
    const parts: string[] = [];

    for (const condition of filter.conditions) {
        if (!condition.column) continue;
        if (!FILTER_OPERATORS.has(condition.operator)) {
            throw new Error(`Unsupported filter operator: ${String(condition.operator)}`);
        }
        const column = quoteIdent(condition.column);

        if (NO_VALUE_OPERATORS.has(condition.operator)) {
            parts.push(`${column} ${condition.operator}`);
            continue;
        }

        if (condition.operator === 'IN') {
            // One placeholder per item, so the list is bound rather than pasted. An
            // empty list has no rows it could match and no legal `IN ()` on either
            // engine, so the condition is dropped instead of authored as a syntax error.
            const items = condition.value
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
            if (items.length === 0) continue;
            const slots = items.map(() => placeholder(++position)).join(', ');
            params.push(...items);
            parts.push(`${column} IN (${slots})`);
            continue;
        }

        params.push(condition.value);
        parts.push(`${column} ${condition.operator} ${placeholder(++position)}`);
    }

    if (parts.length === 0) return empty;
    // Parenthesised per condition so an OR set cannot be re-associated by whatever
    // the caller appends next; the conjunction joins the whole set, and mixed
    // logic is the raw clause's job rather than something guessed at here.
    return { clause: parts.map((part) => `(${part})`).join(` ${filter.conjunction} `), params };
}

/**
 * The name filter and the cap a narrowed table listing adds, as SQL fragments.
 *
 * Assembled here for `buildWhere`'s reason: three engines each spelling
 * "match the name, case-insensitively, and stop at N" is three chances for them
 * to disagree about what a search means, on a listing the UI treats as
 * interchangeable between engines.
 *
 * `nameColumn` is passed in already spelled, because the three read three
 * different catalogs (`TABLE_NAME`, `t.table_name`, `name`) and none of them is
 * an identifier the caller chose. **The limit is coerced, never bound**: no
 * placeholder carries a `LIMIT` on all three engines, so it is forced to a
 * non-negative integer and interpolated -- the same rule, and the same reason,
 * as the page offset in `connection.ts`.
 */
export function tableSearchClause(
    search: TableSearch | undefined,
    nameColumn: string,
    placeholder: (position: number) => string,
    startAt = 0,
): { clause: string; params: string[]; limit: string } {
    const text = search?.text?.trim();
    const clause = text ? ` AND LOWER(${nameColumn}) LIKE ${placeholder(startAt + 1)}` : '';
    const params = text ? [`%${text.toLowerCase()}%`] : [];
    const limit =
        search?.limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.floor(search.limit))}`;
    return { clause, params, limit };
}

/** The directions a sort may take, as a runtime guard over user JSON. */
const SORT_DIRECTIONS = new Set<SortOrder['direction']>(['asc', 'desc']);

/**
 * Turns a sort into the `ORDER BY` a result comes back under.
 *
 * Shared between the engines for `buildWhere`'s reason, and quoting is its one
 * callback rather than two because there is no value here to bind: a sort is a
 * column and a direction, and both reach the SQL as text. So both are guarded
 * rather than parameterised -- the column through the driver's own `quoteIdent`
 * (which escapes the quote character, so a name carrying one cannot end the
 * identifier), the direction against the closed set above, checked at runtime
 * because it arrives as user JSON and the type is not the guard.
 *
 * The column is a name the *result* answered under, not one read off a catalog:
 * a browsed page and a wrapped query both order by the header the user clicked,
 * which is the only name that is true of both.
 */
export function orderByClause(
    sort: SortOrder | undefined,
    quoteIdent: (name: string) => string,
): string {
    if (!sort || !sort.column) return '';
    if (!SORT_DIRECTIONS.has(sort.direction)) {
        throw new Error(`Unsupported sort direction: ${String(sort.direction)}`);
    }
    return ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`;
}

/**
 * Extract the Nth expression from the SELECT clause of `sql`.
 *
 * When Postgres returns `?column?` for an un-aliased expression like `SELECT 1`,
 * this gives us the expression text to show in the result header instead. It is a
 * positional scan, not a parser -- the text is a query that already ran, so a
 * parse error here just means we keep the `?column?` the server gave us. SQLite
 * leans on the same scan to rebuild a header its own `columnNames` deduplicated.
 *
 * Handles nested parentheses (CASE, function calls, subqueries) and stops at the
 * top-level FROM. Returns `null` when the SELECT clause cannot be located.
 */
export function selectExpressionAt(sql: string, index: number): string | null {
    // Find the outermost SELECT keyword. Step past CTEs (`WITH … AS (…) SELECT`).
    const selectMatch = /\bSELECT\b/i.exec(sql);
    if (!selectMatch) return null;

    const selStart = selectMatch.index + selectMatch[0].length;

    // Walk from after SELECT until the top-level FROM, tracking paren depth.
    // Collect the range of each top-level expression.
    const exprs: { start: number; end: number }[] = [];
    let depth = 0;
    let exprStart = selStart;

    // We need a rough end: find FROM/WHERE/GROUP/HAVING/ORDER/LIMIT/OFFSET/UNION/;
    // at the top level of the SELECT clause.
    const clauseRe =
        /\b(FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|;)\b/gi;
    const clauseEnd = (() => {
        clauseRe.lastIndex = selStart;
        let pos = selStart;
        let d = 0;
        let m: RegExpExecArray | null;
        while ((m = clauseRe.exec(sql)) !== null) {
            // Count parens between last position and this match
            for (let i = pos; i < m.index; i++) {
                if (sql[i] === '(') d++;
                else if (sql[i] === ')') d--;
            }
            pos = m.index;
            if (d === 0) return m.index;
        }
        return sql.length;
    })();

    for (let i = selStart; i < clauseEnd; i++) {
        const ch = sql[i];
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
        } else if (ch === ',' && depth === 0) {
            exprs.push({ start: exprStart, end: i });
            exprStart = i + 1;
        }
    }
    // The last (or only) expression: after the last comma to the clause end.
    if (exprStart < clauseEnd) {
        exprs.push({ start: exprStart, end: clauseEnd });
    }

    if (index < 0 || index >= exprs.length) return null;
    const expr = exprs[index]!;
    return sql.slice(expr.start, expr.end).trim().replace(/\s+/g, ' ');
}
