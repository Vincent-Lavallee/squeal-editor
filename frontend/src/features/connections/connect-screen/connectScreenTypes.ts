import type { SavedConnection, Workspace } from '../../../../../shared/protocol/index.ts';

export type Screen =
    | { view: 'workspaces' }
    | { view: 'workspaceNew' }
    | { view: 'workspaceEdit'; workspace: Workspace }
    | { view: 'list'; workspaceId: string }
    | { view: 'new'; workspaceId: string }
    | { view: 'edit'; connection: SavedConnection }
    | { view: 'password'; connection: SavedConnection };
