import ResizeHandle from '../common/components/ResizeHandle.tsx';
import type { useShell } from './hooks/useShell.ts';
import ShellPaneBody from './ShellPaneBody.tsx';
import ShellPaneDropZones from './ShellPaneDropZones.tsx';
import ShellPaneEditor from './ShellPaneEditor.tsx';
import ShellPaneHeader from './ShellPaneHeader.tsx';
import { shellPaneMainStyle, shellPaneView } from './shellPaneView.ts';

interface Props {
    pane: 'primary' | 'secondary';
    s: ReturnType<typeof useShell>;
}

/**
 * One editor+results half of the split. Called twice with `pane` swapped --
 * primary always, secondary only while `s.showSplit` -- so the two panes can
 * never drift out of sync with each other's behaviour. See `shellPaneView.ts`
 * for which of `s`'s per-pane fields (`activeTab` vs `secondaryActiveTab`,
 * `runPrimary` vs `runSecondary`, ...) applies.
 */
export default function ShellPane({ pane, s }: Props) {
    const view = shellPaneView(pane, s);
    const { tab, showEditor, diagramRefreshCount, dragResults } = view;
    const onSelectDatabase = (db: string) => s.pointTabAt(tab, pane, db);
    const onPickerOpenChange = (open: boolean) => s.setPickerPane(open ? pane : null);

    return (
        <main
            data-testid={view.dataTestId}
            className={showEditor ? '' : 'main--grid'}
            style={shellPaneMainStyle(view)}
            onFocusCapture={() => s.setFocusedPane(pane)}
            onPointerDownCapture={() => s.setFocusedPane(pane)}
        >
            <ShellPaneHeader
                pane={pane}
                tabs={view.tabs}
                activeTabId={view.activeTabId}
                draggingId={s.draggingId}
                treeDatabase={s.treeDatabase}
                activateTab={s.activateTab}
                requestClose={s.requestClose}
                moveTab={s.moveTab}
                renameTab={s.renameTab}
                openEditorTab={s.openEditorTab}
                duplicateTab={s.duplicateTab}
                saveTab={s.saveTab}
                setDraggingId={s.setDraggingId}
                openSavedQuery={s.openSavedQuery}
            />
            <ShellPaneEditor pane={pane} s={s} view={view} />
            {showEditor && <ResizeHandle orientation="horizontal" onDrag={dragResults} />}
            <ShellPaneBody
                tab={tab}
                showEditor={showEditor}
                assistantReady={s.assistantReady}
                databases={s.databases}
                diagramRefreshCount={diagramRefreshCount}
                pickerOpen={s.pickerPane === pane}
                onOpenTable={s.openTable}
                onSelectDatabase={onSelectDatabase}
                onPickerOpenChange={onPickerOpenChange}
                onDiagnose={s.diagnoseFailure}
            />
            <ShellPaneDropZones
                pane={pane}
                showSplit={s.showSplit}
                draggingId={s.draggingId}
                draggedPane={s.draggedPane}
                moveTab={s.moveTab}
                setDraggingId={s.setDraggingId}
            />
        </main>
    );
}
