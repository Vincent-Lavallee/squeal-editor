import type { ConnectionColorId } from '../../../../shared/protocol/index.ts';
import * as t from '../tokens';

/**
 * The palette a saved connection's colour is picked from.
 *
 * This is a lookup, the same kind `workspaceIcons.ts` explains is legitimate: the
 * value is *data* — the user picks it, it is stored as an id and read back — so
 * something has to turn the id into a colour, and the picker has to enumerate
 * what may be chosen. The code that colours a status badge knows its hue at
 * compile time; a connection's does not exist until the user chooses it.
 *
 * Each entry holds the hex *value* directly (from tokens.ts) rather than a CSS
 * var reference, so an inline style can consume it without indirection.
 *
 * The order is the picker's layout, so it is a list rather than a `Record`: the
 * id-to-value map falls out of it, but an object's key order would carry the
 * layout by accident. Same argument as `WORKSPACE_ICONS`.
 */
export const CONNECTION_COLORS: { id: ConnectionColorId; value: string }[] = [
  { id: 'slate', value: t.CONN_SLATE },
  { id: 'blue', value: t.CONN_BLUE },
  { id: 'cyan', value: t.CONN_CYAN },
  { id: 'green', value: t.CONN_GREEN },
  { id: 'amber', value: t.CONN_AMBER },
  { id: 'orange', value: t.CONN_ORANGE },
  { id: 'red', value: t.CONN_RED },
  { id: 'pink', value: t.CONN_PINK },
  { id: 'purple', value: t.CONN_PURPLE },
];

/** The neutral swatch a new connection wears until the user picks otherwise. */
export const DEFAULT_CONNECTION_COLOR: ConnectionColorId = 'slate';

/**
 * Falls back rather than throwing: the id is data from a file on disk, and a
 * store written by a newer version — or edited by hand — must not blank a
 * connection's mark over a colour it does not recognise.
 */
export const connectionColor = (id: ConnectionColorId): string =>
  CONNECTION_COLORS.find((c) => c.id === id)?.value ?? CONNECTION_COLORS[0]!.value;
