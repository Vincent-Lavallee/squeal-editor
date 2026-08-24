import { useState } from 'react';
import type { Tab } from '../../../store/tabsSlice.ts';
import { useTabMenuItems } from './useTabMenuItems.ts';
import { useTabRename } from './useTabRename.ts';
import { useTabStripDrag } from './useTabStripDrag.ts';

interface Options {
    tabList: Tab[];
    activeTabId: string | null;
    draggingId: string | null;
    onDragTab: (id: string | null) => void;
    onMove: (id: string, beforeId: string | null) => void;
    onRename: (id: string, title: string) => void;
    onSaveTab?: (tabId: string) => void;
    onDuplicateTab?: (tabId: string) => void;
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    onCloseToTheRight: (id: string) => void;
    onCloseAll: () => void;
}

export function useTabStripController(options: Options) {
    const { tabList, activeTabId, draggingId, onDragTab, onMove, onRename } = options;
    const { onSaveTab, onDuplicateTab, onClose, onCloseOthers, onCloseToTheRight, onCloseAll } =
        options;

    const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
    const [hoveredCloseId, setHoveredCloseId] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    const { renaming, setRenaming, commitRename, renameInputRef } = useTabRename(onRename);
    const { strip, dropAt, dragOverStrip, dragLeaveStrip, drop, endDrag } = useTabStripDrag({
        tabList,
        activeTabId,
        draggingId,
        onDragTab,
        onMove,
    });
    const { menuItems } = useTabMenuItems({
        tabList,
        onSaveTab,
        onDuplicateTab,
        onClose,
        onCloseOthers,
        onCloseToTheRight,
        onCloseAll,
        onStartRename: (id, draft) => setRenaming({ id, draft }),
    });

    return {
        strip,
        dropAt,
        dragOverStrip,
        dragLeaveStrip,
        drop,
        endDrag,
        hoveredTabId,
        hoveredCloseId,
        setHoveredTabId,
        setHoveredCloseId,
        menu,
        setMenu,
        menuItems,
        renaming,
        setRenaming,
        commitRename,
        renameInputRef,
    };
}
