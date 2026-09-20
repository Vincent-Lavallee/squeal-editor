import type { SqlDialect } from '../../../../shared/protocol/index.ts';

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
export interface Lexis {
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
    /** SQL Server's `[name]`, doubling `]` to escape one inside the name. SQLite accepts the same form. */
    bracketIdentifiers: boolean;
    /**
     * A bare `BEGIN … END` (a trigger/procedure/function body, an `IF`/`WHILE`
     * block, `BEGIN TRY … END TRY`) is how SQL Server and SQLite both carry
     * semicolons through a routine body instead of MySQL's `DELIMITER` or
     * Postgres' dollar-quoting -- there is no other in-language quoting for one
     * on either engine. `CASE … END` has no matching `BEGIN` and is tracked the
     * same way purely to keep the count balanced, since an unrelated `CASE`
     * inside a real block would otherwise close it early; `BEGIN
     * TRANSACTION/TRAN/WORK` opens no block at all and is excluded, since it is
     * closed by `COMMIT`/`ROLLBACK`, never `END`.
     */
    blockBodies: boolean;
}

export const LEXIS: Record<SqlDialect, Lexis> = {
    mysql: {
        hashComments: true,
        dashCommentNeedsSpace: true,
        nestedBlockComments: false,
        backslashEscapes: true,
        escapeStrings: false,
        dollarQuotes: false,
        delimiterDirective: true,
        bracketIdentifiers: false,
        blockBodies: false,
    },
    pgsql: {
        hashComments: false,
        dashCommentNeedsSpace: false,
        nestedBlockComments: true,
        backslashEscapes: false,
        escapeStrings: true,
        dollarQuotes: true,
        delimiterDirective: false,
        bracketIdentifiers: false,
        blockBodies: false,
    },
    // The shared fallback for every engine with no grammar of its own in Monaco
    // -- SQLite and SQL Server today. Both accept `[name]` (SQLite for MS Access
    // compatibility, SQL Server as its native form) and both write a routine
    // body as bare `BEGIN … END`, so both flags are on for the dialect as a
    // whole rather than split further -- there is no per-engine signal this
    // splitter is handed to split it on, only the dialect.
    sql: {
        hashComments: false,
        dashCommentNeedsSpace: false,
        nestedBlockComments: false,
        backslashEscapes: false,
        escapeStrings: false,
        dollarQuotes: false,
        delimiterDirective: false,
        bracketIdentifiers: true,
        blockBodies: true,
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
export const DELIMITER_DIRECTIVE = /^delimiter[ \t]+(\S+)[^\n]*(?:\n|$)/i;

export const isBlank = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);

/** Whether only whitespace stands between `at` and the start of its line. */
export function startsLine(sql: string, at: number): boolean {
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
export function unquoteDelimiter(token: string): string {
    const quote = token[0];
    const quoted =
        (quote === '"' || quote === "'" || quote === '`') &&
        token.length > 1 &&
        token.endsWith(quote);
    return quoted ? token.slice(1, -1) : token;
}

export const pastLine = (sql: string, at: number): number => {
    const newline = sql.indexOf('\n', at);
    return newline === -1 ? sql.length : newline + 1;
};

export function pastBlockComment(sql: string, open: number, nested: boolean): number {
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

export function pastQuoted(
    sql: string,
    open: number,
    quote: string,
    backslashEscapes: boolean,
): number {
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
export function isEscapeStringOpener(sql: string, at: number): boolean {
    const prev = sql[at - 1];
    if (prev !== 'e' && prev !== 'E') return false;
    const before = sql[at - 2];
    return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * The opening tag of a dollar-quoted string, or null where a `$` means
 * something else.
 *
 * The tag must be `$$` or `$name$` with `name` starting on a letter, which is
 * what keeps a positional parameter (`$1`) and a `$` inside an identifier from
 * opening a run that swallows the rest of the file.
 */
export function dollarTagAt(sql: string, at: number): string | null {
    return DOLLAR_TAG.exec(sql.slice(at))?.[0] ?? null;
}

export function pastDollarQuoted(sql: string, open: number, tag: string): number {
    const close = sql.indexOf(tag, open + tag.length);
    return close === -1 ? sql.length : close + tag.length;
}

/**
 * `[name]`, past its closing `]` -- the one quote form here whose open and
 * close characters differ, so it cannot share `pastQuoted` with the other
 * three. A doubled `]]` is how a literal `]` inside the name is escaped,
 * closes and reopens rather than ending the run, the same shape every other
 * quote's doubled-close escape already takes.
 */
export function pastBracketQuoted(sql: string, open: number): number {
    let i = open + 1;
    while (i < sql.length) {
        if (sql[i] === ']') {
            if (sql[i + 1] === ']') {
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
 * Whether `word` sits at `i`, spelled in any case, as a word of its own -- not
 * part of a longer identifier on either side. Used for `BEGIN`/`END`/`CASE`,
 * which are keywords everywhere they are legal and ordinary letters nowhere
 * else, so this is what keeps `beginner` or `endpoint` from being read as one.
 */
export function keywordAt(sql: string, i: number, word: string): boolean {
    if (sql.slice(i, i + word.length).toLowerCase() !== word) return false;
    const before = sql[i - 1];
    const after = sql[i + word.length];
    const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);
    return !isWordChar(before) && !isWordChar(after);
}

const TRANSACTION_WORDS = ['transaction', 'tran', 'work'];

/**
 * Whether the word starting at `i` (skipping whitespace to reach it) is
 * `TRANSACTION`/`TRAN`/`WORK` -- what tells a bare `BEGIN` that opens no
 * block (`BEGIN TRANSACTION`, closed by `COMMIT`/`ROLLBACK`, never `END`)
 * apart from one that does (a trigger/procedure/function body, `BEGIN TRY`,
 * an `IF`/`WHILE` block).
 */
export function beginOpensTransaction(sql: string, i: number): boolean {
    let j = i;
    while (j < sql.length && isBlank(sql[j])) j += 1;
    return TRANSACTION_WORDS.some((word) => keywordAt(sql, j, word));
}
