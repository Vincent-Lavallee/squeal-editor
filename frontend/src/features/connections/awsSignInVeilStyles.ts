import type { CSSProperties } from 'react';

import * as t from '../../common/tokens';

/*
 * Where the frost is at full strength and where it lets go. It is deepest under
 * the chip at the leading edge and thins away across the row, so the server line
 * and the engine badge stay legible under the thin end of it.
 *
 * The leading feather is short and does a different job from the long ramp out:
 * the pane's own edge falls mid-row, next to the colour strip, and a sheet of
 * frost cut off square there reads as a rectangle pasted over the row rather
 * than as glass lying on it.
 *
 * The black is not a colour and is not a token's business: a mask reads alpha
 * and nothing else, so these stops are the shape of the fade, written down.
 */
const FROST_RAMP =
    'linear-gradient(90deg, transparent 0%, #000 6%, #000 40%, #000000a6 64%, transparent 100%)';
const FROST_EASE = '0.18s ease-out';

/**
 * The glass itself, and nothing else: it carries the blur, the wash and the
 * hairlines, and no text ever rides on it.
 *
 * `maskImage` is what makes a real blur affordable here. Frost and wash both
 * fade in from the leading edge, so they thicken toward the label and never
 * reach the name they would otherwise make unreadable. A mask rather than a
 * `clipPath` -- a clip takes the uncovered half out of the hit target too, and
 * the whole pane is the click.
 *
 * The fade lives on this element rather than on the pane around it because an
 * *ancestor* mid-opacity isolates the backdrop: the blur would sample an empty
 * group for the length of the transition and snap in at the end.
 */
export function frostStyle(shown: boolean): CSSProperties {
    return {
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(180deg, ${t.VEIL_SHEEN}, transparent 60%), linear-gradient(90deg, ${t.VEIL_DEEP} 30%, ${t.VEIL})`,
        backdropFilter: `blur(${t.VEIL_BLUR}px) saturate(1.3)`,
        WebkitBackdropFilter: `blur(${t.VEIL_BLUR}px) saturate(1.3)`,
        maskImage: FROST_RAMP,
        WebkitMaskImage: FROST_RAMP,
        borderTop: `1px solid ${t.VEIL_EDGE}`,
        borderBottom: `1px solid ${t.VEIL_EDGE}`,
        opacity: shown ? 1 : 0,
        transition: `opacity ${FROST_EASE}`,
        pointerEvents: 'none',
    };
}

export function paneStyle(shown: boolean): CSSProperties {
    return {
        position: 'absolute',
        inset: 0,
        display: 'grid',
        // Against the leading edge, where the frost is deepest -- the chip is the
        // one thing on this pane that is read, so it sits at the end the eye starts
        // from rather than the one it has to travel to.
        placeItems: 'center start',
        padding: '0 10px',
        border: 'none',
        background: 'none',
        font: 'inherit',
        fontSize: t.TEXT_BADGE,
        fontWeight: 500,
        // Tracks the reveal or an invisible pane eats the row's clicks.
        pointerEvents: shown ? 'auto' : 'none',
    };
}

/*
 * How whatever the pane has to say sits on the glass, and how it arrives:
 * `position` to paint over the frost, which is positioned, and in from the
 * leading edge a beat behind the glass it lands on.
 *
 * A ground of its own is not decoration. The label is the one thing here that
 * is *not* masked -- it has to stay readable whatever the frost under it is
 * doing -- so it needs one wherever it falls on the row's own text.
 *
 * What that ground looks like is the shape grammar and nothing else: the
 * sign-in is a button, so it is `RADIUS` at `BUTTON_H`, which also lines it up
 * with the row's own Edit; the missing-profile line is a state, so it is a
 * pill. Neither is a `<Button>` or a `<Badge>`, because the pane itself is the
 * `<button>` and one cannot contain the other -- the tab strip's constraint,
 * one row down.
 */
export function chipStyle(shown: boolean): CSSProperties {
    return {
        position: 'relative',
        overflow: 'hidden',
        // Never past the frost. The chip is opaque wherever it lands, so one wide
        // enough to reach the thin end of the pane sits on row text that is still
        // sharp, which is the collision the mask was chosen to avoid.
        maxWidth: '72%',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        transform: shown ? 'none' : 'translateX(-6px)',
        transition: `opacity ${FROST_EASE}, transform ${FROST_EASE}`,
    };
}
