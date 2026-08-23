import * as t from '../../common/tokens';

/**
 * `code`, **bold**, *italic* and [links], in one pass.
 *
 * One regular expression with alternatives rather than four nested passes,
 * because the alternatives have to compete: `**a**` must not be read as two
 * italics, and neither may fire *inside* a code span. Code is first in the
 * alternation for that reason -- the leftmost-longest match wins, so a backtick
 * run swallows whatever is inside it before emphasis is considered.
 */
const INLINE =
    /(`+)([\s\S]*?)\1|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inline(text: string, keyPrefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;

    INLINE.lastIndex = 0;
    while ((match = INLINE.exec(text)) !== null) {
        if (match.index > last) out.push(text.slice(last, match.index));
        const key = `${keyPrefix}-${match.index}`;
        const [
            ,
            ,
            code,
            boldStar,
            boldUnderscore,
            italicStar,
            italicUnderscore,
            linkText,
            linkHref,
        ] = match;

        if (code !== undefined) {
            out.push(
                <code
                    key={key}
                    style={{
                        padding: '1px 4px',
                        borderRadius: t.RADIUS,
                        background: t.HOVER,
                        fontFamily: t.MONO,
                        fontSize: '0.92em',
                    }}
                >
                    {code.trim()}
                </code>,
            );
        } else if (boldStar ?? boldUnderscore) {
            out.push(
                <strong key={key} style={{ fontWeight: 600 }}>
                    {boldStar ?? boldUnderscore}
                </strong>,
            );
        } else if (italicStar ?? italicUnderscore) {
            out.push(<em key={key}>{italicStar ?? italicUnderscore}</em>);
        } else if (linkText) {
            // The label, then the address in muted text. Not an anchor -- see the
            // header: nothing a model writes gets a click that leaves the app.
            out.push(
                <span key={key}>
                    {linkText} <span style={{ color: t.TEXT_FAINT }}>({linkHref})</span>
                </span>,
            );
        }
        last = match.index + match[0].length;
    }

    if (last < text.length) out.push(text.slice(last));
    return out;
}
