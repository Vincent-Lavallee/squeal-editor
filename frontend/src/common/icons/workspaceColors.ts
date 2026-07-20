import type { WorkspaceColorId } from '../../../../shared/protocol/index.ts';
import * as t from '../tokens';

/**
 * The palette a workspace's colour is picked from.
 *
 * This is a lookup, the same kind `workspaceIcons.ts` explains is legitimate: the
 * value is *data* — the user picks it, it is stored as an id and read back — so
 * something has to turn the id into a colour, and the picker has to enumerate
 * what may be chosen. The code that colours a status badge knows its hue at
 * compile time; a workspace's does not exist until the user chooses it.
 *
 * Each entry now holds the hex *value* directly (from tokens.ts) rather than a
 * CSS var reference. The old form (`var(--ws-slate)`) relied on CSS custom
 * properties that were consumed by class-based rules; inline styles consume the
 * hex directly, so the indirection through a CSS var is unnecessary.
 *
 * The order is the picker's layout, so it is a list rather than a `Record`: the
 * id-to-value map falls out of it, but an object's key order would carry the
 * layout by accident. Same argument as `WORKSPACE_ICONS`.
 */
export const WORKSPACE_COLORS: { id: WorkspaceColorId; value: string }[] = [
  { id: 'slate', value: t.WS_SLATE },
  { id: 'blue', value: t.WS_BLUE },
  { id: 'cyan', value: t.WS_CYAN },
  { id: 'green', value: t.WS_GREEN },
  { id: 'amber', value: t.WS_AMBER },
  { id: 'orange', value: t.WS_ORANGE },
  { id: 'red', value: t.WS_RED },
  { id: 'pink', value: t.WS_PINK },
  { id: 'purple', value: t.WS_PURPLE },
];

/** The neutral swatch a new workspace wears until the user picks otherwise. */
export const DEFAULT_WORKSPACE_COLOR: WorkspaceColorId = 'slate';

/**
 * Falls back rather than throwing: the id is data from a file on disk, and a
 * store written by a newer version — or edited by hand — must not blank a
 * workspace's mark over a colour it does not recognise.
 */
export const workspaceColor = (id: WorkspaceColorId): string =>
  WORKSPACE_COLORS.find((c) => c.id === id)?.value ?? WORKSPACE_COLORS[0]!.value;
