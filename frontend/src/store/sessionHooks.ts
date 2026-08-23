import { useCallback } from 'react';

import type {
    ConnectionColorId,
    ConnectionConfig,
    Environment,
} from '../../../shared/protocol/index.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { AppDispatch } from './index.ts';
import {
    connectionActivated,
    errorDismissed,
    selectActiveConnection,
    selectConnections,
    serverLabel,
} from './sessionSlice.ts';
import { connect, connectSaved, disconnect, setReadOnly } from './sessionThunks.ts';

function useSessionActions(dispatch: AppDispatch, activeConnectionId: string | null) {
    return {
        connect: useCallback(
            (arg: {
                config: ConnectionConfig;
                name: string;
                environment: Environment;
                workspaceId: string;
                color: ConnectionColorId;
                readOnly: boolean;
                savedConnectionId: string;
            }) => dispatch(connect(arg)),
            [dispatch],
        ),
        connectSaved: useCallback(
            (id: string, password?: string) => dispatch(connectSaved({ id, password })),
            [dispatch],
        ),
        /** Defaults to the one in front, which is what a titlebar's Disconnect means. */
        disconnect: useCallback(
            (connectionId?: string) => {
                const id = connectionId ?? activeConnectionId;
                if (id) void dispatch(disconnect(id));
            },
            [dispatch, activeConnectionId],
        ),
        activate: useCallback(
            (connectionId: string) => dispatch(connectionActivated({ connectionId })),
            [dispatch],
        ),
        setReadOnly: useCallback(
            (connectionId: string, readOnly: boolean) =>
                dispatch(setReadOnly({ connectionId, readOnly })),
            [dispatch],
        ),
        dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
    };
}

/**
 * The active connection's fields, flattened.
 *
 * Most callers only ever mean "the one in front" -- the editor's dialect, the
 * titlebar's server -- so they read it here and never learn that there are
 * others. The rail is what reads `connections`.
 */
export function useSession() {
    const dispatch = useAppDispatch();
    const {
        connecting,
        connectingPhase,
        connectingStartedAt,
        error,
        awsCredentialsFailed,
        activeConnectionId,
    } = useAppSelector((s) => s.session);
    const active = useAppSelector(selectActiveConnection);
    const connections = useAppSelector(selectConnections);

    return {
        connections,
        activeConnectionId,
        connectionId: activeConnectionId,
        config: active?.config ?? null,
        // Plain SQL until a server says otherwise: the editor exists before a
        // session does, and outlives the last one closing.
        dialect: active?.dialect ?? 'sql',
        // Undefined until a server says otherwise, which reads as "nothing to leave
        // off a name" -- the same answer an engine without schemas gives.
        defaultSchema: active?.defaultSchema,
        environment: active?.environment ?? null,
        name: active?.name ?? '',
        readOnly: active?.readOnly ?? false,
        /** Why the connection in front is not reachable, or null while it is. */
        lostReason: active?.lostReason ?? null,
        connecting,
        connectingPhase,
        connectingStartedAt,
        error,
        awsCredentialsFailed,
        connected: activeConnectionId !== null,
        serverLabel: active ? serverLabel(active.config) : '',
        ...useSessionActions(dispatch, activeConnectionId),
    };
}
