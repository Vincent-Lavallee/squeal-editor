import type { Tab } from '../store/tabsSlice.ts';
import TabDropZone from './TabDropZone.tsx';

interface Props {
    pane: Tab['pane'];
    showSplit: boolean;
    draggingId: string | null;
    draggedPane: Tab['pane'] | null;
    moveTab: (id: string, beforeId: string | null, pane?: Tab['pane']) => void;
    setDraggingId: (id: string | null) => void;
}

/*
 * Dropping a tab in the pane's *body* moves it here -- the strip is not the
 * only target, because the strip is a 32px ribbon and the thing the user is
 * aiming at is the pane. While there is no split yet the primary pane's right
 * half is the dock zone that opens one; once there is, the whole body of
 * each pane accepts a tab from the other one.
 */
export default function ShellPaneDropZones({
    pane,
    showSplit,
    draggingId,
    draggedPane,
    moveTab,
    setDraggingId,
}: Props) {
    const other: Tab['pane'] = pane === 'primary' ? 'secondary' : 'primary';

    if (pane === 'primary') {
        return (
            <>
                {!showSplit && draggingId && (
                    <TabDropZone
                        testId="dock-zone"
                        half
                        onDropTab={() => {
                            moveTab(draggingId, null, 'secondary');
                            setDraggingId(null);
                        }}
                    />
                )}
                {showSplit && draggedPane === 'secondary' && (
                    <TabDropZone
                        testId="pane-drop-primary"
                        onDropTab={() => {
                            moveTab(draggingId!, null, 'primary');
                            setDraggingId(null);
                        }}
                    />
                )}
            </>
        );
    }

    return (
        <>
            {draggedPane === other && (
                <TabDropZone
                    testId="pane-drop-secondary"
                    onDropTab={() => {
                        moveTab(draggingId!, null, 'secondary');
                        setDraggingId(null);
                    }}
                />
            )}
        </>
    );
}
