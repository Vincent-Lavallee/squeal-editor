/* eslint-disable react-refresh/only-export-components -- these are block
   parsers that happen to build JSX, not components; nothing here is mounted
   directly, so fast refresh has nothing to preserve. */
import * as t from '../../../common/tokens';
import { cellStyle, codeBlock } from './markdownBlockStyles.ts';
import { inline } from './markdownInline.tsx';

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The `|---|:--:|` line under a table's head, which is what makes it a table at all. */
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;

const STARTS_BLOCK = (line: string) =>
    line.trim() === '' ||
    FENCE.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    TABLE_ROW.test(line);

/** `| a | b |` to `['a', 'b']`, tolerating the optional outer pipes. */
const cells = (row: string): string[] =>
    row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim());

interface Parsed {
    node: React.ReactNode;
    next: number;
}

/**
 * A fence, and an unterminated one runs to the end rather than swallowing the
 * rest of the answer into nothing: a model that stops mid-block should still
 * show what it wrote.
 */
export function parseFence(lines: string[], i: number, key: number): Parsed | null {
    if (!FENCE.test(lines[i]!)) return null;
    const body: string[] = [];
    let next = i + 1;
    while (next < lines.length && !FENCE.test(lines[next]!)) body.push(lines[next++]!);
    next += 1;
    return {
        node: (
            <pre key={key} style={codeBlock}>
                {body.join('\n')}
            </pre>
        ),
        next,
    };
}

export function parseRule(lines: string[], i: number, key: number): Parsed | null {
    if (!RULE.test(lines[i]!)) return null;
    return {
        node: (
            <hr
                key={key}
                style={{ margin: 0, border: 'none', borderTop: `1px solid ${t.BORDER}` }}
            />
        ),
        next: i + 1,
    };
}

export function parseHeading(lines: string[], i: number): Parsed | null {
    const heading = HEADING.exec(lines[i]!);
    if (!heading) return null;
    // One step of weight and size, not six: this is a chat answer, and a
    // six-level hierarchy in a panel this narrow is typography for a document
    // nobody is reading.
    const large = heading[1]!.length <= 2;
    return {
        node: (
            <div
                style={{
                    marginTop: t.GAP_SM,
                    color: t.TEXT,
                    fontSize: large ? t.TEXT_TITLE : t.TEXT_BODY,
                    fontWeight: 600,
                }}
            >
                {inline(heading[2]!, `h${i}`)}
            </div>
        ),
        next: i + 1,
    };
}

/**
 * A table needs its `|---|` rule on the second line. Without it a lone row of
 * pipes is just a sentence with pipes in it.
 */
export function parseTable(lines: string[], i: number, key: number): Parsed | null {
    if (!(TABLE_ROW.test(lines[i]!) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)))
        return null;

    const head = cells(lines[i]!);
    let next = i + 2;
    const body: string[][] = [];
    while (next < lines.length && TABLE_ROW.test(lines[next]!)) body.push(cells(lines[next++]!));

    return {
        // Its own scroller: a result shaped like ten columns must not push the
        // conversation sideways. Same rule the tool-call snippets follow.
        node: (
            <div key={key} style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: t.TEXT_BADGE }}>
                    <thead>
                        <tr>
                            {head.map((cell, c) => (
                                <th
                                    key={c}
                                    style={{ ...cellStyle, color: t.TEXT_MUTED, fontWeight: 600 }}
                                >
                                    {inline(cell, `th${c}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {body.map((row, r) => (
                            <tr key={r}>
                                {row.map((cell, c) => (
                                    <td key={c} style={cellStyle}>
                                        {inline(cell, `td${r}-${c}`)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        ),
        next,
    };
}

export function parseList(lines: string[], i: number, key: number): Parsed | null {
    if (!(BULLET.test(lines[i]!) || NUMBERED.test(lines[i]!))) return null;

    const numbered = NUMBERED.test(lines[i]!);
    const items: string[] = [];
    let next = i;
    while (next < lines.length) {
        const bullet = BULLET.exec(lines[next]!);
        const number = NUMBERED.exec(lines[next]!);
        if (numbered && number) items.push(number[2]!);
        else if (!numbered && bullet) items.push(bullet[1]!);
        else break;
        next += 1;
    }
    const List = numbered ? 'ol' : 'ul';
    return {
        node: (
            <List
                key={key}
                style={{
                    margin: 0,
                    paddingLeft: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: t.GAP_XS,
                }}
            >
                {items.map((item, n) => (
                    <li key={n}>{inline(item, `li${n}`)}</li>
                ))}
            </List>
        ),
        next,
    };
}

export function parseQuote(lines: string[], i: number): Parsed | null {
    if (!QUOTE.test(lines[i]!)) return null;
    const quoted: string[] = [];
    let next = i;
    while (next < lines.length && QUOTE.test(lines[next]!))
        quoted.push(QUOTE.exec(lines[next++]!)![1]!);
    return {
        node: (
            <div
                style={{
                    paddingLeft: t.GAP,
                    borderLeft: `2px solid ${t.BORDER_STRONG}`,
                    color: t.TEXT_MUTED,
                }}
            >
                {inline(quoted.join(' '), `q${next}`)}
            </div>
        ),
        next,
    };
}

/**
 * A paragraph runs to the next blank line or the next block that announces
 * itself. Single newlines inside it are kept, because a model breaking a line
 * usually meant to. Always matches -- it is the fallback -- so `node` is null
 * only for the blank line it also has to step over.
 */
export function parseParagraph(
    lines: string[],
    i: number,
): { node: React.ReactNode | null; next: number } {
    const paragraph: string[] = [];
    let next = i;
    while (next < lines.length && !STARTS_BLOCK(lines[next]!)) paragraph.push(lines[next++]!);

    if (!paragraph.length) return { node: null, next: next + 1 };
    return {
        node: (
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {inline(paragraph.join('\n'), `p${next}`)}
            </span>
        ),
        next,
    };
}
