import * as t from '../../../common/tokens';

/** MySQL's `COLUMN_TYPE` and Postgres' `format_type` both answer bare `json`/`jsonb`
 *  for the type -- see `docs/extension.md`, *Listing a table's columns* -- so a
 *  case-insensitive match on the engine's own string is enough and needs no
 *  per-engine case. SQLite has no JSON type, so this never fires there. */
export const isJsonType = (dataType: string | undefined): boolean => {
    if (!dataType) return false;
    const lower = dataType.toLowerCase();
    return lower === 'json' || lower === 'jsonb';
};

export const iconSvg = { flex: 'none', width: 16, height: 16 };

/** The controls in the error box's corner. They wear the box's red, not the chrome's gray. */
export const errorAction: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    padding: 0,
    border: 'none',
    borderRadius: t.RADIUS,
    background: 'transparent',
    color: t.RED_TEXT,
    cursor: 'pointer',
};

/**
 * The sort mark in a header: the arrow in force, or the faint hover hint.
 *
 * One shape for both so the two occupy the *same* slot — the hint is hidden
 * rather than unrendered (see `residual.css`), so a header keeps its width
 * whether it is sorted, hovered or neither, and clicking one never shifts the
 * columns beside it.
 */
export const sortMark = (color: string): React.CSSProperties => ({
    flex: 'none',
    width: 14,
    height: 14,
    display: 'inline-block',
    verticalAlign: 'text-bottom',
    marginLeft: t.GAP_XS,
    color,
});

/**
 * What a click on this header will do, named rather than left to be discovered.
 *
 * It says the *next* state, not the current one -- the arrow already shows where
 * the column stands, so a tooltip repeating it would be the second place saying
 * one thing. "Remove sort" is the third step being spelled out, since a cycle
 * whose last click undoes it is the part nobody guesses from two arrows.
 */
export const sortTitle = (column: string, sortedBy: 'asc' | 'desc' | null): string =>
    sortedBy === null
        ? `Sort by ${column}`
        : sortedBy === 'asc'
          ? `Sort by ${column}, descending`
          : 'Remove sort';

/** The weight of the line the selected rectangle is outlined in. */
export const SELECT_EDGE = '1.5px';

/**
 * A column narrower than this cannot be grabbed again -- the handle would have
 * no header left to sit on -- so the drag stops here rather than at zero.
 */
export const MIN_COL_W = 48;
/**
 * The cap a column keeps until it is dragged. Long text is ellipsised at this
 * width so one `description` cannot push every other column off screen; a drag
 * replaces it in both directions, which is the whole of what "resizable" buys.
 */
export const DEFAULT_MAX_COL_W = 380;

/**
 * The grab strip on a header's right edge -- see `residual.css` for the line it
 * lights up. Wholly inside the header rather than straddling its border: the
 * header clips (it ellipsises long names), so anything hanging past the edge is
 * simply cut off and the target would be half the width it claims.
 */
export const resizeHandle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: '100%',
    zIndex: 2,
    cursor: 'col-resize',
    userSelect: 'none',
};

/**
 * A column's width as three properties rather than one.
 *
 * The grid is an auto-layout table, where `width` alone is a suggestion the
 * browser is free to overrule with the content's own minimum -- and the content
 * is `nowrap`, so that minimum is the whole of the longest value. `maxWidth` is
 * what actually holds the column at the dragged size (the same property that
 * caps an unsized column at `DEFAULT_MAX_COL_W`), and `minWidth` is what stops
 * a short column from collapsing under it.
 */
export const columnSize = (width: number | undefined): React.CSSProperties =>
    width === undefined
        ? { maxWidth: DEFAULT_MAX_COL_W }
        : { width, minWidth: width, maxWidth: width };

export const gridTableStyle: React.CSSProperties = {
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontFamily: t.MONO,
    fontSize: t.TEXT_BODY,
    whiteSpace: 'nowrap',
};
// `userSelect: 'none'` is what makes click-and-drag select cells instead of
// sweeping the browser's own text selection across them; see `docs/decisions.md`
// for the tradeoff it accepts. The cell editor's input opts back in.
// No width of its own: every column carries its own through `columnSize`, so
// the cap and the dragged size are one property set in one place.
export const cellBase: React.CSSProperties = {
    height: t.ROW_H_DENSE,
    padding: '0 10px',
    borderRight: `1px solid ${t.BORDER}`,
    borderBottom: `1px solid ${t.BORDER}`,
    textAlign: 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    userSelect: 'none',
};
export const thStyle: React.CSSProperties = {
    ...cellBase,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: t.BG,
    color: t.TEXT_MUTED,
    fontWeight: 600,
    fontSize: t.TEXT_BADGE,
};
export const gutterStyle: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 1,
    background: t.BG,
    color: t.TEXT_FAINT,
    textAlign: 'right',
    userSelect: 'none',
    fontSize: t.TEXT_BADGE,
    height: t.ROW_H_DENSE,
    padding: '0 10px',
    borderRight: `1px solid ${t.BORDER}`,
    borderBottom: `1px solid ${t.BORDER}`,
};
export const gutterHeadStyle: React.CSSProperties = {
    ...gutterStyle,
    zIndex: 2,
    fontWeight: 600,
    top: 0,
};
