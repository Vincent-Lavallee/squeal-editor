import type { Tab } from '../../store/tabsSlice.ts';
import ContextMenu from '../../common/components/ContextMenu.tsx';
import * as t from '../../common/tokens';
import TabStripRows from './TabStripRows.tsx';
import NewTabButton from './NewTabButton.tsx';
import { useTabStripController } from './useTabStripController.ts';

interface Props {
    /**
     * Which tabs this strip draws, and which one is active among them -- a prop
     * rather than read off `useTabs()` internally, because a split view mounts
     * two of these at once, one per pane, and each needs its own subset. See
     * *Split the editor* in `docs/frontend.md`.
     */
    tabs: Tab[];
    activeTabId: string | null;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    onCloseToTheRight: (id: string) => void;
    onCloseAll: () => void;
    /** Drop `id` in front of `beforeId`, or at the end when that is null. */
    onMove: (id: string, beforeId: string | null) => void;
    onRename: (id: string, title: string) => void;
    /** Omitted on the secondary pane's strip -- new tabs only ever open primary. */
    onNewTab?: () => void;
    /**
     * Duplicating copies the query text, which lives in the editor's context and
     * not in the tab -- so it is wired in the composition root like every other
     * thing that spans two features, and arrives here as a prop. Omitted on the
     * secondary pane's strip for the same reason `onNewTab` is.
     */
    onDuplicateTab?: (tabId: string) => void;
    /**
     * Save an editor tab's text as a named query -- the menu's route to what
     * Ctrl+S does. The text is the editor's, not the tab's, so like duplicate it
     * is wired in the composition root and arrives here as a prop. It takes an id
     * rather than acting on the active tab, because the menu can be summoned on a
     * tab that is not in front.
     */
    onSaveTab?: (tabId: string) => void;
    /**
     * The id of whatever tab is being dragged, from *either* strip -- a
     * controlled prop, not local state, because a drop has to be accepted by
     * the strip it lands on even when the drag started in the other one, and
     * only the composition root sees both. Set from this strip's own
     * `onDragStart`/`onDragEnd` via `onDragTab`, which is also what the
     * dock-to-split drop zone watches for. `null` when nothing is being dragged
     * anywhere.
     */
    draggingId: string | null;
    onDragTab: (id: string | null) => void;
}

const stripStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    flex: 1,
    minWidth: 0,
    borderBottom: `1px solid ${t.BORDER}`,
    overflowX: 'auto',
    scrollbarWidth: 'none',
};

export default function TabStrip(props: Props) {
    const {
        tabs: tabList,
        activeTabId,
        onActivate,
        onClose,
        onNewTab,
        draggingId,
        onDragTab,
    } = props;
    const c = useTabStripController({ ...props, tabList });

    return (
        <div
            ref={c.strip}
            data-testid="tabs"
            style={stripStyle}
            role="tablist"
            onDragOver={c.dragOverStrip}
            onDragLeave={c.dragLeaveStrip}
            onDrop={c.drop}
        >
            <TabStripRows
                tabList={tabList}
                activeTabId={activeTabId}
                draggingId={draggingId}
                dropAt={c.dropAt}
                renaming={c.renaming}
                renameInputRef={c.renameInputRef}
                hoveredTabId={c.hoveredTabId}
                hoveredCloseId={c.hoveredCloseId}
                onHoverTab={c.setHoveredTabId}
                onHoverClose={c.setHoveredCloseId}
                onDragTab={onDragTab}
                onDragEnd={c.endDrag}
                onContextMenu={(id, x, y) => c.setMenu({ id, x, y })}
                onActivate={onActivate}
                onRenamingChange={(id, draft) => c.setRenaming({ id, draft })}
                onRenameCommit={c.commitRename}
                onRenameCancel={() => c.setRenaming(null)}
                onClose={onClose}
            />
            {onNewTab && <NewTabButton onNewTab={onNewTab} />}

            {c.menu && (
                <ContextMenu
                    x={c.menu.x}
                    y={c.menu.y}
                    items={c.menuItems(c.menu.id)}
                    onClose={() => c.setMenu(null)}
                />
            )}
        </div>
    );
}
