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
 */

import * as t from '../../common/tokens';

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

/**
 * `code`, **bold**, *italic* and [links], in one pass.
 *
 * One regular expression with alternatives rather than four nested passes,
 * because the alternatives have to compete: `**a**` must not be read as two
 * italics, and neither may fire *inside* a code span. Code is first in the
 * alternation for that reason -- the leftmost-longest match wins, so a backtick
 * run swallows whatever is inside it before emphasis is considered.
 */
const INLINE = /(`+)([\s\S]*?)\1|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;
    const [, , code, boldStar, boldUnderscore, italicStar, italicUnderscore, linkText, linkHref] = match;

    if (code !== undefined) {
      out.push(
        <code key={key} style={{ padding: '1px 4px', borderRadius: t.RADIUS, background: t.HOVER, fontFamily: t.MONO, fontSize: '0.92em' }}>
          {code.trim()}
        </code>
      );
    } else if (boldStar ?? boldUnderscore) {
      out.push(<strong key={key} style={{ fontWeight: 600 }}>{boldStar ?? boldUnderscore}</strong>);
    } else if (italicStar ?? italicUnderscore) {
      out.push(<em key={key}>{italicStar ?? italicUnderscore}</em>);
    } else if (linkText) {
      // The label, then the address in muted text. Not an anchor -- see the
      // header: nothing a model writes gets a click that leaves the app.
      out.push(
        <span key={key}>
          {linkText} <span style={{ color: t.TEXT_FAINT }}>({linkHref})</span>
        </span>
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The `|---|:--:|` line under a table's head, which is what makes it a table at all. */
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;

/** `| a | b |` to `['a', 'b']`, tolerating the optional outer pipes. */
const cells = (row: string): string[] =>
  row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

const codeBlock: React.CSSProperties = {
  margin: 0,
  padding: t.GAP,
  overflowX: 'auto',
  border: `1px solid ${t.BORDER}`,
  borderRadius: t.RADIUS,
  color: t.TEXT,
  fontFamily: t.MONO,
  fontSize: t.TEXT_BADGE,
};

const cellStyle: React.CSSProperties = {
  padding: `4px ${t.GAP_SM}px`,
  border: `1px solid ${t.BORDER}`,
  textAlign: 'left',
  verticalAlign: 'top',
};

export default function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  const push = (node: React.ReactNode) => blocks.push(<div key={blocks.length}>{node}</div>);

  while (i < lines.length) {
    const line = lines[i]!;

    // A fence, and an unterminated one runs to the end rather than swallowing
    // the rest of the answer into nothing: a model that stops mid-block should
    // still show what it wrote.
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i += 1;
      blocks.push(<pre key={blocks.length} style={codeBlock}>{body.join('\n')}</pre>);
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(<hr key={blocks.length} style={{ margin: 0, border: 'none', borderTop: `1px solid ${t.BORDER}` }} />);
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      // One step of weight and size, not six: this is a chat answer, and a
      // six-level hierarchy in a panel this narrow is typography for a document
      // nobody is reading.
      const large = heading[1]!.length <= 2;
      push(
        <div style={{ marginTop: t.GAP_SM, color: t.TEXT, fontSize: large ? t.TEXT_TITLE : t.TEXT_BODY, fontWeight: 600 }}>
          {inline(heading[2]!, `h${i}`)}
        </div>
      );
      i += 1;
      continue;
    }

    // A table needs its `|---|` rule on the second line. Without it a lone row
    // of pipes is just a sentence with pipes in it.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) body.push(cells(lines[i++]!));

      blocks.push(
        // Its own scroller: a result shaped like ten columns must not push the
        // conversation sideways. Same rule the tool-call snippets follow.
        <div key={blocks.length} style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: t.TEXT_BADGE }}>
            <thead>
              <tr>
                {head.map((cell, c) => (
                  <th key={c} style={{ ...cellStyle, color: t.TEXT_MUTED, fontWeight: 600 }}>{inline(cell, `th${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={cellStyle}>{inline(cell, `td${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const numbered = NUMBERED.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const bullet = BULLET.exec(lines[i]!);
        const number = NUMBERED.exec(lines[i]!);
        if (numbered && number) items.push(number[2]!);
        else if (!numbered && bullet) items.push(bullet[1]!);
        else break;
        i += 1;
      }
      const List = numbered ? 'ol' : 'ul';
      blocks.push(
        <List key={blocks.length} style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: t.GAP_XS }}>
          {items.map((item, n) => <li key={n}>{inline(item, `li${n}`)}</li>)}
        </List>
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!);
      push(
        <div style={{ paddingLeft: t.GAP, borderLeft: `2px solid ${t.BORDER_STRONG}`, color: t.TEXT_MUTED }}>
          {inline(quoted.join(' '), `q${i}`)}
        </div>
      );
      continue;
    }

    // A paragraph runs to the next blank line or the next block that announces
    // itself. Single newlines inside it are kept, because a model breaking a
    // line usually meant to.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!;
      const starts =
        next.trim() === '' || FENCE.test(next) || RULE.test(next) || HEADING.test(next) ||
        BULLET.test(next) || NUMBERED.test(next) || QUOTE.test(next) || TABLE_ROW.test(next);
      if (starts) break;
      paragraph.push(next);
      i += 1;
    }
    if (paragraph.length) {
      push(<span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{inline(paragraph.join('\n'), `p${i}`)}</span>);
    } else {
      i += 1;
    }
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM, fontSize: t.TEXT_BODY, lineHeight: 1.5 }}>{blocks}</div>;
}
