import type { MenuEntry } from '../../../common/components/ContextMenu.tsx';
import type { Tab } from '../../../store/tabsSlice.ts';

interface Options {
    tabList: Tab[];
    onSaveTab?: (tabId: string) => void;
    onDuplicateTab?: (tabId: string) => void;
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    onCloseToTheRight: (id: string) => void;
    onCloseAll: () => void;
    onStartRename: (id: string, draft: string) => void;
}

/** The tab's right-click menu. Split out of `TabStrip` purely for length. */
export function useTabMenuItems({
    tabList,
    onSaveTab,
    onDuplicateTab,
    onClose,
    onCloseOthers,
    onCloseToTheRight,
    onCloseAll,
    onStartRename,
}: Options) {
    const menuItems = (id: string): MenuEntry[] => {
        const index = tabList.findIndex((tab) => tab.id === id);
        const tab = tabList[index];
        const only = tabList.length === 1;
        const last = index === tabList.length - 1;
        const holdsText = tab?.kind === 'editor';
        return [
            // Closing is what gets used most, so it heads the menu rather than
            // trailing it, ordered by actual usage within the group: the two
            // scoped closes ahead of plain Close and Close All. A plain divider
            // (no text subheader) separates it from the tab actions below.
            { label: 'Close others', disabled: only, onSelect: () => onCloseOthers(id) },
            {
                label: 'Close Tabs to the Right',
                disabled: last,
                onSelect: () => onCloseToTheRight(id),
            },
            { label: 'Close', onSelect: () => onClose(id) },
            { label: 'Close All', onSelect: () => onCloseAll() },
            { divider: true },
            { label: 'Rename', onSelect: () => onStartRename(id, tab?.title ?? '') },
            {
                label: 'Save',
                disabled: !holdsText || !onSaveTab,
                title: holdsText ? undefined : 'Only a query tab has text to save',
                onSelect: () => onSaveTab?.(id),
            },
            { label: 'Duplicate', disabled: !onDuplicateTab, onSelect: () => onDuplicateTab?.(id) },
        ];
    };

    return { menuItems };
}
