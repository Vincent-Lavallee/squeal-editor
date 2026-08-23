/**
 * An answer, rendered.
 *
 * This panel drew nothing but fenced code for a while, on the reading that *the
 * only markup that matters in an answer about SQL is the fence*. Using it is
 * what ended that: models format their answers whether or not anything renders
 * them, so what the reader actually got was `| id | name |` rows as raw pipes,
 * `**` around words meant to be bold, and `###` at the head of every section. A
 * transcript full of unrendered syntax is not a plainer transcript — it is a
 * broken one. See `docs/decisions.md`.
 *
 * **It is hand-rolled and deliberately partial.** Not a markdown *dependency*,
 * for the reason that reading was right about: a document renderer brings
 * images, raw HTML and link handling into a chat panel, and a desktop SQL client
 * has no business rendering arbitrary remote content a model asked it to. What
 * is here is the subset models actually emit — headings, emphasis, code, lists,
 * block quotes, rules and tables — and every one of them lands as a styled
 * element from the design system's own tokens.
 *
 * Two things it will not do, both on purpose:
 *
 * - **No raw HTML.** Everything is React elements built from parsed text, so
 *   there is no `dangerouslySetInnerHTML` anywhere and a model cannot put markup
 *   into this app by writing it in an answer.
 * - **No images, and links are text.** A link is rendered as its label followed
 *   by its URL, not as something clickable: the panel is fed by a remote model,
 *   and a one-click path from its output to a browser is a bigger door than this
 *   feature needs.
 *
 * The block parsers themselves live in `markdownBlocks.tsx`, one per shape
 * (fence, rule, heading, table, list, quote, paragraph); this file is only the
 * loop that tries them in order against the current line.
 */

import * as t from '../../common/tokens';
import {
    parseFence,
    parseHeading,
    parseList,
    parseParagraph,
    parseQuote,
    parseRule,
    parseTable,
} from './markdownBlocks.tsx';

const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: t.GAP_SM,
    fontSize: t.TEXT_BODY,
    lineHeight: 1.5,
};

function parseBlocks(text: string): React.ReactNode[] {
    const lines = text.split('\n');
    const blocks: React.ReactNode[] = [];
    const push = (node: React.ReactNode) => blocks.push(<div key={blocks.length}>{node}</div>);
    let i = 0;

    while (i < lines.length) {
        const key = blocks.length;

        const fence = parseFence(lines, i, key);
        if (fence) {
            blocks.push(fence.node);
            i = fence.next;
            continue;
        }
        const rule = parseRule(lines, i, key);
        if (rule) {
            blocks.push(rule.node);
            i = rule.next;
            continue;
        }
        const heading = parseHeading(lines, i);
        if (heading) {
            push(heading.node);
            i = heading.next;
            continue;
        }
        const table = parseTable(lines, i, key);
        if (table) {
            blocks.push(table.node);
            i = table.next;
            continue;
        }
        const list = parseList(lines, i, key);
        if (list) {
            blocks.push(list.node);
            i = list.next;
            continue;
        }
        const quote = parseQuote(lines, i);
        if (quote) {
            push(quote.node);
            i = quote.next;
            continue;
        }

        const paragraph = parseParagraph(lines, i);
        if (paragraph.node) push(paragraph.node);
        i = paragraph.next;
    }

    return blocks;
}

export default function Markdown({ text }: { text: string }) {
    return <div style={wrapperStyle}>{parseBlocks(text)}</div>;
}
