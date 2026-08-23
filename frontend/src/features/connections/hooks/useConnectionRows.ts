import { useEffect, useState } from 'react';

import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import { useAwsSignIn, type ProfileStatus } from '../../../store/awsSignInSlice.ts';
import type { ConnectionRowHandlers, ConnectionRowState } from '../savedConnectionRowTypes.ts';

/**
 * Why this row cannot be opened, or null.
 *
 * **Unknown is not blocked.** A profile still being checked, or one nothing
 * has answered for, leaves the row exactly as it was -- gating on "we have not
 * asked yet" would grey out every IAM connection for the first beat after the
 * list appears, which reads as broken rather than as careful.
 */
function blockedByFor(profiles: Record<string, ProfileStatus>) {
    return (c: SavedConnection): ProfileStatus | null => {
        const profile = c.config.iam?.profile;
        const status = profile ? profiles[profile] : undefined;
        return status && status.valid === false ? status : null;
    };
}

/**
 * The hover/focus/confirm-delete state behind every row in the list, and the
 * per-row `blockedBy` lookup that reads it -- split out of `SavedConnectionList`
 * purely for length.
 */
export function useConnectionRows(args: {
    connectingId: string | null;
    connectingPhase: string | null;
    openIds: Set<string>;
    busy: boolean;
    connections: SavedConnection[];
    onPick: (c: SavedConnection) => void;
    onEdit: (c: SavedConnection) => void;
    onDelete: (id: string) => void;
}): { state: ConnectionRowState; handlers: ConnectionRowHandlers } {
    const { connectingId, connectingPhase, openIds, busy, connections, onPick, onEdit, onDelete } =
        args;
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    /** Which row holds focus, so a hover-revealed pane is reachable by keyboard. */
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const { profiles, check } = useAwsSignIn();

    /*
     * Every IAM profile this list draws, asked about the moment the list is drawn
     * -- not when a row is clicked. Whether a connection can be opened at all is a
     * fact about the row, so it belongs on the row before anyone reaches for it;
     * finding out on the click is what made this a failure instead of a state.
     *
     * Distinct profiles, because several connections commonly share one and the
     * answer is the profile's. The thunk's own `condition` is what stops this
     * re-asking on every render -- see `checkAwsCredentials`.
     */
    const iamProfiles = [
        ...new Set(connections.map((c) => c.config.iam?.profile).filter((p): p is string => !!p)),
    ];
    const profileKey = iamProfiles.join(' ');
    useEffect(() => {
        for (const profile of iamProfiles) check(profile);
    }, [profileKey, profiles, check]);

    const state: ConnectionRowState = {
        connectingId,
        connectingPhase,
        openIds,
        busy,
        hoveredId,
        confirmingId,
        focusedId,
        blockedBy: blockedByFor(profiles),
    };
    const handlers: ConnectionRowHandlers = {
        onPick,
        onEdit: (c) => {
            setConfirmingId(null);
            onEdit(c);
        },
        onHoverChange: (id, hovering) => {
            setHoveredId(hovering ? id : null);
            if (!hovering) setConfirmingId((current) => (current === id ? null : current));
        },
        onFocusChange: (id, focused) => {
            if (focused) setFocusedId(id);
            else setFocusedId((current) => (current === id ? null : current));
        },
        onArmDelete: (id) => setConfirmingId(id),
        onConfirmDelete: (id) => {
            onDelete(id);
            setConfirmingId(null);
        },
    };

    return { state, handlers };
}
