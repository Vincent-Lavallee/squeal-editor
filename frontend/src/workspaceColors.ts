import type { WorkspaceColorId } from '../../shared/protocol.ts';

/**
 * The palette a workspace's colour is picked from.
 *
 * This is a lookup, the same kind `workspaceIcons.ts` explains is legitimate: the
 * value is *data* -- the user picks it, it is stored as an id and read back -- so
 * something has to turn the id into a swatch, and the picker has to enumerate what
 * may be chosen. The code that colours a status badge knows its hue at compile
 * time; a workspace's does not exist until the user chooses it.
 *
 * It maps each id to a `var(--ws-*)` *reference*, not a hex: the hex lives in
 * `tokens.css`, the one place a colour is written, and the extension and Monaco
 * both parse tokens -- so this file names the token and never the colour. That is
 * the same discipline as `--syntax-keyword: var(--accent)`.
 *
 * The order is the picker's layout, so it is a list rather than a `Record`: the
 * id-to-token map falls out of it, but an object's key order would carry the
 * layout by accident. Same argument as `WORKSPACE_ICONS`.
 */
export const WORKSPACE_COLORS: { id: WorkspaceColorId; token: string }[] = [
  { id: 'slate', token: 'var(--ws-slate)' },
  { id: 'blue', token: 'var(--ws-blue)' },
  { id: 'cyan', token: 'var(--ws-cyan)' },
  { id: 'green', token: 'var(--ws-green)' },
  { id: 'amber', token: 'var(--ws-amber)' },
  { id: 'orange', token: 'var(--ws-orange)' },
  { id: 'red', token: 'var(--ws-red)' },
  { id: 'pink', token: 'var(--ws-pink)' },
  { id: 'purple', token: 'var(--ws-purple)' },
];

/** The neutral swatch a new workspace wears until the user picks otherwise. */
export const DEFAULT_WORKSPACE_COLOR: WorkspaceColorId = 'slate';

/**
 * Falls back rather than throwing: the id is data from a file on disk, and a
 * store written by a newer version -- or edited by hand -- must not blank a
 * workspace's mark over a colour it does not recognise.
 */
export const workspaceColor = (id: WorkspaceColorId): string =>
  WORKSPACE_COLORS.find((c) => c.id === id)?.token ?? WORKSPACE_COLORS[0]!.token;
