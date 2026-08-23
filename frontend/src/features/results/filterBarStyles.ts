import * as t from '../../common/tokens';

/**
 * The tracks, and the two minimums that are load-bearing.
 *
 * **The value box has a floor of its own** (`minmax(120px, 1fr)`, not a bare
 * `1fr`): a `1fr` track is free to shrink to nothing once everything beside it
 * has claimed its minimum, which is what a split pane does -- half the width,
 * the same fixed lead, column, operator, remove and action cells, and whatever
 * is left over goes to the one control you actually type into. It went to a
 * few pixels. A floor means the bar overflows instead, which the container
 * below scrolls.
 *
 * **120px and not more**, because the floor is also what pushes *Search* off
 * the end: every pixel the value box is guaranteed is one the actions cell
 * cannot have, and the action that runs the filter is worth more on screen
 * than a wider box. At 120 both fit across a pane down to about 500px -- half
 * of the smallest window this app is used in -- and below that the bar
 * scrolls rather than either one being crushed.
 *
 * The column and operator minimums are lower than they look because they are
 * `<Select>`s: they show a truncated value at 70px and stay usable, while the
 * value box at 70px does not.
 */
export const GRID_COLUMNS =
    '52px minmax(70px, 150px) minmax(64px, 104px) minmax(120px, 1fr) 26px auto';

export const CONTROL_H = 22;
export const controlStyle: React.CSSProperties = { height: CONTROL_H, fontSize: t.TEXT_BADGE };
export const valueStyle: React.CSSProperties = {
    ...controlStyle,
    fontFamily: t.MONO,
    padding: '0 6px',
};
export const leadStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: CONTROL_H,
    color: t.TEXT_FAINT,
    fontFamily: t.MONO,
    fontSize: t.TEXT_BADGE,
};

/**
 * The add/remove pair. They are glyphs rather than words, so they carry the
 * click target on the glyph's size — a 12px `−` in a 22px box is a dot you aim
 * at. Bigger type, `lineHeight: 1` so it does not push the row's height past the
 * other controls, and the grid track widened to match.
 */
export const iconBtn: React.CSSProperties = {
    height: CONTROL_H,
    padding: '0 5px',
    minWidth: 0,
    fontSize: 15,
    lineHeight: 1,
};

/*
 * Search, and the caret that says where it searches: the editor toolbar's run
 * group, at this bar's control height. One shape rather than two buttons that
 * touch -- the group carries the accent fill and the rounded ends, the halves
 * inside it draw neither, and the divider is 1px of the fill's own foreground
 * where a `--border` grey would read as a gap. See `docs/design-system.md`.
 *
 * The caret is the whole of the attached half here too: the database's name is
 * stated once, in the results bar below, for the reason it is stated in the
 * editor's toolbar rather than inside Run.
 */
export const searchGroup: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'stretch',
    height: CONTROL_H,
    borderRadius: t.RADIUS,
    background: t.ACCENT,
    color: t.ON_ACCENT,
    overflow: 'hidden',
};

export const searchHalf: React.CSSProperties = {
    height: '100%',
    padding: '0 8px',
    border: 'none',
    borderRadius: 0,
    background: 'none',
    color: 'inherit',
};

export const searchDivider: React.CSSProperties = {
    flex: 'none',
    width: 1,
    background: 'color-mix(in srgb, currentColor 35%, transparent)',
};

/**
 * The conjunction select: narrower, unbolded, and a genuine step down in type
 * size from the fields it leads -- not just a smaller box around the same 12px
 * word. It answers one binary question under WHERE, not a value in its own
 * right, so it should read as quieter than the column/operator/value beside it.
 *
 * The 10px is a literal rather than a named token on purpose, the same call
 * `iconBtn`'s 15px makes above: this is the one control in the design system
 * outside the connection rail small enough to want it, and `TEXT_MICRO` is
 * documented as the rail's alone. Reusing it here would be quietly widening
 * that token's meaning instead of deciding to.
 */
export const conjunctionStyle: React.CSSProperties = {
    height: CONTROL_H,
    // It fills its whole track rather than the 46px it took when the browser drew
    // its arrow: the app's caret is a 16px icon, and there is one icon size on
    // purpose. `AND` at 10px plus that mark needs every pixel the lead has, so the
    // gap goes and the padding is the little that is left.
    width: '100%',
    gap: 0,
    padding: '0 0 0 3px',
    fontSize: 10,
    fontWeight: 400,
    color: t.TEXT_FAINT,
};

export const barStyle: React.CSSProperties = {
    display: 'grid',
    gap: t.GAP_XS,
    alignItems: 'center',
    flex: 'none',
    padding: `4px ${t.GAP_LG}px`,
    borderBottom: `1px solid ${t.BORDER}`,
    fontSize: t.TEXT_BADGE,
    color: t.TEXT_MUTED,
    // Narrower than its own tracks want to be -- a split pane -- and the bar
    // scrolls sideways rather than crushing the value box to nothing. It is
    // still one line per condition: this is the same refusal to grow a second
    // row of buttons, answered for the width instead of the height.
    overflowX: 'auto',
    scrollbarWidth: 'none',
};
