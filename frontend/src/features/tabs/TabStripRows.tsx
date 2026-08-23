import { AssistantIcon, DiagramIcon, QueryIcon, TableIcon } from '../../common/icons/icons.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import { type DropAt } from './tabStripDrag.ts';
import TabStripItem, { type TabRowHandlers, type TabRowState } from './TabStripItem.tsx';

const iconFor = (kind: Tab['kind']) =>
    kind === 'grid'
        ? TableIcon
        : kind === 'diagram'
          ? DiagramIcon
          : kind === 'assistant'
            ? AssistantIcon
            : QueryIcon;

interface Props {
    tabList: Tab[];
    activeTabId: string | null;
    draggingId: string | null;
    dropAt: DropAt;
    renaming: { id: string; draft: string } | null;
    renameInputRef: React.RefObject<HTMLInputElement>;
    hoveredTabId: string | null;
    hoveredCloseId: string | null;
    onHoverTab: (id: string | null) => void;
    onHoverClose: (id: string | null) => void;
    onDragTab: (id: string | null) => void;
    onDragEnd: () => void;
    onContextMenu: (id: string, x: number, y: number) => void;
    onActivate: (id: string) => void;
    onRenamingChange: (id: string, draft: string) => void;
    onRenameCommit: () => void;
    onRenameCancel: () => void;
    onClose: (id: string) => void;
}

function buildRow(
    tab: Tab,
    isLastTab: boolean,
    props: Props,
): { state: TabRowState; handlers: TabRowHandlers } {
    return {
        state: {
            isLastTab,
            active: tab.id === props.activeTabId,
            hoveredTabId: props.hoveredTabId,
            hoveredCloseId: props.hoveredCloseId,
            draggingId: props.draggingId,
            dropAt: props.dropAt,
            renaming: props.renaming,
        },
        handlers: {
            onMouseEnterTab: () => props.onHoverTab(tab.id),
            onMouseLeaveTab: () => props.onHoverTab(null),
            onDragStart: () => props.onDragTab(tab.id),
            onDragEnd: props.onDragEnd,
            onContextMenu: (x, y) => props.onContextMenu(tab.id, x, y),
            onActivate: () => props.onActivate(tab.id),
            onStartRename: () => props.onRenamingChange(tab.id, tab.title),
            onRenameChange: (draft) => props.onRenamingChange(tab.id, draft),
            onRenameCommit: props.onRenameCommit,
            onRenameCancel: props.onRenameCancel,
            onCloseHoverEnter: () => props.onHoverClose(tab.id),
            onCloseHoverLeave: () => props.onHoverClose(null),
            onClose: () => props.onClose(tab.id),
        },
    };
}

export default function TabStripRows(props: Props) {
    const { tabList, renameInputRef } = props;
    return (
        <>
            {tabList.map((tab, index) => {
                const { state, handlers } = buildRow(tab, index === tabList.length - 1, props);
                return (
                    <TabStripItem
                        key={tab.id}
                        tab={tab}
                        state={state}
                        handlers={handlers}
                        renameInputRef={renameInputRef}
                        Icon={iconFor(tab.kind)}
                    />
                );
            })}
        </>
    );
}
