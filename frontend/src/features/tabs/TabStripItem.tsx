import type { Tab } from '../../store/tabsSlice.ts';
import * as t from '../../common/tokens';
import { DRAG_TYPE, type DropAt } from './tabStripDrag.ts';
import DropMark from './DropMark.tsx';
import TabCloseButton from './TabCloseButton.tsx';
import TabPickButton from './TabPickButton.tsx';
import TabRenameInput from './TabRenameInput.tsx';

export interface TabRowState {
    isLastTab: boolean;
    active: boolean;
    hoveredTabId: string | null;
    hoveredCloseId: string | null;
    draggingId: string | null;
    dropAt: DropAt;
    renaming: { id: string; draft: string } | null;
}

export interface TabRowHandlers {
    onMouseEnterTab: () => void;
    onMouseLeaveTab: () => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onContextMenu: (x: number, y: number) => void;
    onActivate: () => void;
    onStartRename: () => void;
    onRenameChange: (draft: string) => void;
    onRenameCommit: () => void;
    onRenameCancel: () => void;
    onCloseHoverEnter: () => void;
    onCloseHoverLeave: () => void;
    onClose: () => void;
}

function deriveTabRowFlags(tab: Tab, state: TabRowState) {
    const hovered = state.hoveredTabId === tab.id;
    // The dot stands in for the close until the pointer is on the slot
    // itself; an unsaved tab's slot never hides, since the dot is a state
    // and not an action offered on hover.
    const showsDot = tab.unsaved === true && state.hoveredCloseId !== tab.id;
    const shown = state.active || hovered || tab.unsaved === true;
    // Only while something is actually in flight, and never on the tab
    // being dragged: an insertion mark on the thing you are holding says a
    // move that is no move at all.
    const marked =
        state.draggingId !== null &&
        state.dropAt !== undefined &&
        state.dropAt !== state.draggingId;
    const isRenaming = state.renaming?.id === tab.id;
    return { showsDot, shown, marked, isRenaming };
}

function tabRowStyle(active: boolean, dragging: boolean): React.CSSProperties {
    return {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: t.GAP_XS,
        flex: 'none',
        maxWidth: 200,
        paddingRight: t.GAP_XS,
        opacity: dragging ? 0.4 : 1,
        ...(active ? { background: t.SELECTED, color: t.ACCENT } : {}),
    };
}

interface Props {
    tab: Tab;
    state: TabRowState;
    handlers: TabRowHandlers;
    renameInputRef: React.RefObject<HTMLInputElement>;
    Icon: React.ComponentType<{
        style?: React.CSSProperties;
        'aria-hidden'?: boolean | 'true' | 'false';
    }>;
}

export default function TabStripItem({ tab, state, handlers, renameInputRef, Icon }: Props) {
    const { showsDot, shown, marked, isRenaming } = deriveTabRowFlags(tab, state);

    return (
        <div
            data-testid="tab"
            data-tab-id={tab.id}
            style={tabRowStyle(state.active, tab.id === state.draggingId)}
            onMouseEnter={handlers.onMouseEnterTab}
            onMouseLeave={handlers.onMouseLeaveTab}
            // Not draggable mid-rename: a drag reads the tab id off this
            // element regardless of what is focused inside it, and a text
            // selection dragged from the input has no business moving the tab.
            draggable={!isRenaming}
            onDragStart={(e) => {
                handlers.onDragStart();
                e.dataTransfer?.setData(DRAG_TYPE, tab.id);
            }}
            onDragEnd={handlers.onDragEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                handlers.onContextMenu(e.clientX, e.clientY);
            }}
        >
            {marked && state.dropAt === tab.id && <DropMark side="left" />}
            {marked && state.dropAt === null && state.isLastTab && <DropMark side="right" />}

            {isRenaming ? (
                <TabRenameInput
                    inputRef={renameInputRef}
                    draft={state.renaming!.draft}
                    onChange={handlers.onRenameChange}
                    onCommit={handlers.onRenameCommit}
                    onCancel={handlers.onRenameCancel}
                />
            ) : (
                <TabPickButton
                    tab={tab}
                    active={state.active}
                    Icon={Icon}
                    onActivate={handlers.onActivate}
                    onStartRename={handlers.onStartRename}
                />
            )}
            <TabCloseButton
                title={tab.title}
                shown={shown}
                showsDot={showsDot}
                onMouseEnter={handlers.onCloseHoverEnter}
                onMouseLeave={handlers.onCloseHoverLeave}
                onClose={handlers.onClose}
            />
        </div>
    );
}
