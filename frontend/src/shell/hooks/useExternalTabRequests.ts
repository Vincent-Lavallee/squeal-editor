import { useEffect, useRef } from 'react';

import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';
import type { useTreeDatabase } from './useTreeDatabase.ts';

/**
 * The titlebar's *Relationship diagram* and assistant buttons, each arriving
 * as a bumped counter -- see `Shell`'s `Props`.
 *
 * The diagram opens on **the database the tree is showing**, for the reason a
 * table clicked in the tree does: the menu belongs to no pane and no tab, so
 * the only database it can mean is the one being looked at. Both open into
 * the pane being worked in, the rule every control attached to no pane
 * follows. The assistant carries no database: the conversation is about no
 * one database, and its tools name whichever connection they used.
 *
 * The refs are what make a counter a counter: an effect keyed on the value
 * alone would also fire on mount, opening a tab nobody asked for the moment a
 * connection appears.
 */
export function useExternalTabRequests(args: {
    openDiagramRequest: number;
    openAssistantRequest: number;
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
    tree: ReturnType<typeof useTreeDatabase>;
}) {
    const { openDiagramRequest, openAssistantRequest, data, layout, tree } = args;
    const { openDiagramTab, openAssistantTab } = data;
    const { workingPane } = layout;
    const { treeDatabase } = tree;

    const lastDiagramRequest = useRef(openDiagramRequest);
    useEffect(() => {
        if (openDiagramRequest === lastDiagramRequest.current) return;
        lastDiagramRequest.current = openDiagramRequest;
        openDiagramTab(treeDatabase, workingPane);
    }, [openDiagramRequest, openDiagramTab, treeDatabase, workingPane]);

    const lastAssistantRequest = useRef(openAssistantRequest);
    useEffect(() => {
        if (openAssistantRequest === lastAssistantRequest.current) return;
        lastAssistantRequest.current = openAssistantRequest;
        openAssistantTab(workingPane);
    }, [openAssistantRequest, openAssistantTab, workingPane]);
}
