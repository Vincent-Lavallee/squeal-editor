import type { SqlDialect } from '../../../../shared/protocol/index.ts';
import {
    DELIMITER_DIRECTIVE,
    dollarTagAt,
    isBlank,
    isEscapeStringOpener,
    LEXIS,
    pastBlockComment,
    pastDollarQuoted,
    pastLine,
    pastQuoted,
    startsLine,
    unquoteDelimiter,
    type Lexis,
} from './sqlLexis.ts';

/** The statements a tab holds, in order — see `statementSpans` for the rules. */
export function splitStatements(sql: string, dialect: SqlDialect): string[] {
    return statementSpans(sql, dialect).map((statement) => statement.text);
}

export interface StatementSpan {
    text: string;
    /** Where `text` sits in the original SQL, trimmed exactly as `text` is. */
    start: number;
    end: number;
}

/** The index past a comment starting at `i`, or `null` when there is none there. */
function skipComment(sql: string, i: number, lexis: Lexis): number | null {
    const ch = sql[i]!;
    if (ch === '-' && sql[i + 1] === '-' && (!lexis.dashCommentNeedsSpace || isBlank(sql[i + 2]))) {
        return pastLine(sql, i);
    }
    if (lexis.hashComments && ch === '#') return pastLine(sql, i);
    if (ch === '/' && sql[i + 1] === '*')
        return pastBlockComment(sql, i, lexis.nestedBlockComments);
    return null;
}

/**
 * `DELIMITER <token>`, consumed at `i`, or `null` when there is none there.
 *
 * Only at the head of a statement, and only at the head of a line -- the two
 * guards the `mysql` CLI applies, and between them what keeps a column
 * honestly named `delimiter` from being read as the directive. The letter is
 * checked first so the rest, which allocates, is only reached by a candidate.
 */
function tryDelimiterDirective(
    sql: string,
    i: number,
    lexis: Lexis,
    significant: boolean,
): { index: number; terminator: string | null } | null {
    const ch = sql[i]!;
    if (
        !lexis.delimiterDirective ||
        (ch !== 'd' && ch !== 'D') ||
        significant ||
        !startsLine(sql, i)
    )
        return null;
    const directive = DELIMITER_DIRECTIVE.exec(sql.slice(i));
    if (!directive) return null;
    const next = unquoteDelimiter(directive[1]!);
    // Consumed rather than emitted: it is the client's instruction, not a
    // statement, and sending it on would be a syntax error from the server.
    // `terminator: null` means no change -- an empty token leaves whatever
    // terminator was already in force.
    return { index: i + directive[0].length, terminator: next.length > 0 ? next : null };
}

/**
 * Cuts a tab's text into the statements it actually holds, on the semicolons
 * that really end one, and says where each one sits.
 *
 * **The offsets are here rather than recovered afterwards** because there is
 * nothing to recover them from: the same statement can appear twice in a tab,
 * so searching the text for one that came back as a string finds a position
 * rather than *its* position. Running the statement under the cursor asks
 * exactly that question, and only the pass that did the cutting can answer it.
 *
 * **This decides what runs, so it is a lexer and never a guess.** `sqlScope.ts`
 * is allowed to be a loose regex scan because a miss there costs an absent
 * suggestion; a miss here would cut a statement in half and send both pieces to
 * a server. So every construct that can legally contain a semicolon is walked
 * through rather than pattern-matched around: string literals, quoted
 * identifiers, line and block comments, and Postgres' dollar-quoted bodies.
 * Nothing here understands what a statement *means* -- it only knows which
 * characters are inside something and which are not.
 *
 * A fragment holding nothing but whitespace and comments is not a statement and
 * is dropped, which is what makes a trailing `;` and a trailing `-- note` cost
 * nothing. A comment *before* a statement stays with it: only a fragment with no
 * significant character at all disappears.
 *
 * The terminator itself is left out, so each statement is exactly one statement
 * and can be re-run (sorted, re-read after a save) without the semicolon that
 * separated it from its neighbour.
 *
 * **MySQL's `DELIMITER` is handled here because here is where it belongs.** It
 * looks like the one piece of SQL this file has no business reading, and it is
 * the opposite: `DELIMITER` is not SQL at all. The server has never heard of it —
 * the `mysql` CLI consumes it and never sends it — so a client is the *only*
 * thing that can act on it, and this is the client. Without it a
 * `CREATE TRIGGER … BEGIN …; …; END` body reads as several statements and its
 * first fragment fails to parse; with it the whole body arrives as the one
 * statement the server always thought it was.
 */
