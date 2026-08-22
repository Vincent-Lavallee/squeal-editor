import type { WorkspaceIconId } from '../../../../shared/protocol/index.ts';
import {
    BuildingIcon,
    CartIcon,
    ChartIcon,
    CubeIcon,
    FlaskIcon,
    GlobeIcon,
    LeafIcon,
    RocketIcon,
    StackIcon,
} from './icons.ts';

type Glyph = typeof StackIcon;

/**
 * The set a workspace's mark is picked from.
 *
 * This is a lookup, which `icons.ts` says not to build -- and the reason that
 * rule exists does not reach this file. It forbids a lookup *over the icon set*:
 * `@remixicon/react` is a 2.4MB barrel, and a `Record` keyed over it, or a
 * `export *`, is what makes all ~3000 glyphs reachable and ships them. This is a
 * lookup over nine glyphs already imported by name, so the bundle holds exactly
 * the nine -- which is the point, since every one of them is pickable.
 *
 * A lookup is unavoidable here for a reason the chrome's icons never have: a
 * workspace's icon is *data*. It is chosen by the user, stored as an id and read
 * back, so something has to turn that id into a drawing, and the picker has to
 * enumerate what may be chosen. `TableIcon` has neither problem -- the code that
 * draws a table knows at compile time that it is drawing a table.
 *
 * The order is the order the picker shows them in, so it is a list rather than a
 * `Record`: the id-to-glyph map falls out of it, but an object's key order would
 * be carrying the layout by accident.
 */
export const WORKSPACE_ICONS: { id: WorkspaceIconId; Glyph: Glyph }[] = [
    { id: 'stack', Glyph: StackIcon },
    { id: 'cube', Glyph: CubeIcon },
    { id: 'rocket', Glyph: RocketIcon },
    { id: 'flask', Glyph: FlaskIcon },
    { id: 'building', Glyph: BuildingIcon },
    { id: 'cart', Glyph: CartIcon },
    { id: 'chart', Glyph: ChartIcon },
    { id: 'globe', Glyph: GlobeIcon },
    { id: 'leaf', Glyph: LeafIcon },
];

/** What a new workspace wears until the user picks otherwise. */
export const DEFAULT_WORKSPACE_ICON: WorkspaceIconId = 'stack';

/**
 * Falls back rather than throwing: the id is data from a file on disk, and a
 * store written by a newer version -- or edited by hand -- must not blank the
 * screen over a mark.
 */
export const workspaceGlyph = (id: WorkspaceIconId): Glyph =>
    WORKSPACE_ICONS.find((i) => i.id === id)?.Glyph ?? StackIcon;
