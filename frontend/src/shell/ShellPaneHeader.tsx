import type { SavedQuery } from '../../../shared/protocol/index.ts';
import { SavedQueriesButton } from '../features/queries/index.ts';
import { TabStrip } from '../features/tabs/index.ts';
import type { CloseIntent, Tab } from '../store/tabsSlice.ts';

interface Props {
    pane: Tab['pane'];
    tabs: Tab[];
    activeTabId: string | null;
    draggingId: string | null;
    treeDatabase: string | null;
    activateTab: (id: string) => void;
    requestClose: (intent: CloseIntent) => void;
    moveTab: (id: string, beforeId: string | null, pane?: Tab['pane']) => void;
    renameTab: (id: string, title: string) => void;
    openEditorTab: (
        title?: string,
        sql?: string,
        database?: string | null,
        pane?: Tab['pane'],
    ) => string | null;
    duplicateTab: (tabId: string) => void;
    saveTab: (id: string) => void;
    setDraggingId: (id: string | null) => void;
    openSavedQuery: (query: SavedQuery, pane: Tab['pane']) => void;
}

/**
 * The button is beside the strip, not inside it: the strip scrolls once there
 * are more tabs than fit, and a control inside it would scroll away with them.
 */
export default function ShellPaneHeader({
    pane,
    tabs,
    activeTabId,
    draggingId,
    treeDatabase,
    activateTab,
    requestClose,
    moveTab,
    renameTab,
    openEditorTab,
    duplicateTab,
    saveTab,
    setDraggingId,
    openSavedQuery,
}: Props) {
    return (
        <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
            <TabStrip
                tabs={tabs}
                activeTabId={activeTabId}
                onActivate={activateTab}
                onClose={(id) => requestClose({ kind: 'one', id })}
                onCloseOthers={(id) => requestClose({ kind: 'others', id })}
                onCloseToTheRight={(id) => requestClose({ kind: 'right', id })}
                onCloseAll={() => requestClose({ kind: 'all', pane })}
                onMove={(id, beforeId) => moveTab(id, beforeId, pane)}
                onRename={renameTab}
                onNewTab={() => openEditorTab(undefined, undefined, treeDatabase, pane)}
                onDuplicateTab={duplicateTab}
                onSaveTab={saveTab}
                draggingId={draggingId}
                onDragTab={setDraggingId}
            />
            <SavedQueriesButton onOpen={(query) => openSavedQuery(query, pane)} />
        </div>
    );
}