export function statementSpans(sql: string, dialect: SqlDialect): StatementSpan[] {
    const lexis = LEXIS[dialect];
    const statements: StatementSpan[] = [];
    let start = 0;
    let significant = false;
    let i = 0;
    // What ends a statement right now. `DELIMITER` is the only thing that moves
    // it, and it is per call: a run never inherits the delimiter a previous one
    // was left on, the same as opening a fresh `mysql` session.
    let terminator = ';';

    const take = (end: number): void => {
        if (significant) {
            // Trimmed by walking the ends in rather than by `trim()`, because the
            // offsets have to describe the text that comes back: a `text` that had
            // been trimmed away from its own `start` would point at whitespace.
            let from = start;
            let to = end;
            while (from < to && isBlank(sql[from])) from += 1;
            while (to > from && isBlank(sql[to - 1])) to -= 1;
            statements.push({ text: sql.slice(from, to), start: from, end: to });
        }
        significant = false;
    };

    while (i < sql.length) {
        const ch = sql[i]!;

        const afterComment = skipComment(sql, i, lexis);
        if (afterComment !== null) {
            i = afterComment;
            continue;
        }

        if (ch === "'" || ch === '"' || ch === '`') {
            significant = true;
            // A backtick is an identifier everywhere it is legal and never takes a
            // backslash escape; the other two do on an engine that reads one at all,
            // and on Postgres only inside an `E''` string.
            const escapes =
                ch !== '`' &&
                (lexis.backslashEscapes || (lexis.escapeStrings && isEscapeStringOpener(sql, i)));
            i = pastQuoted(sql, i, ch, escapes);
            continue;
        }

        if (lexis.dollarQuotes && ch === '$') {
            const tag = dollarTagAt(sql, i);
            if (tag) {
                significant = true;
                i = pastDollarQuoted(sql, i, tag);
                continue;
            }
        }

        const directive = tryDelimiterDirective(sql, i, lexis, significant);
        if (directive) {
            if (directive.terminator !== null) terminator = directive.terminator;
            i = directive.index;
            start = i;
            continue;
        }

        if (sql.startsWith(terminator, i)) {
            take(i);
            i += terminator.length;
            start = i;
            continue;
        }

        if (!isBlank(ch)) significant = true;
        i += 1;
    }
    take(sql.length);

    return statements;
}

/**
 * The statement the cursor is standing in, or null when the text holds none.
 *
 * **The gap between two statements belongs to the one above it.** A cursor sits
 * just past the `;` it typed far more often than inside the text it means to
 * run, so reaching backwards is what makes "write a query, end it, run it" work
 * without selecting anything first. Only a cursor with no statement behind it
 * at all reaches forward instead — a blank line above the tab's only query is
 * otherwise a shortcut that does nothing.
 *
 * **A comment above a statement needs no rule of its own here**, and that is
 * the reason these spans are the splitter's rather than a second reading of the
 * text: it already keeps a leading comment with the statement it heads, so a
 * cursor parked in `-- fetch the users` is *inside* that statement's span and
 * never reaches the rule above. Two readings would have disagreed there.
 */
export function statementAt(sql: string, dialect: SqlDialect, offset: number): string | null {
    const statements = statementSpans(sql, dialect);

    let preceding: StatementSpan | undefined;
    for (const statement of statements) {
        const holdsCursor = offset >= statement.start && offset <= statement.end;
        if (holdsCursor) return statement.text;
        if (statement.end < offset) preceding = statement;
    }

    return (preceding ?? statements[0])?.text ?? null;
}
