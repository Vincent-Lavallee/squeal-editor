import type { SavedConnection } from '../../../../shared/protocol/index.ts';
import type { ProfileStatus } from '../../store/awsSignInSlice.ts';

/** Facts every row in the list needs, none of which is that row's own to own. */
export interface ConnectionRowState {
    connectingId: string | null;
    connectingPhase: string | null;
    openIds: Set<string>;
    busy: boolean;
    hoveredId: string | null;
    confirmingId: string | null;
    focusedId: string | null;
    blockedBy: (c: SavedConnection) => ProfileStatus | null;
}

/** What a row can ask the list to do. */
export interface ConnectionRowHandlers {
    onPick: (c: SavedConnection) => void;
    onEdit: (c: SavedConnection) => void;
    onHoverChange: (id: string, hovering: boolean) => void;
    onFocusChange: (id: string, focused: boolean) => void;
    onArmDelete: (id: string) => void;
    onConfirmDelete: (id: string) => void;
}
