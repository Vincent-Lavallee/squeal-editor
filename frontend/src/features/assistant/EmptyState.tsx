import { AssistantIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

/**
 * A conversation with nothing in it yet.
 *
 * Centred rather than pinned to the top, and given its glyph, because an empty
 * pane reads as *broken* when its only content is two sentences hanging in the
 * top-left corner. The words are unchanged; what changed is that they are
 * arranged like an invitation rather than like an error nobody styled.
 *
 * The mark is `--text-faint` and the copy steps down from `--text` to
 * `--text-muted`: one background, structure from spacing and weight, no card
 * around it. Anything boxed here would be the "lighter surface" rule 1 has no
 * room for.
 */
export default function EmptyState() {
    return (
        <div
            data-testid="ai-empty"
            style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: t.GAP,
                padding: `${t.GAP_XL}px ${t.GAP_XL}px 15%`,
                textAlign: 'center',
            }}
        >
            <AssistantIcon
                style={{ flex: 'none', width: 28, height: 28, color: t.TEXT_FAINT }}
                aria-hidden="true"
            />
            <div style={{ color: t.TEXT, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                Ask about the database you are connected to.
            </div>
            <div
                style={{
                    maxWidth: 380,
                    color: t.TEXT_MUTED,
                    fontSize: t.TEXT_BODY,
                    lineHeight: 1.5,
                }}
            >
                It can read your schema, your open tabs and the error on screen. It asks before
                running anything or changing a tab.
            </div>
        </div>
    );
}
