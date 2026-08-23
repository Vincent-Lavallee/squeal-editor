import * as t from '../../common/tokens';

/**
 * One half of an expanded call.
 *
 * The result is capped rather than scrolled: a `getRelationships` answer is tens
 * of kilobytes of JSON, and a box that long buries the conversation it is
 * supposed to annotate. What is worth reading is at the front.
 */
export default function Snippet({
    label,
    text,
    tone = 'normal',
}: {
    label: string;
    text: string;
    tone?: 'normal' | 'error';
}) {
    const CAP = 2000;
    const shown =
        text.length > CAP ? `${text.slice(0, CAP)}\n… ${text.length - CAP} more characters` : text;

    return (
        <div>
            <div
                style={{
                    color: t.TEXT_FAINT,
                    fontSize: t.TEXT_LABEL,
                    letterSpacing: t.TRACKING_LABEL,
                    textTransform: 'uppercase',
                }}
            >
                {label}
            </div>
            <pre
                style={{
                    maxHeight: 220,
                    margin: 0,
                    overflow: 'auto',
                    color: tone === 'error' ? t.RED_TEXT : t.TEXT_MUTED,
                    fontFamily: t.MONO,
                    fontSize: t.TEXT_BADGE,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {shown}
            </pre>
        </div>
    );
}
