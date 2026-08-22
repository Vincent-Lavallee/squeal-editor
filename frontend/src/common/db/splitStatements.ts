import type { SqlDialect } from '../../../../shared/protocol/index.ts';

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

        if (
            ch === '-' &&
            sql[i + 1] === '-' &&
            (!lexis.dashCommentNeedsSpace || isBlank(sql[i + 2]))
        ) {
            i = pastLine(sql, i);
            continue;
        }
        if (lexis.hashComments && ch === '#') {
            i = pastLine(sql, i);
            continue;
        }
        if (ch === '/' && sql[i + 1] === '*') {
            i = pastBlockComment(sql, i, lexis.nestedBlockComments);
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

        // Only at the head of a statement, and only at the head of a line -- the two
        // guards the `mysql` CLI applies, and between them what keeps a column
        // honestly named `delimiter` from being read as the directive. The letter is
        // checked first so the rest, which allocates, is only reached by a candidate.
        if (
            lexis.delimiterDirective &&
            (ch === 'd' || ch === 'D') &&
            !significant &&
            startsLine(sql, i)
        ) {
            const directive = DELIMITER_DIRECTIVE.exec(sql.slice(i));
            if (directive) {
                const next = unquoteDelimiter(directive[1]!);
                if (next.length > 0) terminator = next;
                // Consumed rather than emitted: it is the client's instruction, not a
                // statement, and sending it on would be a syntax error from the server.
                i += directive[0].length;
                start = i;
                continue;
            }
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

/**
 * The lexical rules that differ between the engines this app speaks.
 *
 * A table of dialects in the frontend is the thing `docs/architecture.md`
 * forbids for *catalogs and quoting* -- deciding what SQL means is the
 * extension's. This is the narrower kind the UI already keeps beside it in
 * `sql.ts` (`identifierQuote`, `BARE_IDENTIFIER`) and `format.ts`: how the text
 * on screen is spelled, which is the editor's own business. Nothing here
 * authors SQL; it only says where one statement the user typed ends.
 */
interface Lexis {
    /** MySQL alone reads `#` to end of line as a comment. */
    hashComments: boolean;
    /** MySQL wants whitespace after `--`, so `a--b` there is arithmetic, not a comment. */
    dashCommentNeedsSpace: boolean;
    /** Postgres nests block comments; the other two close on the first end marker. */
    nestedBlockComments: boolean;
    /** MySQL reads `\'` inside a string as an escaped quote; standard SQL does not. */
    backslashEscapes: boolean;
    /** Postgres' `E'…'`, the one string form there that *does* take backslashes. */
    escapeStrings: boolean;
    /** Postgres' `$tag$ … $tag$`, which is how a routine body carries semicolons. */
    dollarQuotes: boolean;
    /**
     * MySQL's `DELIMITER`, which is how a routine body carries them there instead.
     *
     * MySQL-only because it is the one engine with no in-language way to quote a
     * body: Postgres has dollar-quoting above and SQLite has no routines to write.
     * Reading the word as a directive on either of those would swallow a line of
     * somebody's SQL to honour a command that engine does not have.
     */
    delimiterDirective: boolean;
}

const LEXIS: Record<SqlDialect, Lexis> = {
    mysql: {
        hashComments: true,
        dashCommentNeedsSpace: true,
        nestedBlockComments: false,
        backslashEscapes: true,
        escapeStrings: false,
        dollarQuotes: false,
        delimiterDirective: true,
    },
    pgsql: {
        hashComments: false,
        dashCommentNeedsSpace: false,
        nestedBlockComments: true,
        backslashEscapes: false,
        escapeStrings: true,
        dollarQuotes: true,
        delimiterDirective: false,
    },
    sql: {
        hashComments: false,
        dashCommentNeedsSpace: false,
        nestedBlockComments: false,
        backslashEscapes: false,
        escapeStrings: false,
        dollarQuotes: false,
        delimiterDirective: false,
    },
};

/**
 * `DELIMITER <token>` and the rest of its line.
 *
 * The token is whatever runs to the next whitespace, which is how the `mysql`
 * CLI reads it — everything after that on the line is ignored rather than made
 * part of the delimiter, so a stray trailing comment cannot change what ends a
 * statement. A `DELIMITER` with nothing after it does not match at all and stays
 * ordinary text, which is the honest reading: the CLI rejects that too.
 */
const DELIMITER_DIRECTIVE = /^delimiter[ \t]+(\S+)[^\n]*(?:\n|$)/i;

/** Whether only whitespace stands between `at` and the start of its line. */
function startsLine(sql: string, at: number): boolean {
    for (let i = at - 1; i >= 0; i--) {
        const ch = sql[i]!;
        if (ch === '\n') return true;
        if (!isBlank(ch)) return false;
    }
    return true;
}

/**
 * `delimiter "//"` and `delimiter //` both mean `//`.
 *
 * Quoting it is legal and occasionally necessary in the CLI, and a delimiter
 * that kept its quotes would simply never be found in the text.
 */
function unquoteDelimiter(token: string): string {
    const quote = token[0];
    const quoted =
        (quote === '"' || quote === "'" || quote === '`') &&
        token.length > 1 &&
        token.endsWith(quote);
    return quoted ? token.slice(1, -1) : token;
}

const isBlank = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

const pastLine = (sql: string, at: number): number => {
    const newline = sql.indexOf('\n', at);
    return newline === -1 ? sql.length : newline + 1;
};

function pastBlockComment(sql: string, open: number, nested: boolean): number {
    let depth = 1;
    let i = open + 2;
    while (i < sql.length) {
        if (nested && sql[i] === '/' && sql[i + 1] === '*') {
            depth += 1;
            i += 2;
            continue;
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
            depth -= 1;
            i += 2;
            if (depth === 0) return i;
            continue;
        }
        i += 1;
    }
    // Unterminated: the rest of the text is inside it, so nothing after this can
    // end a statement. Running one fragment the server will reject beats cutting
    // the text on a semicolon that is commented out.
    return sql.length;
}

function pastQuoted(sql: string, open: number, quote: string, backslashEscapes: boolean): number {
    let i = open + 1;
    while (i < sql.length) {
        const ch = sql[i]!;
        if (backslashEscapes && ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === quote) {
            // The doubled quote is how every engine here writes one inside a literal,
            // so it closes and reopens rather than ending the run.
            if (sql[i + 1] === quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    return sql.length;
}

/**
 * Whether the quote at `at` opens a Postgres `E'…'` string, which is the one
 * there that reads backslashes.
 *
 * The `E` has to be a word of its own -- `type'x'` is not one and neither is
 * anything ending in an `e` -- or an ordinary identifier before a literal would
 * silently switch the escaping rules on.
 */
function isEscapeStringOpener(sql: string, at: number): boolean {
    const prev = sql[at - 1];
    if (prev !== 'e' && prev !== 'E') return false;
    const before = sql[at - 2];
    return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

/**
 * The opening tag of a dollar-quoted string, or null where a `$` means
 * something else.
 *
 * The tag must be `$$` or `$name$` with `name` starting on a letter, which is
 * what keeps a positional parameter (`$1`) and a `$` inside an identifier from
 * opening a run that swallows the rest of the file.
 */
function dollarTagAt(sql: string, at: number): string | null {
    return DOLLAR_TAG.exec(sql.slice(at))?.[0] ?? null;
}

const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

function pastDollarQuoted(sql: string, open: number, tag: string): number {
    const close = sql.indexOf(tag, open + tag.length);
    return close === -1 ? sql.length : close + tag.length;
}
