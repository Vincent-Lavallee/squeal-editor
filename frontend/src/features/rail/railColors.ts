import type { ResolvedTheme } from '../../common/theme/theme.ts';
import * as t from '../../common/tokens';

/**
 * How far a connection's tint travels toward the background, for its border,
 * its wash and its active fill. Theme-valued because the active chip pairs its
 * fill with BG *text* (see RailChip) -- on the dark theme that means blending
 * 72% of the way from a near-black ground, which lands on something dark enough
 * for near-white text to sit on top of by contrast with the tint alone. On the
 * light theme the same ratio would land on a pale tint with near-white text
 * sitting on it unreadably, so the active fill goes to full strength instead
 * -- the Radix step-11 tint itself, which is exactly what pairs with BG (white)
 * text there.
 */
export function chipTints(theme: ResolvedTheme): {
    border: number;
    wash: number;
    activeFill: number;
} {
    return theme === 'light'
        ? { border: 0.45, wash: 0.1, activeFill: 1 }
        : { border: 0.3, wash: 0.07, activeFill: 0.72 };
}

/** A connection's tint, blended toward the app's one background. */
export function blendOverBg(fg: string, opacity: number): string {
    return blendOver(fg, t.BG, opacity);
}

export function blendOver(fg: string, bg: string, opacity: number): string {
    return `color-mix(in srgb, ${fg} ${opacity * 100}%, ${bg})`;
}
