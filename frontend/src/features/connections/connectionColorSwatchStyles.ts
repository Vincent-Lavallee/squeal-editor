import * as t from '../../common/tokens';

export const hiddenRadio: React.CSSProperties = {
    position: 'absolute',
    opacity: 0,
    pointerEvents: 'none',
};
// `padding: 0` is load-bearing on the `<button>` form of this: a UA-default
// padding shrinks the content box the tile centres its glyph in, so the mark
// lands off-centre in a box that still measures 32px.
export const swatchTile: React.CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 32,
    height: 32,
    padding: 0,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
    cursor: 'pointer',
};
export const swatchDot: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: t.RADIUS_PILL,
};
// Icons carry their size inline, from the one token. The set draws at 24px by
// default, which is what overflowed this tile.
export const iconGlyph: React.CSSProperties = { flex: 'none', width: t.ICON, height: t.ICON };
